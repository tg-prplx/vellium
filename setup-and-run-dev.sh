#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log() {
  printf "[setup] %s\n" "$*"
}

ensure_path_for_common_node_locations() {
  for candidate in /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$candidate/node" ] && [[ ":$PATH:" != *":$candidate:"* ]]; then
      export PATH="$candidate:$PATH"
    fi
  done
}

ensure_node() {
  ensure_path_for_common_node_locations
  if command -v node >/dev/null 2>&1; then
    log "Node found: $(node -v)"
    return 0
  fi

  log "Node.js not found. Trying automatic install..."

  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    log "Using nvm to install Node LTS..."
    nvm install --lts
    nvm use --lts
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    log "Using Homebrew to install Node..."
    brew install node
    ensure_path_for_common_node_locations
    if command -v node >/dev/null 2>&1; then
      return 0
    fi
  fi

  cat <<'EOF'
[setup] Failed to install Node.js automatically.
[setup] Install Node.js LTS manually, then run this script again:
[setup] https://nodejs.org/en/download
EOF
  return 1
}

main() {
  log "Project root: $ROOT_DIR"
  ensure_node

  if ! command -v npm >/dev/null 2>&1; then
    log "npm is not available even though Node exists. Reinstall Node.js LTS."
    exit 1
  fi

  log "Installing npm dependencies..."
  npm install

  log "Starting development environment..."
  npm run dev
}

main "$@"
