#!/bin/bash
set -e

export LC_ALL="C.UTF-8" 

VENV=".venv"

if [ ! -d "$VENV" ]; then
  # Make sure python venv package is installed (Debian needs it)
  if ! dpkg -s python3-venv >/dev/null 2>&1; then
    echo "Installing python3-venv (required for virtual environments)..."
    sudo apt-get update
    sudo apt-get install -y python3-venv
  fi
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"

if ! python -c "import ansible" &>/dev/null; then
  pip install --upgrade pip
  pip install -r requirements.txt
  ansible-galaxy collection install -r requirements.yml
fi

# Handle special flags
if [ "$1" == "--list" ]; then
  ansible-playbook site.yml -i inventory --list-tags
  exit 0
fi

# Handle dry-run flag
FLAGS=()
TAGS=()
for arg in "$@"; do
  if [ "$arg" == "--dry-run" ] || [ "$arg" == "-d" ]; then
    FLAGS+=("--check")
  elif [[ "$arg" == -* ]]; then
    echo "Error: Unknown flag '$arg'" >&2
    exit 1
  else
    TAGS+=("$arg")
  fi
done

# If tags are given, run only those tags
if [ ${#TAGS[@]} -gt 0 ]; then
  TAGS_CSV=$(IFS=,; echo "${TAGS[*]}")
  FLAGS+=("--tags" "$TAGS_CSV")
  
else
  # By default, skip manual roles
  FLAGS+=("--skip-tags" "manual")
fi

ansible-playbook site.yml -i inventory --ask-become-pass "${FLAGS[@]}"
