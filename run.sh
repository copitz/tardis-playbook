#!/bin/bash
set -e

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

# If args are given, run only those tags
if [ $# -gt 0 ]; then
  TAGS="$*"
  ansible-playbook site.yml -i inventory --ask-become-pass --tags "$TAGS"
else
  # By default, skip manual roles
  ansible-playbook site.yml -i inventory --ask-become-pass --skip-tags manual
fi
