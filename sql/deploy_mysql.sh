#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SOURCE_DIR/migrations}"
CONTAINER_NAME="${CONTAINER_NAME:-enhanced-caixin-mysql}"
VOLUME_NAME="${VOLUME_NAME:-enhanced-caixin-mysql-data}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.4}"
MYSQL_PORT="${MYSQL_PORT:-3307}"
MYSQL_DATABASE="${MYSQL_DATABASE:-enhanced_caixin}"
MYSQL_USER="${MYSQL_USER:-caixin_app}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-caixin_app_password}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-enhanced_caixin_root_password}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH." >&2
  exit 1
fi

docker volume create "$VOLUME_NAME" >/dev/null

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker start "$CONTAINER_NAME" >/dev/null
else
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "$MYSQL_PORT:3306" \
    -v "$VOLUME_NAME:/var/lib/mysql" \
    -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
    -e MYSQL_DATABASE="$MYSQL_DATABASE" \
    -e MYSQL_USER="$MYSQL_USER" \
    -e MYSQL_PASSWORD="$MYSQL_PASSWORD" \
    "$MYSQL_IMAGE" >/dev/null
fi

echo "Waiting for MySQL to be ready..."
for _ in {1..60}; do
  if docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER_NAME" \
    mysqladmin ping -uroot --silent >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER_NAME" \
  mysqladmin ping -uroot --silent >/dev/null 2>&1; then
  echo "MySQL did not become ready in time." >&2
  exit 1
fi

docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER_NAME" \
  mysql -uroot "$MYSQL_DATABASE" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL

for migration_file in "$MIGRATIONS_DIR"/*.sql; do
  if [[ ! -e "$migration_file" ]]; then
    echo "No migration files found in $MIGRATIONS_DIR" >&2
    exit 1
  fi

  migration_version="$(basename "$migration_file" .sql)"
  applied_count="$(
    docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER_NAME" \
      mysql -N -uroot "$MYSQL_DATABASE" \
      -e "SELECT COUNT(*) FROM schema_migrations WHERE version = '$migration_version';"
  )"

  if [[ "$applied_count" == "0" ]]; then
    echo "Applying migration: $migration_version"
    docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER_NAME" \
      mysql -uroot "$MYSQL_DATABASE" <"$migration_file"
    docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER_NAME" \
      mysql -uroot "$MYSQL_DATABASE" \
      -e "INSERT INTO schema_migrations (version) VALUES ('$migration_version');"
  else
    echo "Skipping applied migration: $migration_version"
  fi
done

cat <<EOF
MySQL is ready.
Container: $CONTAINER_NAME
Database:  $MYSQL_DATABASE
User:      $MYSQL_USER
Host:      127.0.0.1
Port:      $MYSQL_PORT
EOF
