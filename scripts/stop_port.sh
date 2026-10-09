#!/usr/bin/env bash
# Stop whatever is listening on a TCP port (Windows, Git Bash). Usage: scripts/stop_port.sh 3100
port="$1"
for pid in $(netstat -ano | grep "LISTENING" | grep ":$port " | awk '{print $5}' | sort -u); do
  taskkill //F //PID "$pid" >/dev/null 2>&1 && echo "stopped $pid on :$port"
done
