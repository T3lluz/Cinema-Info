#!/usr/bin/env bash
# Publish origin/main to t3lluz.com/CinemaInfo: stage public/, stamp the
# build token, mirror the posters, and swap the new build in at once.
#
# cinema-info-deploy.timer runs this every minute; it does nothing unless
# main has moved. Run it by hand any time; --force rebuilds regardless.
#
# The whole script is one function, called on the last line, so bash has
# read all of it before `git reset` can rewrite this very file.
set -euo pipefail

main() {
  local home="${CINEMA_HOME:-$HOME/docker/cinema-info}"
  local repo="$home/repo" build="$home/build" branch=main
  local force="${1:-}"
  local -a compose=(docker compose -f "$repo/deploy/server/compose.yml" --project-directory "$home")

  cd "$home"
  exec 9>"$home/.deploy.lock"
  flock -n 9 || exit 0

  git -C "$repo" fetch --quiet origin "$branch"
  local old new sha current
  old=$(git -C "$repo" rev-parse HEAD)
  new=$(git -C "$repo" rev-parse "origin/$branch")
  sha=${new:0:7}
  current=$(readlink "$build/current" 2>/dev/null || true)
  if [[ "$old" == "$new" && "$current" == "site-$sha" && "$force" != "--force" ]]; then
    exit 0
  fi

  # A main from before this deploy existed would take the server's own
  # code away from under it. Wait for one that has it.
  if ! git -C "$repo" cat-file -e "$new:deploy/server/compose.yml" 2>/dev/null; then
    echo "origin/$branch ($sha) has no deploy/server yet; leaving $current in place"
    exit 0
  fi

  git -C "$repo" reset --quiet --hard "$new"

  local stage="$build/.site-$sha.tmp"
  rm -rf "$stage"
  mkdir -p "$stage"
  cp -a "$repo/public/." "$stage/"
  # The token phones see is the last commit that changed what they run,
  # not $sha: a snapshot refresh only touches public/data, which an open
  # app re-reads by itself, so it must not send every phone a new worker.
  # (Not "build": that name is the build directory above.)
  local token
  token=$(git -C "$repo" log -1 --format=%H "$new" -- public scripts/stamp-version.mjs ':(exclude)public/data')
  token=${token:-$new}
  node "$repo/scripts/stamp-version.mjs" "$stage" "${token:0:7}"
  # Its own app identity on t3lluz.com. A manifest id resolves against the
  # origin, not the path, so the shared "./" would become
  # https://t3lluz.com/, which is the dashboard's id too, and a phone with
  # the dashboard installed takes Cinema Info for it and offers no install.
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    m.id = "/CinemaInfo/";
    fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  ' "$stage/manifest.webmanifest"
  # Posters are content-addressed by file name, so last build's copies
  # carry over and only new ones are downloaded.
  if [[ -d "$build/current/posters" ]]; then
    cp -a "$build/current/posters" "$stage/"
  fi
  node "$repo/scripts/mirror-posters.mjs" "$stage" ||
    echo "posters: mirror failed; the ripple runs without them"

  rm -rf "$build/site-$sha"
  mv "$stage" "$build/site-$sha"
  ln -sfn "site-$sha" "$build/.current.tmp"
  mv -T "$build/.current.tmp" "$build/current"

  # Keep the three newest builds; older ones only take space.
  ls -1dt "$build"/site-* | tail -n +4 | xargs -r rm -rf

  # Recreates the containers only if compose.yml or .env changed.
  "${compose[@]}" up -d --remove-orphans --quiet-pull

  # The server holds its code in memory: restart it when that code moved.
  if [[ "$old" != "$new" ]] &&
    ! git -C "$repo" diff --quiet "$old" "$new" -- server supabase/functions; then
    "${compose[@]}" restart cinema-info
    echo "restarted cinema-info (server code changed)"
  fi

  echo "deployed $sha"
}

main "$@"
exit
