#!/usr/bin/env python3
"""Package and unpack a coordinated, stopped-writer backup. Never restores live SQL/Bao."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import uuid
from datetime import datetime, timezone

IMAGE = 'chrislusf/seaweedfs:4.52@sha256:57877e32bb90073b37dc109b438ba66e84fd5ed9ced5f5c04f56444ef243ce59'
PAYLOADS = ('sql.bak', 'openbao.snap', 'deletions.json', 'inventory.json', 'seaweed.tar')


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def outside_repo(path):
    path = path.expanduser().resolve()
    root = Path(__file__).resolve().parents[2]
    if path == root or root in path.parents:
        raise ValueError('Backup and machine data must be outside Git')
    return path


def pack(state, output, sources):
    state, output = outside_repo(state), outside_repo(output)
    if output.exists():
        raise ValueError('Choose a new backup directory')
    inventory = json.loads(sources['inventory.json'].read_text())
    if inventory.get('verified') is not True:
        raise ValueError('A successful object verification inventory is required')
    ledger = json.loads(sources['deletions.json'].read_text())
    if not isinstance(ledger.get('userIds'), list):
        raise ValueError('A cumulative deletion ledger is required')
    # A cold archive includes filer metadata, master state and volume contents/indexes.
    subprocess.run(['docker', 'compose', '-f', str(state / 'compose.yaml'), 'stop'], check=True)
    output.mkdir(mode=0o700, parents=True)
    for name, source in sources.items():
        shutil.copyfile(source, output / name)
        (output / name).chmod(0o600)
    with tarfile.open(output / 'seaweed.tar', 'w') as archive:
        archive.add(state / 'data', arcname='data')
    (output / 'seaweed.tar').chmod(0o600)
    application_commit = subprocess.check_output(['git', '-C', str(Path(__file__).resolve().parents[2]), 'rev-parse', 'HEAD'], text=True).strip()
    manifest = {'applicationCommit': application_commit, 'backupSet': str(uuid.uuid4()), 'createdAt': datetime.now(timezone.utc).isoformat(),
                'schema': 22, 'seaweedImage': IMAGE, 'openbaoVersion': '2.7.1',
                'files': {name: checksum(output / name) for name in PAYLOADS}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'manifest.json').chmod(0o600)
    return manifest


def validate(bundle):
    manifest = json.loads((bundle / 'manifest.json').read_text())
    if manifest['seaweedImage'] != IMAGE or set(manifest['files']) != set(PAYLOADS):
        raise ValueError('Unsupported backup manifest')
    for name in PAYLOADS:
        if checksum(bundle / name) != manifest['files'][name]:
            raise ValueError('Backup checksum mismatch: ' + name)
    return manifest


def unpack(bundle, state):
    bundle, state = outside_repo(bundle), outside_repo(state)
    manifest = validate(bundle)
    if (state / 'data').exists() and any((state / 'data').iterdir()):
        raise ValueError('Refusing to overwrite existing storage data')
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tarfile.open(bundle / 'seaweed.tar') as archive:
        for member in archive.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != 'data' or Path(member.name).is_absolute() or '..' in parts or not (member.isdir() or member.isfile()):
                raise ValueError('Unsafe archive member')
            target = state / member.name
            if target.is_symlink() or state not in target.resolve().parents and target.resolve() != state:
                raise ValueError('Refusing archive symlink or linked parent')
        # Extract manually: do not restore foreign ownership or permissive secret modes.
        for member in archive.getmembers():
            target = state / member.name
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o600)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('pack', 'unpack', 'validate', 'repair-permissions'))
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--state', type=Path)
    parser.add_argument('--sql', type=Path)
    parser.add_argument('--bao', type=Path)
    parser.add_argument('--ledger', type=Path)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--writers-stopped', action='store_true', help='Assert all backends/workers/admin writes are stopped throughout SQL/Bao capture and packaging')
    args = parser.parse_args()
    if args.operation != 'validate' and not args.writers_stopped:
        parser.error('--writers-stopped is required; see the coordinated backup runbook')
    if args.operation == 'pack':
        if any(value is None for value in (args.state, args.sql, args.bao, args.ledger, args.inventory)):
            parser.error('pack requires --state, --sql, --bao, --ledger and --inventory')
        result = pack(args.state, args.bundle, dict(zip(PAYLOADS[:4], (args.sql, args.bao, args.ledger, args.inventory))))
    elif args.operation == 'unpack':
        if args.state is None:
            parser.error('unpack requires --state')
        result = unpack(args.bundle, args.state)
    elif args.operation == 'repair-permissions':
        if args.state is None:
            parser.error('repair-permissions requires --state')
        state = outside_repo(args.state)
        if (state / 'data').is_symlink() or not (state / 'data').is_dir():
            raise ValueError('Permission repair requires a real data directory')
        # Only this explicit data mount, never parent folders or keys. Arbitrary host UID/GID works on Linux and Docker Desktop.
        subprocess.run(['docker', 'run', '--rm', '--user', '0:0', '--entrypoint', '/bin/sh', '-v', str(state / 'data') + ':/repair', IMAGE, '-ec', 'chown -R "$1:$2" /repair; find /repair -type d -exec chmod 700 {} +; find /repair -type f -exec chmod 600 {} +', 'repair', str(os.getuid()), str(os.getgid())], check=True)
        result = {'permissionsRepaired': True}
    else:
        result = validate(args.bundle)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
