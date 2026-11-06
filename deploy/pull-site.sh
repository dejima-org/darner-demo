#!/usr/bin/env bash
# Runs on the web host (see dejima-demo-darner-pull.service). Finds the newest
# successful deploy.yml run for a push to main, downloads its `site` artifact,
# unpacks it as a new release and atomically points `current` at it. Does
# nothing if that build is already live.
#
# Only a push to main can produce a deployable build: the forge, not the
# workflow, sets a run's branch and event, so a workflow on another branch
# cannot pass itself off as one.
#
#   SITE_FORGE_API  the forge's API root, e.g. https://gitbox.branderson.io/api/v1
#   SITE_REPO       owner/repo
#   SITE_ROOT       directory holding releases/ and the `current` symlink
#   SITE_KEEP       releases to keep for rollback (default 5)
#
# The forge token is read from $CREDENTIALS_DIRECTORY/token (systemd
# LoadCredential), never from the environment or argv.
set -euo pipefail

: "${SITE_FORGE_API:?}" "${SITE_REPO:?}" "${SITE_ROOT:?}" "${CREDENTIALS_DIRECTORY:?}"
keep="${SITE_KEEP:-5}"
api="$SITE_FORGE_API/repos/$SITE_REPO"
releases="$SITE_ROOT/releases"
mkdir -p "$releases"

auth() { printf 'Authorization: token %s\n' "$(cat "$CREDENTIALS_DIRECTORY/token")"; }
get() { curl -fsSL --max-time 600 -H @<(auth) "$@"; }

run=$(get "$api/actions/runs?branch=main&event=push&status=success&limit=50" | jq -c '
  [.workflow_runs[]
   | select(.head_branch == "main" and .event == "push" and .conclusion == "success"
            and (.path | split("@")[0] | endswith("deploy.yml")))]
  | max_by(.id) // empty')
[ -n "$run" ] || { echo "no successful build of main yet"; exit 0; }

id=$(jq -r .head_sha <<<"$run" | cut -c1-12)
[ "$(readlink "$SITE_ROOT/current" 2>/dev/null || true)" = "releases/$id" ] && exit 0

artifact=$(get "$api/actions/runs/$(jq -r .id <<<"$run")/artifacts?name=site" |
  jq -r '[.artifacts[] | select(.expired | not)][0].id // empty')
[ -n "$artifact" ] || { echo "the build of $id has no site artifact left (expired?); keeping what is live"; exit 0; }

# Staged inside releases/ so the final mv is a rename on one filesystem.
tmp=$(mktemp -d "$releases/.incoming.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

if [ ! -d "$releases/$id" ]; then
  get -o "$tmp/site.zip" "$api/actions/artifacts/$artifact/zip"
  # unzip already refuses absolute and ../ member names.
  unzip -q "$tmp/site.zip" -d "$tmp/site"
  [ -f "$tmp/site/index.html" ] || { echo "build $id has no index.html; not deploying it" >&2; exit 1; }
  chmod -R a+rX "$tmp/site"
  mv "$tmp/site" "$releases/$id"
fi

ln -sfn "releases/$id" "$SITE_ROOT/current.new"
mv -T "$SITE_ROOT/current.new" "$SITE_ROOT/current"
echo "deployed $id"

# Prune old releases, newest first, never the live one.
ls -1t "$releases" | { grep -vx "$id" || true; } | tail -n +"$keep" | while read -r old; do
  rm -rf "${releases:?}/$old"
done
