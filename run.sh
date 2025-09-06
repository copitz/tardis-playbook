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
  pip install ansible
  ansible-galaxy collection install -r requirements.yml
fi

ansible-playbook site.yml -i inventory --ask-become-pass
