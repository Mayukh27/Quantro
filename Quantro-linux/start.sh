#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Quantro root: $ROOT_DIR"

if [ ! -f ".env" ]; then
  echo "ERROR: .env not found."
  echo "  Copy .env.template to .env and fill in the required values."
  exit 1
fi

set -a
source ./.env
set +a

JAVA_BIN="${JAVA_BIN:-java}"
JAVA_OPTS="${JAVA_OPTS:--Xms512m -Xmx1024m}"
NGINX_BIN="${NGINX_BIN:-nginx}"
INSTANCES="${INSTANCES:-1}"
BASE_PORT="${BASE_PORT:-18080}"
NGINX_PORT="${NGINX_PORT:-80}"

missing=()
for key in DB_URL DB_USERNAME DB_PASSWORD JWT_SECRET; do
  value="${!key:-}"
  if [ -z "$value" ] || [[ "$value" == your_* ]] || [[ "$value" == replace_* ]]; then
    missing+=("$key")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: Missing or placeholder values in .env:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

resolve_bin() {
  local candidate="$1"
  if [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
  elif command -v "$candidate" >/dev/null 2>&1; then
    command -v "$candidate"
  else
    return 1
  fi
}

JAVA_BIN_RESOLVED="$(resolve_bin "$JAVA_BIN")" || {
  echo "ERROR: '$JAVA_BIN' not found. Install Java 17+ or set JAVA_BIN in .env."
  exit 1
}

NGINX_BIN_RESOLVED="$(resolve_bin "$NGINX_BIN")" || {
  echo "ERROR: '$NGINX_BIN' not found. Install nginx or set NGINX_BIN in .env."
  exit 1
}

echo "Java: $JAVA_BIN_RESOLVED"
echo "Nginx: $NGINX_BIN_RESOLVED"

mkdir -p \
  logs pids cache/images \
  nginx/logs \
  temp/client_body_temp temp/proxy_temp \
  temp/fastcgi_temp temp/scgi_temp temp/uwsgi_temp

NGINX_TEMPLATE="$ROOT_DIR/nginx/nginx.linux.conf.template"
NGINX_CONF="$ROOT_DIR/nginx/nginx.linux.conf"

if [ ! -f "$NGINX_TEMPLATE" ]; then
  echo "ERROR: Missing nginx template: $NGINX_TEMPLATE"
  exit 1
fi

escaped_root=$(printf '%s' "$ROOT_DIR" | sed 's/[&]/\\&/g')
sed \
  -e "s|QUANTRO_ROOT|$escaped_root|g" \
  -e "s|BASE_PORT|$BASE_PORT|g" \
  -e "s|NGINX_PORT|$NGINX_PORT|g" \
  "$NGINX_TEMPLATE" > "$NGINX_CONF"

echo "nginx config written => $NGINX_CONF"

echo "  root               => $escaped_root/build"
echo "  listen             => $NGINX_PORT"

echo ""

echo "Stopping any existing nginx and backend processes..."
pkill -x nginx 2>/dev/null || true
rm -f /run/nginx.pid 2>/dev/null || true

if [ -f "pids/backend.pids" ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" 2>/dev/null || true
      echo "Stopped stale backend pid $pid"
    fi
  done < pids/backend.pids
fi
rm -f pids/backend.pids
pkill -f "$ROOT_DIR/app.jar" 2>/dev/null || true

SPRING_OVERRIDES=(
  "-Dfeatures.admin=${FEATURE_ADMIN:-true}"
  "-Dfeatures.teacher=${FEATURE_TEACHER:-true}"
  "-Dfeatures.analytics=${FEATURE_ANALYTICS:-true}"
  "-Dfeatures.blueprint=${FEATURE_BLUEPRINT:-true}"
  "-Dfeatures.proctor=${FEATURE_PROCTOR:-true}"
  "-Dfeatures.pdf=${FEATURE_PDF:-true}"
  "-Dfeatures.ai=${FEATURE_AI:-false}"
  "-Dfeatures.email=${FEATURE_EMAIL:-false}"
  "-Dexam.proctor.max-violations=${PROCTOR_MAX_VIOLATIONS:-1}"
  "-Dexam.proctor.max-fullscreen-exits=${PROCTOR_MAX_FULLSCREEN_EXITS:-1}"
  "-Dexam.proctor.fullscreen-grace-seconds=${PROCTOR_GRACE_SECONDS:-10}"
  "-Dexam.timer.grace-period-seconds=${EXAM_GRACE_SECONDS:-30}"
)

read -r -a JAVA_OPTS_ARRAY <<< "$JAVA_OPTS"

: > pids/backend.pids
started_ports=()

for i in $(seq 0 $((INSTANCES-1))); do
  port=$((BASE_PORT+i))
  log_out="$ROOT_DIR/logs/backend-$port.log"
  log_err="$ROOT_DIR/logs/backend-$port.err.log"
  nohup "$JAVA_BIN_RESOLVED" "${JAVA_OPTS_ARRAY[@]}" "${SPRING_OVERRIDES[@]}" -jar "$ROOT_DIR/app.jar" --server.port="$port" > "$log_out" 2> "$log_err" &
  pid=$!
  echo "$pid" >> pids/backend.pids
  started_ports+=("$port")
  echo "  Backend instance $((i+1))  port=$port  pid=$pid"
  echo "    log: logs/backend-$port.log"
done

echo ""
echo "Waiting up to 30 seconds for the backend to listen..."
backend_ready=false
for attempt in $(seq 1 15); do
  backend_ready=true
  for port in "${started_ports[@]}"; do
    if ! curl -s "http://127.0.0.1:$port" >/dev/null 2>&1; then
      backend_ready=false
      break
    fi
  done

  if [ "$backend_ready" = true ]; then
    break
  fi

  sleep 2
done

if [ "$backend_ready" = false ]; then
  echo "WARNING: backend did not become reachable within the wait window. Check logs/backend-*.log for details."
fi

echo "Starting nginx..."
if [ "$(id -u)" -ne 0 ]; then
  if ! "$NGINX_BIN_RESOLVED" -p "$ROOT_DIR" -c "$NGINX_CONF" >/dev/null 2>&1; then
    sudo "$NGINX_BIN_RESOLVED" -p "$ROOT_DIR" -c "$NGINX_CONF" >/dev/null 2>&1 || {
      echo "ERROR: nginx failed to start."
      exit 1
    }
  fi
else
  "$NGINX_BIN_RESOLVED" -p "$ROOT_DIR" -c "$NGINX_CONF" >/dev/null 2>&1 || {
    echo "ERROR: nginx failed to start."
    exit 1
  }
fi

sleep 2
if pgrep -x nginx >/dev/null 2>&1; then
  echo "Nginx started successfully"
else
  echo "ERROR: nginx failed to start."
  exit 1
fi

IP=$(hostname -I | awk '{print $1}' | tr -d '\r')

echo ""
echo "Quantro started"
echo "Frontend: http://localhost"
if [ -n "$IP" ]; then
  echo "LAN     : http://$IP"
fi
