#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/obsidian-vault"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DIR="$1"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/voxbar-ob"

cd "$ROOT_DIR"
npm run build >/dev/null

mkdir -p "$PLUGIN_DIR"
cp manifest.json "$PLUGIN_DIR/"
cp versions.json "$PLUGIN_DIR/"
cp main.js "$PLUGIN_DIR/"

echo "Installed VoxBar for Obsidian to:"
echo "$PLUGIN_DIR"
