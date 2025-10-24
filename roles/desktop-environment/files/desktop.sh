#!/usr/bin/env bash
set -euo pipefail

# desktop: small CLI for KDE/SDDM + DPMS control via power button
# subcommands:
#   power-btn-press   — smart toggle on ACPI power button
#   start             — start SDDM (on-demand desktop)
#   stop              — stop SDDM (kills GUI session)
#   wake              — wake monitors (via user unit)
#   sleep             — turn monitors off (via user unit)
#   activate          — bring the active session to foreground
#   status            — print current state

log() { logger -t desktop "$*"; echo "desktop: $*"; }

seat="seat0"
RETURN_TO_TTY=2

active_session() {
  loginctl show-seat "$seat" -p ActiveSession --value 2>/dev/null || true
}

session_user() {
  local sid="$1"
  loginctl show-session "$sid" -p Name --value 2>/dev/null || true
}

session_locked() {
  local sid="$1"
  [[ "$(loginctl show-session "$sid" -p LockedHint --value 2>/dev/null || echo no)" == "yes" ]]
}

sddm_active() {
  systemctl is-active --quiet sddm.service
}

userctl() {
  # Run a user unit in that user's lingering systemd
  local user="$1"; shift
  systemctl --user -M "${user}@" "$@"
}

wake_monitors() {
  local u="$1"
  userctl "$u" start kscreen-dpms-on.service || true
}

sleep_monitors() {
  local u="$1"
  userctl "$u" start kscreen-dpms-off.service || true
}

activate_session() {
  local sid="$1"
  loginctl activate "$sid" || true
}

cmd_start() {
  log "Starting SDDM"
  systemctl start sddm.service
}

cmd_stop() {
  log "Stopping SDDM"
  systemctl stop sddm.service
  sleep 2
  chvt $RETURN_TO_TTY
  /usr/local/bin/tty-blank $RETURN_TO_TTY & disown
}

cmd_wake() {
  local sid u
  sid="$(active_session)"
  [[ -n "$sid" ]] || { log "No active session to wake"; exit 0; }
  u="$(session_user "$sid")"
  activate_session "$sid"
  wake_monitors "$u"
}

cmd_sleep() {
  local sid u
  sid="$(active_session)"
  [[ -z "$sid" ]] && exit 0
  u="$(session_user "$sid")"
  sleep_monitors "$u"
}

cmd_status() {
  local sid u locked="n/a" sddm="inactive"
  sid="$(active_session)"
  if [[ -n "$sid" ]]; then
    u="$(session_user "$sid")"
    if session_locked "$sid"; then locked="yes"; else locked="no"; fi
  else
    u="n/a"
  fi
  if sddm_active; then sddm="active"; fi
  echo "sddm=$sddm session=$sid user=$u locked=$locked"
}

cmd_power_btn_press() {
  # Logic:
  # - if SDDM is inactive → start it
  # - if SDDM active and session locked → activate + wake monitors
  # - if SDDM active and not locked → stop it
  local sid u
  if ! sddm_active; then
    log "Power button: SDDM inactive → start"
    cmd_start
    return
  fi

  sid="$(active_session)"
  if [[ -z "$sid" ]]; then
    log "Power button: SDDM active but no session on $seat → start anyway"
    cmd_start
    return
  fi

  u="$(session_user "$sid")"
  if session_locked "$sid"; then
    log "Power button: session locked → activate + wake monitors"
    activate_session "$sid"
    wake_monitors "$u"
  else
    log "Power button: session unlocked → stop SDDM"
    cmd_stop
  fi
}

case "${1:-}" in
  power-btn-press) shift; cmd_power_btn_press "$@";;
  on)              shift; cmd_start "$@";;
  off)             shift; cmd_stop "$@";;
  wake)            shift; cmd_wake "$@";;
  sleep)           shift; cmd_sleep "$@";;
  activate)        shift; sid="$(active_session)"; [[ -n "$sid" ]] && activate_session "$sid";;
  status)          shift; cmd_status;;
  ""|-h|--help)    echo "Usage: desktop <power-btn-press|start|stop|wake|sleep|activate|status>";;
  *)               echo "Unknown subcommand: $1" >&2; exit 2;;
esac