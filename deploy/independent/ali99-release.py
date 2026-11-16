#!/usr/bin/env python3
"""Run and verify an ali99 release before retaining or removing its artifacts."""

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from contextlib import contextmanager
from pathlib import Path

ROOT = Path('/srv/codemaster-oj')
BACKUPS = Path('/srv/codemaster-oj-backups')
LEDGER = BACKUPS / 'ali99-verified-releases.json'
PROJECT = 'campus-judge-ali99'
CA = ROOT / 'deploy/ali99-root-ca.crt'
ORIGIN = 'https://139.196.155.201:8443'
COMPOSE = ROOT / 'deploy/compose.yaml'
OVERRIDE = ROOT / 'deploy/compose.ali99.yaml'
SERVICES = ('web', 'api', 'worker', 'migrate', 'db', 'gateway', 'judge')
APP_SERVICES = ('web', 'api', 'worker', 'migrate')
ARCHIVE = re.compile(r'^(?:ali99-images|images|web-image|web|api|domain|source-updates)\.tar(?:\.gz)?$')
BACKUP_SUFFIXES = ('.dump', '.pgdump', '.pg_dump', '.backup', '.sql', '.sql.gz', '.sql.zst', '.sql.xz',
                   '.dump.gz', '.dump.zst', '.dump.xz', '.pgdump.gz', '.pgdump.zst', '.pgdump.xz',
                   '.backup.gz', '.backup.zst', '.backup.xz')
BACKUP_NAMES = {'db', 'database', 'db-backups', 'database-backups', 'pgdata', 'pg_version',
                'pgbackrest', 'pg_dump', 'toc.dat', 'base.tar', 'base.tar.gz', 'base.tar.zst',
                'dump.rdb', 'backup_manifest'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def output(*argv):
    return subprocess.check_output(argv, text=True).strip()


def release_dir(name):
    require(re.fullmatch(r'[a-z0-9][a-z0-9._-]*', name), f'Invalid release name: {name}')
    path = BACKUPS / name
    require(path.is_dir() and path.resolve() == path, f'Expected a real release directory: {path}')
    return path


@contextmanager
def lock(name):
    with (BACKUPS / name).open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def snapshot():
    ids = output('docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + PROJECT).split()
    require(ids, 'No ali99 containers found')
    result = {}
    for row in json.loads(output('docker', 'inspect', *ids)):
        service = row['Config']['Labels']['com.docker.compose.service']
        if service not in SERVICES:
            continue
        require(service not in result, f'Multiple containers for {service}')
        require(row['State']['Running'] or service == 'migrate' and row['State']['ExitCode'] == 0,
                f'Unhealthy release container: {service}')
        result[service] = {'tag': row['Config']['Image'], 'id': row['Image']}
    require(set(SERVICES) - {'migrate'} <= result.keys(), 'Some required ali99 containers are missing')
    return result


def image_id(tag):
    return output('docker', 'image', 'inspect', '--format', '{{.Id}}', tag)


def check_images(images):
    for service, image in images.items():
        require(image_id(image['tag']) == image['id'], f'Rollback image changed for {service}: {image["tag"]}')


def probe():
    curl = ('curl', '-fsS', '--noproxy', '*', '--max-time', '15', '--cacert', str(CA),
            '--connect-to', '139.196.155.201:8443:127.0.0.1:8443')
    health = json.loads(output(*curl, ORIGIN + '/healthz'))
    require(health.get('ok') is True and health.get('database') is True, 'ali99 API or database is unhealthy')
    html = output(*curl, ORIGIN + '/login')
    asset = re.search(r'<script[^>]+src="(/_next/static/[^"<>]+\.js)"', html)
    require(asset, 'ali99 login did not return the Web application')
    output(*curl, '-o', '/dev/null', ORIGIN + asset[1])


def load_history():
    require(LEDGER.is_file(), 'Run bootstrap once before deploying through this entry point')
    records = json.loads(LEDGER.read_text())
    require(len(records) >= 2 and len({r['name'] for r in records}) == len(records), 'Invalid release history')
    return records


def save_history(records):
    with tempfile.NamedTemporaryFile(mode='w', dir=LEDGER.parent, prefix=LEDGER.name + '.', delete=False) as stream:
        temp = Path(stream.name)
        try:
            json.dump(records, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
            temp.replace(LEDGER)
        finally:
            temp.unlink(missing_ok=True)


def record(name, images, before):
    introduced = [images[s]['id'] for s in APP_SERVICES if s in images and images[s] != before.get(s)]
    return {'name': name, 'images': images, 'introduced': introduced}


def bootstrap(current, previous, prior_compose):
    require(not LEDGER.exists(), 'Verified release history already exists')
    current_dir = release_dir(current)
    release_dir(previous)
    require(current != previous, 'Current and previous release names must differ')
    prior = current_dir / prior_compose
    require(prior.parent == current_dir and prior.is_file() and prior.resolve() == prior,
            'The previous Compose override must be in the current release directory')
    current_images = snapshot()
    config = json.loads(output('docker', 'compose', '-p', PROJECT, '--env-file', str(ROOT / 'deploy/.env'),
                               '-f', str(COMPOSE), '-f', str(prior), 'config', '--format', 'json'))
    previous_images = dict(current_images)
    for service in current_images:
        tag = config['services'][service].get('image', current_images[service]['tag'])
        previous_images[service] = {'tag': tag, 'id': image_id(tag)}
    check_images(current_images)
    probe()
    save_history([record(previous, previous_images, {}), record(current, current_images, previous_images)])
    print(json.dumps({'current': current, 'previous': previous, 'health': 'passed'}))


def backup_name(path):
    return any(part.lower() in BACKUP_NAMES or part.lower().endswith(BACKUP_SUFFIXES)
               for part in Path(path).parts)


def check_archive(path, protected_tags, source=False):
    """Only ordinary source and Docker save archives are eligible for deletion."""
    manifest = None
    source_files = False
    members = set()
    with tarfile.open(path, 'r|*') as archive:
        for entry in archive:
            if not entry.isfile():
                continue
            name = entry.name.removeprefix('./')
            members.add(name)
            # Plain .sql includes source migrations in legitimate source packages.
            require(not backup_name(name) or source and re.fullmatch(r'packages/domain/migrations/[^/]+\.sql', name),
                    f'Possible database backup in {path}: {name}')
            if source:
                require(not archive_name(name), f'Nested archive in {path}: {name}')
            if name.endswith(('apps/web/package.json', 'apps/api/package.json')):
                source_files = True
            if name == 'manifest.json' and not source:
                manifest = json.load(archive.extractfile(entry))
    if source:
        require(source_files, f'Could not identify source archive: {path}')
    else:
        require(isinstance(manifest, list) and manifest, f'Could not identify Docker save archive: {path}')
        tags = set()
        for item in manifest:
            require(isinstance(item, dict) and isinstance(item.get('Config'), str)
                    and isinstance(item.get('Layers'), list) and item['Layers']
                    and isinstance(item.get('RepoTags'), list) and item['RepoTags'],
                    f'Unexpected Docker image manifest: {path}')
            require(all(isinstance(member, str) and member.removeprefix('./') in members
                        for member in (item['Config'], *item['Layers'])), f'Missing Docker image data: {path}')
            require(all(isinstance(tag, str) for tag in item['RepoTags']), f'Unexpected Docker tags: {path}')
            tags.update(item['RepoTags'])
        require(tags and not tags & protected_tags, f'Archive has no tags or references a retained image: {path}')


def check_staging(staging, protected_tags):
    require(staging.is_dir() and staging.resolve() == staging, f'Unexpected staging directory: {staging}')
    for path in staging.rglob('*'):
        require(not path.is_symlink() and (path.is_dir() or path.is_file()),
                f'Non-regular staging entry: {path}')
        # A staging tree is exclusively for disposable build files. Preserve
        # any unexpected archive or backup-looking material for manual review.
        require(not backup_name(path.relative_to(staging)), f'Possible database backup in staging: {path}')
        if path.is_file() and ARCHIVE.fullmatch(path.name):
            check_archive(path, protected_tags, source=path.name.startswith('source-updates.'))
        elif path.is_file():
            require(not archive_name(path.name), f'Unrecognized archive in staging: {path}')


def archive_name(path):
    suffixes = ('.tar', '.tgz', '.zip', '.gz', '.zst', '.xz', '.7z', '.bz2', '.tbz2', '.txz', '.rar')
    name = path.lower().removesuffix('.part').removesuffix('.tmp')
    return name.endswith(suffixes)


def identity(path):
    info = path.lstat()
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def candidates(records):
    current, previous = records[-1], records[-2]
    kept = [image for release in (current, previous) for image in release['images'].values()]
    protected_ids = {image['id'] for image in kept}
    for item in records[:-2]:
        if protected_ids.intersection(item['introduced']):
            continue
        path = release_dir(item['name'])
        for folder in (path, path / 'ali99'):
            if folder.is_dir() and folder.resolve() == folder:
                yield from sorted(item for item in folder.iterdir() if ARCHIVE.fullmatch(item.name))


def cleanup(records):
    current, previous = records[-1], records[-2]
    protected_tags = {image['tag'] for release in (current, previous) for image in release['images'].values()}
    free_before = shutil.disk_usage(BACKUPS).free
    removed, skipped = [], []
    for path in candidates(records):
        try:
            require(path.is_file() and path.resolve() == path, f'Expected a regular archive: {path}')
            before = identity(path)
            check_archive(path, protected_tags, source=path.name.startswith('source-updates.'))
            require(identity(path) == before, f'Archive changed during inspection: {path}')
            path.unlink()
            removed.append(str(path))
        except (OSError, RuntimeError, tarfile.TarError, ValueError, EOFError) as error:
            skipped.append({'path': str(path), 'reason': str(error)})
    for item in records:
        staging = release_dir(item['name']) / 'staging'
        if not staging.exists() and not staging.is_symlink():
            continue
        try:
            check_staging(staging, protected_tags)
            shutil.rmtree(staging)
            removed.append(str(staging))
        except (OSError, RuntimeError, tarfile.TarError, ValueError, EOFError) as error:
            skipped.append({'path': str(staging), 'reason': str(error)})
    return {'removed': removed, 'preservedForReview': skipped,
            'freeBeforeMiB': free_before // (1 << 20), 'freeAfterMiB': shutil.disk_usage(BACKUPS).free // (1 << 20)}


def run_release(name):
    work = release_dir(name)
    records = load_history()
    require(name not in {entry['name'] for entry in records}, 'Use a new directory for each release')
    activate, verify = work / 'activate', work / 'verify'
    for path in (activate, verify):
        require(path.is_file() and path.resolve() == path and os.access(path, os.X_OK),
                f'Expected an executable file: {path}')

    # Legacy activators take this same lock themselves. The separate run lock
    # serializes entry-point runs; hand the old lock to the activator here.
    with lock('ali99-release.lock'):
        before = snapshot()
        require(before == records[-1]['images'], 'Live images differ from the last verified release')
        check_images(before)
        rollback = work / 'rollback'
        rollback.mkdir()
        shutil.copyfile(COMPOSE, rollback / COMPOSE.name)
        shutil.copyfile(OVERRIDE, rollback / OVERRIDE.name)
        shutil.copyfile(ROOT / 'RELEASE', rollback / 'RELEASE')
        (rollback / 'images.json').write_text(json.dumps(before, indent=2) + '\n')
    subprocess.run([activate], cwd=work, check=True)

    with lock('ali99-release.lock'):
        after = snapshot()
        (rollback / 'activated-images.json').write_text(json.dumps(after, indent=2) + '\n')
        verify_release(work, records, before, after)


def verify_release(work, records, before, after):
    verify = work / 'verify'
    require(verify.is_file() and verify.resolve() == verify and os.access(verify, os.X_OK),
            f'Expected an executable file: {verify}')
    require(snapshot() == after, 'Live images differ from the activated release')
    subprocess.run([verify], cwd=work, check=True)
    require(snapshot() == after, 'Live images changed during verification')
    check_images(before)
    check_images(after)
    probe()
    records.append(record(work.name, after, before))
    save_history(records)
    report = cleanup(records)
    probe()
    print(json.dumps({'current': work.name, 'previous': records[-2]['name'], **report}, indent=2))


def resume_release(name):
    work = release_dir(name)
    records = load_history()
    require(name not in {entry['name'] for entry in records}, 'Release is already verified')
    rollback = work / 'rollback'
    before = json.loads((rollback / 'images.json').read_text())
    after = json.loads((rollback / 'activated-images.json').read_text())
    require(before == records[-1]['images'], 'The previous verified release has changed')
    verify_release(work, records, before, after)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    seed = commands.add_parser('bootstrap')
    seed.add_argument('current')
    seed.add_argument('previous')
    seed.add_argument('--prior-compose', default='prior-compose.private.yaml')
    for name in ('run', 'resume'):
        commands.add_parser(name).add_argument('release')
    commands.add_parser('status')
    args = parser.parse_args()
    if args.command == 'status':
        with lock('ali99-release.lock'):
            records = load_history()
            require(snapshot() == records[-1]['images'], 'Live images differ from the last verified release')
            check_images(records[-2]['images'])
            probe()
            print(json.dumps({'current': records[-1]['name'], 'previous': records[-2]['name'],
                              'archiveCandidates': [str(path) for path in candidates(records)],
                              'freeMiB': shutil.disk_usage(BACKUPS).free // (1 << 20), 'health': 'passed'}, indent=2))
        return
    with lock('ali99-release-run.lock'):
        if args.command == 'bootstrap':
            with lock('ali99-release.lock'):
                bootstrap(args.current, args.previous, args.prior_compose)
        elif args.command == 'resume':
            with lock('ali99-release.lock'):
                resume_release(args.release)
        else:
            run_release(args.release)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError, ValueError) as error:
        raise SystemExit(f'ali99-release: {error}')
