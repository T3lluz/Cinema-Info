#!/usr/bin/env bash
# Publish origin/main to t3lluz.com/CinemaInfo, the way the Pages workflow
# publishes it to GitHub Pages: stage public/, stamp the build token,
# mirror the posters, and swap the new build in at once.
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

  git -C "$repo" reset --quiet --hard "$new"

  local stage="$build/.site-$sha.tmp"
  rm -rf "$stage"
  mkdir -p "$stage"
  cp -a "$repo/public/." "$stage/"
  node "$repo/scripts/stamp-version.mjs" "$stage" "$sha"
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
