#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$PROJECT_DIR/plugin}"
DEPLOY_DIR="${DEPLOY_DIR:-/mnt/e/ChromeExtension/EnhancedCaiXin}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Plugin source directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

if [[ ! -d "$(dirname "$DEPLOY_DIR")" ]]; then
  echo "Deploy parent directory does not exist: $(dirname "$DEPLOY_DIR")" >&2
  echo "Make sure the Windows E: drive is mounted in WSL." >&2
  exit 1
fi

mkdir -p "$DEPLOY_DIR"

rsync -av --delete \
  --exclude '.git/' \
  --exclude '.agents/' \
  --exclude '.codex/' \
  "$SOURCE_DIR/" "$DEPLOY_DIR/"

echo "Deployed $SOURCE_DIR to $DEPLOY_DIR"
