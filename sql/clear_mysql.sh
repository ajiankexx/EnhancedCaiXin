#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-enhanced-caixin-mysql}"
VOLUME_NAME="${VOLUME_NAME:-enhanced-caixin-mysql-data}"
CONFIRM="${CONFIRM:-}"

cat <<EOF
This will delete the local MySQL container and data volume for EnhancedCaiXin.

Container: $CONTAINER_NAME
Volume:    $VOLUME_NAME

All data in this local MySQL volume will be removed.
EOF

if [[ "$CONFIRM" != "enhanced-caixin" ]]; then
  cat <<'EOF' >&2

Refusing to continue without confirmation.
Run again with:

  CONFIRM=enhanced-caixin ./sql/clear_mysql.sh

EOF
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
  echo "Removed container: $CONTAINER_NAME"
else
  echo "Container not found: $CONTAINER_NAME"
fi

if docker volume ls --format '{{.Name}}' | grep -Fxq "$VOLUME_NAME"; then
  docker volume rm "$VOLUME_NAME" >/dev/null
  echo "Removed volume: $VOLUME_NAME"
else
  echo "Volume not found: $VOLUME_NAME"
fi

cat <<'EOF'

MySQL data has been cleared.
To create a fresh database with the current migrations, run:

  MYSQL_IMAGE=mysql:8.0.39 ./sql/deploy_mysql.sh

EOF
