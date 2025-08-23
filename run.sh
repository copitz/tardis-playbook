#!/bin/bash
set -e

VENV=".venv"

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"

if ! python -c "import ansible" &>/dev/null; then
  pip install --upgrade pip
  pip install ansible
fi

ansible-playbook site.yml -i inventory --ask-become-pass
