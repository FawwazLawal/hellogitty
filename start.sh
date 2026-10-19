#!/bin/zsh
# Starts HelloGitty in the background if it is not already running, then opens the dashboard.
# macOS. It builds from the folder it lives in and reads hellogitty.json from that folder,
# or the file named by HELLOGITTY_CONFIG.
set -u

DIR="${0:A:h}"
CONFIG="${HELLOGITTY_CONFIG:-$DIR/hellogitty.json}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if [[ ! -f "$CONFIG" ]]; then
  echo "No config at $CONFIG. Copy hellogitty.example.json to hellogitty.json and list your repositories." >&2
  exit 1
fi

PORT=$(sed -n 's/.*"listen"[^"]*"[^"]*:\([0-9][0-9]*\)".*/\1/p' "$CONFIG" | head -1)
PORT="${PORT:-7340}"

listening() { lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 }

if ! listening; then
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    GITHUB_TOKEN="$(gh auth token 2>/dev/null)"
  fi
  if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "No GitHub token: set GITHUB_TOKEN or sign in with 'gh auth login'." >&2
    exit 1
  fi
  export GITHUB_TOKEN

  # A checkout of a release tag stamps that version; anything else builds as "dev".
  VERSION="${HELLOGITTY_VERSION:-}"
  if [[ -z "$VERSION" && -d "$DIR/.git" ]]; then
    VERSION="$(git -C "$DIR" describe --tags --exact-match 2>/dev/null)"
  fi
  LDFLAGS=""
  [[ -n "$VERSION" ]] && LDFLAGS="-X main.version=$VERSION"

  cd "$DIR" || exit 1
  if ! go build -ldflags "$LDFLAGS" -o "$DIR/hellogitty" ./cmd/hellogitty >>"$DIR/hellogitty.log" 2>&1; then
    echo "Build failed. See hellogitty.log in $DIR." >&2
    exit 1
  fi
  nohup "$DIR/hellogitty" -config "$CONFIG" >>"$DIR/hellogitty.log" 2>&1 </dev/null &

  for _ in {1..50}; do
    listening && break
    sleep 0.2
  done
  if ! listening; then
    echo "HelloGitty did not start. See hellogitty.log in $DIR." >&2
    exit 1
  fi
fi

open "http://localhost:$PORT"
