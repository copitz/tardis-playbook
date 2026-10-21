# Resolves a stack's optional .stack.yml: validates it against
# files/stack.schema.json, fills in the schema's defaults and replaces the
# restart triggers by checksums - each trigger_variables path by
# {matched.var.path: sha256} and each trigger_files glob by {path: sha256}.
# The result gets synced as the stack's .stack.yml, so changed triggers mark
# the stack as changed while no secret values ever reach the host.

import copy
import glob
import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from fnmatch import fnmatchcase

import jsonschema
import yaml
from ansible.errors import AnsibleFilterError
from ansible.module_utils.common.json import AnsibleJSONEncoder

SCHEMA_FILE = os.path.join(os.path.dirname(__file__), '..', 'files', 'stack.schema.json')


def _with_defaults(validator_class):
    validate_properties = validator_class.VALIDATORS['properties']

    def properties(validator, properties, instance, schema):
        if validator.is_type(instance, 'object'):
            for name, subschema in properties.items():
                if 'default' in subschema:
                    instance.setdefault(name, copy.deepcopy(subschema['default']))
        yield from validate_properties(validator, properties, instance, schema)

    return jsonschema.validators.extend(validator_class, {'properties': properties})


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _match_vars(value, segments, path=()):
    if not segments:
        yield '.'.join(path), value
        return
    if isinstance(value, Mapping):
        keys = list(value.keys())
    elif isinstance(value, Sequence) and not isinstance(value, str):
        keys = list(range(len(value)))
    else:
        return
    for key in keys:
        if fnmatchcase(str(key), segments[0]):
            yield from _match_vars(value[key], segments[1:], path + (str(key),))


def _hash_vars(patterns, variables):
    hashes = {}
    for pattern in patterns:
        matches = dict(_match_vars(variables, pattern.split('.')))
        if not matches:
            raise AnsibleFilterError(f"trigger_variables: '{pattern}' matches no variables")
        for path, value in matches.items():
            hashes[path] = _sha256(json.dumps(value, sort_keys=True, cls=AnsibleJSONEncoder, vault_to_text=True).encode())
    return dict(sorted(hashes.items()))


def _hash_files(patterns, stack_dir):
    hashes = {}
    for pattern in patterns:
        paths = [p for p in glob.glob(pattern, root_dir=stack_dir, recursive=True, include_hidden=True)
                 if os.path.isfile(os.path.join(stack_dir, p))]
        if not paths:
            raise AnsibleFilterError(f"trigger_files: '{pattern}' matches no files")
        for path in paths:
            with open(os.path.join(stack_dir, path), 'rb') as f:
                hashes[path] = _sha256(f.read())
    return dict(sorted(hashes.items()))


def resolve_stack_config(stack_dir, variables):
    """stack_dir | resolve_stack_config(hostvars[inventory_hostname])"""
    config_file = os.path.join(stack_dir, '.stack.yml')
    with open(config_file) as f:
        config = yaml.safe_load(f) or {}
    with open(SCHEMA_FILE) as f:
        schema = json.load(f)
    try:
        jsonschema.Draft202012Validator(schema).validate(config)
    except jsonschema.ValidationError as e:
        location = '.'.join(map(str, e.absolute_path)) or '<root>'
        raise AnsibleFilterError(f'{config_file}: {location}: {e.message}')
    _with_defaults(jsonschema.Draft202012Validator)(schema).validate(config)

    try:
        for rule in config['restart']:
            rule['trigger_variables'] = _hash_vars(rule['trigger_variables'], variables)
            rule['trigger_files'] = _hash_files(rule['trigger_files'], stack_dir)
    except AnsibleFilterError as e:
        raise AnsibleFilterError(f'{config_file}: {e.message}')
    return config


class FilterModule:
    def filters(self):
        return {'resolve_stack_config': resolve_stack_config}
