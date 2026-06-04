#!/usr/bin/env bash
# /usr/local/bin/stacks
#
# Stack environment manager for vortex infrastructure.
#
# Usage:
#   stacks                    List available stacks
#   stacks <name>             Open a subshell with the stack environment activated
#   stacks <name> <command>   Run a one-off command in the stack environment
#
# Inside the subshell:
#   s <cmd>             docker compose wrapper (e.g. s up -d, s logs -f)
#   stacks <name>       Switch to another stack (replaces current subshell)
#   exit                Leave the stack environment
#
# Install:
#   sudo install -m 755 stacks /usr/local/bin/stacks

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

STACKS_DIR="/opt/stacks"
ENV_FILE="$STACKS_DIR/.env"

# Determine how this script was invoked so help text and the internal
# `stacks` wrapper call the script the same way the user invoked it.
# We prefer to call the script the same way: if it was invoked as the
# installed `stacks` command, use that. Otherwise, if the script path
# is executable, call it directly; if not, prefix with `bash` so the
# suggestion and subshell delegation work even without +x bit.
if [[ "${0##*/}" == "stacks" ]]; then
  INVOKE_EXEC="stacks"
  INVOKE_ARG0=""
else
  SCRIPT_INVOC="${0:-${BASH_SOURCE[0]:-stacks}}"
  if [[ -x "$SCRIPT_INVOC" ]]; then
    INVOKE_EXEC="$SCRIPT_INVOC"
    INVOKE_ARG0=""
  else
    INVOKE_EXEC="bash"
    INVOKE_ARG0="$SCRIPT_INVOC"
  fi
fi

# ── No argument: list available stacks ───────────────────────────────────────

if [[ -z "${1:-}" ]]; then
  if [[ ! -d "$STACKS_DIR" ]]; then
    echo "Error: stacks directory not found: $STACKS_DIR" >&2
    exit 1
  fi

  found=0
  echo "Available stacks:"
  for d in "$STACKS_DIR"/*/; do
    [[ -d "$d" ]] || continue
    found=1
    printf '  %s\n' "$(basename "${d%/}")"
  done

  if [[ $found -eq 0 ]]; then
    echo "No stacks found in $STACKS_DIR"
  else
    echo
    if [[ -n "$INVOKE_ARG0" ]]; then
      echo "To enter a stack, run: $INVOKE_EXEC $INVOKE_ARG0 <name>"
    else
      echo "To enter a stack, run: $INVOKE_EXEC <name>"
    fi
  fi

  exit 0
fi

# ── With argument: either run a command or open a subshell for the selected stack ─────

STACK_NAME="$1"
STACK_DIR="$STACKS_DIR/$STACK_NAME"

if [[ ! -d "$STACK_DIR" ]]; then
  echo "Error: stack '$STACK_NAME' not found under $STACKS_DIR" >&2
  exit 1
fi

shift

if [[ $# -gt 0 ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
  fi

  cd "$STACK_DIR"
  exec docker compose -f "$STACK_DIR/compose.yml" "$@"
  exit 0
fi

echo "Entering stack $STACK_DIR"
echo "Type 'exit' to leave."

# Write a temporary rcfile that bash --rcfile will source in the subshell.
# The file is removed automatically when this script exits (via trap).
_rcfile=$(mktemp /tmp/stacks-init-XXXXXX)
trap 'rm -f "$_rcfile"' EXIT

cat > "$_rcfile" << RCFILE
# ── Load node-level environment ───────────────────────────────────────────────
# set -a / set +a exports all variables defined in the env file automatically
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# ── Stack context ─────────────────────────────────────────────────────────────
export STACK_NAME="$STACK_NAME"
export STACK_DIR="$STACK_DIR"

cd "$STACK_DIR"

# ── Prompt ────────────────────────────────────────────────────────────────────
PS1="\[\e[36m\][s:$STACK_NAME]\[\e[0m\] \u@\h:\w\$ "

# ── Compose wrapper ───────────────────────────────────────────────────────────
# Thin wrapper around docker compose that always targets the current stack.
s() {
  docker compose -f "$STACK_DIR/compose.yml" "\$@"
}

# ── Stack switcher (replaces subshell via exec) ───────────────────────────────
# Calling 'stacks <name>' inside the subshell uses exec to replace the current
# shell process, so there is always only one subshell level to exit from.
stacks() {
  if [[ -z "\${1:-}" ]]; then
    # No argument: show listing (delegate to the installed binary)
    if [[ -n "${INVOKE_ARG0}" ]]; then
      command "${INVOKE_EXEC}" "${INVOKE_ARG0}"
    else
      command "${INVOKE_EXEC}"
    fi
    return
  fi
  # Replace this subshell with a new stacks invocation
  if [[ -n "${INVOKE_ARG0}" ]]; then
    exec "${INVOKE_EXEC}" "${INVOKE_ARG0}" "\$1"
  else
    exec "${INVOKE_EXEC}" "\$1"
  fi
}

# ── Tab completion: s ─────────────────────────────────────────────────────────

_s_services() {
  docker compose -f "$STACK_DIR/compose.yml" config --services 2>/dev/null
}

_s_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local subcommands="up down restart stop start pull logs exec run ps \
    build config images kill pause unpause port rm top version"

  if [[ \$COMP_CWORD -eq 1 ]]; then
    COMPREPLY=(\$(compgen -W "\$subcommands" -- "\$cur"))
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
    up)
      COMPREPLY=(\$(compgen -W "-d --detach --build --remove-orphans \
        --force-recreate \$(_s_services)" -- "\$cur"))
      ;;
    logs)
      COMPREPLY=(\$(compgen -W "-f --follow --tail --no-log-prefix \
        \$(_s_services)" -- "\$cur"))
      ;;
    exec)
      COMPREPLY=(\$(compgen -W "-it -T --user --workdir \
        \$(_s_services)" -- "\$cur"))
      ;;
    down)
      COMPREPLY=(\$(compgen -W "--volumes --remove-orphans --rmi \
        \$(_s_services)" -- "\$cur"))
      ;;
    *)
      COMPREPLY=(\$(compgen -W "\$(_s_services)" -- "\$cur"))
      ;;
  esac
}

complete -F _s_complete s
source /etc/bash_completion.d/stacks
RCFILE

# Launch subshell with the generated rcfile.
# --rcfile replaces the normal ~/.bashrc for this shell instance.
exec bash --rcfile "$_rcfile"
