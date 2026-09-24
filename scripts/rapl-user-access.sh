#!/usr/bin/env bash
# Make Intel RAPL energy counters readable by normal users (fastfetch CPU W row).
# Installs a udev rule so /sys/class/powercap/intel-rapl:*/energy_uj is world-readable.
# Needs root; re-execs via sudo when not. Idempotent.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || exec sudo -- "$0" "$@"

RULES=/etc/udev/rules.d/99-rapl-readable.rules
CONTENT='SUBSYSTEM=="powercap", ACTION=="add|change", KERNEL=="intel-rapl:*", RUN+="/bin/chmod -R a+r /sys/class/powercap/%k"'

if [ "$(cat "$RULES" 2>/dev/null || true)" != "$CONTENT" ]; then
  printf '%s\n' "$CONTENT" > "$RULES"
  echo "wrote $RULES"
else
  echo "$RULES already current"
fi

chmod -R a+r /sys/class/powercap/intel-rapl* 2>/dev/null || true
udevadm control --reload-rules
udevadm trigger --subsystem-match=powercap

target=$(ls -d /sys/class/powercap/intel-rapl:*/energy_uj 2>/dev/null | head -n1 || true)
if [ -n "$target" ] && sudo -u "${SUDO_USER:-$USER}" cat "$target" >/dev/null 2>&1; then
  echo "OK: $target readable"
else
  echo "WARN: still not readable (kernel may require CAP_SYS_ADMIN)"
fi
