#!/usr/bin/env python3
"""Discovers the current LVM configuration and outputs it as YAML for Ansible."""
import json
import os
import re
import shutil
import subprocess
import sys
import yaml

# lvm2 tools live in /sbin or /usr/sbin which may not be in PATH when run via Ansible script module
os.environ['PATH'] = '/usr/sbin:/sbin:/usr/bin:/bin:' + os.environ.get('PATH', '')


def find_bin(name):
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"'{name}' not found in PATH ({os.environ['PATH']})")
    return path


def run(cmd):
    cmd[0] = find_bin(cmd[0])
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def get_vgs():
    out = run(['vgs', '--noheadings', '--reportformat', 'json',
               '-o', 'vg_name,pv_name,vg_extent_size', '--units', 'm'])
    rows = json.loads(out)['report'][0]['vg']
    vgs = {}
    for row in rows:
        name = row['vg_name'].strip()
        if name not in vgs:
            pesize_m = float(re.sub(r'[^\d.]', '', row['vg_extent_size']))
            vgs[name] = {'name': name, 'pvs': [], 'pesize': f'{int(pesize_m)}M'}
        vgs[name]['pvs'].append(row['pv_name'].strip())
    for vg in vgs.values():
        vg['pvs'] = ','.join(vg['pvs'])
    return list(vgs.values())


def get_lvs():
    out = run(['lvs', '--noheadings', '--reportformat', 'json',
               '-o', 'lv_name,vg_name,lv_size', '--units', 'g'])
    rows = json.loads(out)['report'][0]['lv']
    lvs = []
    for row in rows:
        size_g = float(row['lv_size'].strip().rstrip('gG'))
        size = f'{size_g:g}G'
        lvs.append({'name': row['lv_name'].strip(), 'vg': row['vg_name'].strip(), 'size': size})
    return lvs


def lv_key(source):
    """Extract (vg, lv) from a device path, handling /dev/mapper/vg-lv and /dev/vg/lv."""
    # /dev/mapper uses doubled hyphens for literal hyphens in names
    mapper = re.match(r'/dev/mapper/(.+)', source)
    if mapper:
        raw = mapper.group(1)
        # Split on single hyphens (not doubled ones), then un-double
        parts = re.split(r'(?<!-)-(?!-)', raw, maxsplit=1)
        if len(parts) == 2:
            return (parts[0].replace('--', '-'), parts[1].replace('--', '-'))
    direct = re.match(r'/dev/([^/]+)/([^/]+)', source)
    if direct:
        return (direct.group(1), direct.group(2))
    return None


def get_fstab_mounts():
    mounts = {}
    with open('/etc/fstab') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            fields = line.split()
            if len(fields) < 4:
                continue
            source, target, fstype, opts = fields[0], fields[1], fields[2], fields[3]
            fsck_pass = int(fields[5]) if len(fields) >= 6 else 0
            key = lv_key(source)
            if key:
                mounts[key] = {'mount': target, 'fs': fstype, 'opts': opts, 'fsck_pass': fsck_pass}
    return mounts


try:
    vgs = get_vgs()
    lvs = get_lvs()
    mounts = get_fstab_mounts()

    lvm_lvs = []
    for lv in lvs:
        entry = dict(lv)
        mount_info = mounts.get((lv['vg'], lv['name']))
        if mount_info:
            entry.update(mount_info)
        lvm_lvs.append(entry)

    class IndentedDumper(yaml.Dumper):
        def increase_indent(self, flow=False, **_):
            return super().increase_indent(flow, False)

    def dump_block(key, value):
        return yaml.dump({key: value}, Dumper=IndentedDumper,
                         default_flow_style=False, sort_keys=False, allow_unicode=True)

    sys.stdout.write(dump_block('lvm_vgs', vgs) + '\n' + dump_block('lvm_lvs', lvm_lvs))
except Exception as e:
    sys.stderr.write(str(e) + '\n')
    sys.exit(1)
