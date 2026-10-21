# Stacks Role

Deploys the Docker Compose stacks in `stacks/<inventory_hostname>/` to `/opt/stacks/` on the host. It also installs the `stacks` helper command for working with them.

---

## Stack layout

Each subdirectory of `stacks/<host>/` is one stack:

```
stacks/<host>/<stack>/
├── compose.yml      # required, used by `stacks <stack> …`
├── *.j2             # rendered to their basename (e.g. .env.j2 → .env)
├── ansible.yml      # optional tasks, run on deploy (never copied to the host)
├── .stack.yml       # optional deploy config, see below
└── …                # anything else is synced as-is
```

- **Templates**: every `*.j2` within the top two levels of a stack is rendered with the host's variables. Rendered files such as `.env` and `.secrets.yaml` are git-ignored.
- **`ansible.yml`**: a task file included with `stack` set to the stack name, e.g. to seed config in `{{ stacks_data_dir }}/<stack>/`. On remote hosts it only runs when the stack changed (see [Restart rules](#restart-rules) for re-running it on variable changes).

---

## Deployment

### Remote hosts (`ansible_connection != local`)

1. Copy `stacks/<host>/` to a temp directory on the controller, then render its templates and `.stack.yml` files there. Secrets never get written into the repository.
2. Stop (`down`) and delete every stack in `/opt/stacks/` that no longer exists locally.
3. Run a dry-run `rsync --checksum` to find the stacks whose files changed. Only those stacks are deployed, one after another:
   1. Sync the stack directory with `--delete`, excluding `ansible.yml`.
   2. Run the stack's `ansible.yml`.
   3. **If the stack is running**: run `up -d`, apply its [restart rules](#restart-rules), then wait until all containers are running or have exited with code 0.

   A stack that is stopped on the host stays stopped: its files get updated but it is not started.

### Local host (`ansible_connection == local`)

Renders the templates in place, runs every stack's `ansible.yml` and symlinks `/opt/stacks` to `stacks/<host>/`. Stacks are not brought up and `.stack.yml` is ignored.

---

## `.stack.yml`

This file is optional, and only remote deploys use it. It is validated against [`files/stack.schema.json`](files/stack.schema.json), which also supplies its defaults. Editors that support `yaml-language-server` get completion when the file starts with:

```yaml
# yaml-language-server: $schema=../../../roles/stacks/files/stack.schema.json
```

### Restart rules

Some services only read their config on start: password files, mounted extensions, secrets. Changing that config doesn't change the container, so `compose up` leaves it alone. Restart rules fill that gap:

```yaml
restart:
  - services: [mosquitto]        # empty or omitted: all services of the stack
    trigger_variables:           # dotted variable paths, each part may be a glob
      - stacks.mqtt.users        #   e.g. stacks.z2m.*, stacks.*.users
    trigger_files:               # globs relative to the stack dir, ** recurses
      - ansible.yml
      - extensions/**
```

Each rule needs at least one trigger, and each trigger must match at least one variable or file, otherwise the deploy fails.

How it works:

- The `.stack.yml` that gets synced is a resolved copy: each matched variable and file is replaced by its sha256 checksum. Secret values never reach the host, and a changed trigger changes the synced file, which marks the stack as changed. That is also how `ansible.yml`, which is never synced, gets re-run when it or the variables it uses change.
- On deploy, a rule fires if its resolved form differs from the one in the `.stack.yml` currently on the host.
- After `up -d`, the services of all fired rules get restarted, except those that `up` already recreated or started.

---

## The `stacks` command

Installed to `/usr/local/bin/stacks`, with bash completion:

```bash
stacks                  # list stacks
stacks <stack>          # subshell in the stack dir, with `s` as a docker compose shortcut
stacks <stack> <args>   # run `docker compose <args>` for the stack, e.g. stacks mqtt logs -f
```

---

## ⚙️ Variables

| Variable          | Default       | Description                                                               |
|-------------------|---------------|---------------------------------------------------------------------------|
| `stacks_data_dir` | `/var/stacks` | Persistent data root, usually passed to compose as `STACKS_DATA_DIR` via `.env.j2` |

Each stack's own settings conventionally go under `stacks.<stack>` in `host_vars`.

---

## Requirements

- On the controller: `jsonschema` (in `requirements.txt`) and the `ansible.posix` collection (for `synchronize`).
- On the host: Docker with the compose plugin; the role installs `rsync`.
