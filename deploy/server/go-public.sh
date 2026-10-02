#!/usr/bin/env bash
# Make t3lluz.com/CinemaInfo public, and only that.
#
# t3lluz.com is otherwise tailnet-only: public DNS points it at the
# tailnet address of the proxy node, which nobody outside the tailnet can
# reach. This script:
#
#   1. checks that tailnet devices resolve t3lluz.com privately (Tailscale
#      split DNS -> the split-dns responder in ~/docker/caddy), so moving
#      public DNS cannot take the dashboard away from them
#   2. creates the Cloudflare tunnel "t3lluz-public" if it is missing, and
#      routes t3lluz.com/CinemaInfo* to cinema-info:8080 and every other
#      path on the apex to a 404
#   3. puts the tunnel token in ~/docker/cinema-info/.env and starts the
#      tunnel container
#   4. points public DNS for t3lluz.com at the tunnel (proxied CNAME);
#      *.t3lluz.com is left alone and stays tailnet-only
#   5. checks the result from the public side
#
# Safe to run again. `--rollback` puts the apex record back the way it
# was (A 100.70.193.66, not proxied) and stops the tunnel.
#
# Needs a Cloudflare API token with Zone/DNS/Edit on t3lluz.com and
# Account/Cloudflare Tunnel/Edit: CF_API_TOKEN, or else the
# CLOUDFLARE_API_TOKEN Caddy already uses (~/docker/caddy/.env).
set -euo pipefail

main() {
  local home="${CINEMA_HOME:-$HOME/docker/cinema-info}"
  local zone_name="t3lluz.com" tunnel_name="t3lluz-public"
  local private_ip="100.70.193.66"
  local service="http://cinema-info:8080"
  local token="${CF_API_TOKEN:-}"
  if [[ -z "$token" && -f "$HOME/docker/caddy/.env" ]]; then
    token=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$HOME/docker/caddy/.env" | tr -d '"'"'"'')
  fi
  [[ -n "$token" ]] || die "no Cloudflare API token (set CF_API_TOKEN)"

  cf() { # method path [json]
    local out
    out=$(curl -sS -X "$1" "https://api.cloudflare.com/client/v4$2" \
      -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
      ${3:+--data "$3"})
    if [[ $(jq -r .success <<<"$out") != "true" ]]; then
      echo "Cloudflare: $1 $2 failed: $(jq -c .errors <<<"$out")" >&2
      return 1
    fi
    printf '%s' "$out"
  }

  local zone account
  zone=$(cf GET "/zones?name=$zone_name" | jq -r '.result[0].id')
  account=$(cf GET "/zones/$zone" | jq -r '.result.account.id')
  local record
  record=$(cf GET "/zones/$zone/dns_records?name=$zone_name" |
    jq -c '[.result[] | select(.type == "A" or .type == "CNAME")][0]')
  local record_id
  record_id=$(jq -r .id <<<"$record")

  local compose=(docker compose -f "$home/repo/deploy/server/compose.yml" --project-directory "$home")

  if [[ "${1:-}" == "--rollback" ]]; then
    cf PUT "/zones/$zone/dns_records/$record_id" \
      "{\"type\":\"A\",\"name\":\"$zone_name\",\"content\":\"$private_ip\",\"proxied\":false,\"ttl\":1}" >/dev/null
    echo "DNS: $zone_name -> $private_ip (tailnet only again)"
    set_env "$home/.env" COMPOSE_PROFILES ""
    "${compose[@]}" --profile public stop tunnel || true
    echo "tunnel stopped. The tunnel itself is kept in Cloudflare for next time."
    return
  fi

  # 1. The tailnet must resolve t3lluz.com on its own first.
  if [[ "${1:-}" != "--skip-split-dns-check" ]]; then
    local answer
    answer=$(dig +short "$zone_name" @100.100.100.100 2>/dev/null | head -1 || true)
    if ! docker exec tailscale tailscale dns status 2>/dev/null | grep -q "$zone_name"; then
      die "Tailscale split DNS for $zone_name is not set yet.
  Tailscale admin -> DNS -> Add nameserver -> Custom: $private_ip,
  tick 'Restrict to domain', domain: $zone_name. Then run this again.
  (MagicDNS answers $zone_name with: ${answer:-nothing})"
    fi
    answer=$(dig +short "$zone_name" @100.100.100.100 | head -1)
    [[ "$answer" == "$private_ip" ]] ||
      die "split DNS is set, but the tailnet answers $zone_name with '$answer', not $private_ip.
  Is the split-dns container running in ~/docker/caddy?"
    echo "split DNS: tailnet resolves $zone_name -> $answer"
  fi

  # 2. The tunnel and its routes.
  local tunnel
  tunnel=$(cf GET "/accounts/$account/cfd_tunnel?name=$tunnel_name&is_deleted=false" | jq -r '.result[0].id // empty')
  if [[ -z "$tunnel" ]]; then
    tunnel=$(cf POST "/accounts/$account/cfd_tunnel" \
      "{\"name\":\"$tunnel_name\",\"config_src\":\"cloudflare\",\"tunnel_secret\":\"$(openssl rand -base64 32)\"}" |
      jq -r .result.id)
    echo "tunnel: created $tunnel_name ($tunnel)"
  else
    echo "tunnel: $tunnel_name ($tunnel)"
  fi
  cf PUT "/accounts/$account/cfd_tunnel/$tunnel/configurations" "$(jq -nc \
    --arg host "$zone_name" --arg svc "$service" '{config: {ingress: [
      {hostname: $host, path: "(?i)^/cinemainfo(/.*)?$", service: $svc},
      {service: "http_status:404"}
    ]}}')" >/dev/null
  echo "tunnel: $zone_name/CinemaInfo* -> $service, everything else 404"

  # 3. Token into .env, tunnel up.
  local tunnel_token
  tunnel_token=$(cf GET "/accounts/$account/cfd_tunnel/$tunnel/token" | jq -r .result)
  set_env "$home/.env" TUNNEL_TOKEN "$tunnel_token"
  set_env "$home/.env" COMPOSE_PROFILES public
  "${compose[@]}" --profile public up -d tunnel
  local i status=""
  for i in $(seq 1 30); do
    status=$(cf GET "/accounts/$account/cfd_tunnel/$tunnel" | jq -r .result.status)
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done
  [[ "$status" == "healthy" ]] || die "tunnel did not come up (status: $status). docker logs cinema-tunnel"
  echo "tunnel: healthy"

  # 4. Public DNS for the apex -> the tunnel.
  cf PUT "/zones/$zone/dns_records/$record_id" \
    "{\"type\":\"CNAME\",\"name\":\"$zone_name\",\"content\":\"$tunnel.cfargotunnel.com\",\"proxied\":true,\"ttl\":1}" >/dev/null
  echo "DNS: $zone_name -> tunnel (proxied); *.$zone_name unchanged"

  # 5. Ask from outside, through a Cloudflare edge address.
  local edge code=""
  for i in $(seq 1 30); do
    edge=$(dig +short "$zone_name" @1.1.1.1 | grep -v "^$private_ip$" | head -1 || true)
    if [[ -n "$edge" ]]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$zone_name:443:$edge" \
        "https://$zone_name/CinemaInfo/api/health" || true)
      [[ "$code" == "200" ]] && break
    fi
    sleep 3
  done
  [[ "$code" == "200" ]] || die "public check failed (edge ${edge:-none}, HTTP ${code:-none})"
  echo "public: https://$zone_name/CinemaInfo/ answers from $edge"
  code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$zone_name:443:$edge" "https://$zone_name/")
  echo "public: https://$zone_name/ -> HTTP $code (the dashboard stays private)"
}

die() {
  echo "go-public: $*" >&2
  exit 1
}

# set_env FILE KEY VALUE: replace or append KEY=VALUE, file mode 600.
set_env() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  chmod 600 "$file"
  grep -v "^$key=" "$file" >"$file.tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$file.tmp"
  mv "$file.tmp" "$file"
}

main "$@"
exit
