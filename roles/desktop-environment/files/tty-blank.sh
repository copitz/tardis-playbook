#!/bin/bash
# Immediately blank a Linux console and wake on input

set -e

exec > >(systemd-cat -t tty-blank) 2>&1

TTY_NUM=${1:-$(</sys/class/tty/tty0/active | sed 's/tty//')}
TTY_DEV="/dev/tty$TTY_NUM"

if [[ ! -e $TTY_DEV ]]; then
  echo "[tty-screen-blank] Error: $TTY_DEV not found"
  exit 1
fi

log() { echo "[tty-screen-blank] $*"; }

log "Blanking $TTY_DEV"
TERM=linux setterm --blank force < "$TTY_DEV"

# Collect all keyboard+mouse devices
EVENTS=$(grep -B5 -E "EV=(120013|12|13|17)" /proc/bus/input/devices \
          | grep -Eo "event[0-9]+" \
          | sort -u \
          | sed 's|^|/dev/input/|')

if [[ -z "$EVENTS" ]]; then
  log "No input devices found"
  exit 1
fi

log "Waiting for input on: $EVENTS"

pids=()
for dev in $EVENTS; do
    # Read one input_event struct then exit
    ( dd if="$dev" bs=24 count=1 >/dev/null 2>&1 ) &
  pids+=($!)
done

# Wait until one cat exits because of activity
wait -n "${pids[@]}"

# Kill the remaining cats
kill "${pids[@]}" 2>/dev/null

log "Input detected → waking $TTY_DEV"
TERM=linux setterm --blank poke < "$TTY_DEV"