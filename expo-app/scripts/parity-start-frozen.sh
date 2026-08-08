#!/bin/zsh

set -eu

readonly SCRIPT_DIR="${0:A:h}"
readonly PROJECT_DIR="${SCRIPT_DIR:h}"
readonly BUNDLED_NODE_DIR="/Users/wegpt.com/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
readonly DEFAULT_PORT="8082"

if [[ -d "${BUNDLED_NODE_DIR}" ]]; then
  export PATH="${BUNDLED_NODE_DIR}:${PATH}"
fi

if [[ ! "${BWCHAT_PARITY_PORT:-${DEFAULT_PORT}}" =~ '^[0-9]+$' ]]; then
  /bin/echo "BWCHAT_PARITY_PORT must be numeric." >&2
  exit 64
fi

cd "${PROJECT_DIR}"

# CI disables filesystem watching/reloads. --no-dev removes __DEV__ branches and
# --minify makes the served bundle closer to a local Release build. This server
# is exclusively for a frozen acceptance batch, never for implementation work.
export CI=1
exec ./node_modules/.bin/expo start \
  --dev-client \
  --no-dev \
  --minify \
  --port "${BWCHAT_PARITY_PORT:-${DEFAULT_PORT}}" \
  --lan
