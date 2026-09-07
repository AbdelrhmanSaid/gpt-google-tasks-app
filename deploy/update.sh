#!/usr/bin/env bash
set -Eeuo pipefail

# Run as ubuntu. Only service activation needs sudo; builds never run as root
# and never receive the production environment or Google credentials.
if [[ "$(id -un)" != ubuntu ]]; then
  echo 'Run google-tasks-deploy as ubuntu, without sudo.' >&2
  exit 1
fi

export PATH="/opt/node/bin:$PATH"
export GIT_TERMINAL_PROMPT=0

repository=/opt/google-tasks/repository
releases=/opt/google-tasks/releases
current=/opt/google-tasks/current

exec 9>"$releases/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }

if [[ ! -d "$repository/.git" ]]; then
  git clone --branch master --single-branch \
    https://github.com/AbdelrhmanSaid/gpt-google-tasks-app "$repository"
fi

if [[ -n "$(git -C "$repository" status --porcelain)" ]]; then
  echo 'The server checkout has local changes. Resolve them before deploying.' >&2
  exit 1
fi

git -C "$repository" checkout master
git -C "$repository" pull --ff-only origin master

revision=$(git -C "$repository" rev-parse HEAD)
release=$(mktemp -d "$releases/$(date -u +%Y%m%d-%H%M%S)-${revision:0:12}-XXXXXX")
chmod 755 "$release"
git -C "$repository" archive "$revision" | tar -x -C "$release"
printf '%s\n' "$revision" > "$release/REVISION"

cd "$release"
npm ci
npm run build
npm run typecheck
npm run format:check
npm run test -w @tasks/ui
npm run smoke -w @tasks/server
npm run test:google -w @tasks/server
npm run test:oauth -w @tasks/server

previous=$(readlink -f "$current")

activate_release() {
  # Rename a temporary symlink atomically so current never points at a partial
  # build. The state directory and environment live outside every release.
  sudo ln -sfn "$1" /opt/google-tasks/current.next
  sudo mv -Tf /opt/google-tasks/current.next "$current"
  sudo systemctl restart google-tasks
}

rollback() {
  trap - ERR
  echo "Deployment failed; restoring $previous" >&2
  activate_release "$previous"
  exit 1
}

trap rollback ERR
activate_release "$release"

healthy=false

for attempt in {1..15}; do
  if curl --fail --silent http://127.0.0.1:3001/health > /dev/null; then
    healthy=true
    break
  fi

  sleep 1
done

if [[ "$healthy" != true ]]; then
  rollback
fi

trap - ERR
printf 'Deployed %s\nRelease: %s\nPrevious: %s\n' "$revision" "$release" "$previous"
echo 'If tools or UI changed, refresh Google Tasks in ChatGPT plugin settings.'
