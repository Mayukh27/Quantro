#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Stopping Quantro..."

STOPPED=false

if [ -f "pids/backend.pids" ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
      pkill -P "$pid" 2>/dev/null || true
      kill -9 "$pid" 2>/dev/null || true
      echo "Stopped backend pid $pid"
      STOPPED=true
    fi
  done < pids/backend.pids

  rm -f pids/backend.pids
fi

while IFS= read -r pid; do
  if [ -n "$pid" ]; then
    kill -9 "$pid" 2>/dev/null || true
    STOPPED=true
  fi
done < <(ps -eo pid=,args= | awk '/app\.jar/ && !/awk/ {print $1}')

if [ "$STOPPED" = false ]; then
  echo "No backend processes found."
fi

if pgrep -x nginx >/dev/null 2>&1; then
  pkill -x nginx 2>/dev/null || true
  echo "Stopped nginx."
else
  echo "nginx was not running."
fi

rm -f logs/nginx.pid 2>/dev/null || true

echo ""
echo "Quantro stopped."
