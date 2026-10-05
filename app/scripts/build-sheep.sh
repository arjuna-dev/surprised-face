#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_SHEEP_DIR="$(cd "$SCRIPT_DIR/../../../sheep" 2>/dev/null && pwd || true)"
SHEEP_SOURCE_DIR="${SHEEP_SOURCE_DIR:-$DEFAULT_SHEEP_DIR}"
OUTPUT_DIR="$APP_DIR/resources/bin"
OUTPUT="$OUTPUT_DIR/sheep"

mkdir -p "$OUTPUT_DIR"

if [[ -n "$SHEEP_SOURCE_DIR" && -f "$SHEEP_SOURCE_DIR/go.mod" ]]; then
  (cd "$SHEEP_SOURCE_DIR" && go build -trimpath -ldflags='-s -w' -o "$OUTPUT" ./cmd/sheep)
elif [[ ! -x "$OUTPUT" ]]; then
  echo "Sheep source was not found and the bundled helper is missing." >&2
  echo "Set SHEEP_SOURCE_DIR or place a built binary at $OUTPUT." >&2
  exit 1
fi

if [[ -n "$SHEEP_SOURCE_DIR" && -f "$SHEEP_SOURCE_DIR/LICENSE" ]]; then
  cp "$SHEEP_SOURCE_DIR/LICENSE" "$APP_DIR/resources/sheep-LICENSE.txt"
fi
