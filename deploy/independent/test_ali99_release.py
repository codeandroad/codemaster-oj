import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('ali99-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def images(**services):
    return {name: {'tag': tag, 'id': 'sha256:' + tag} for name, tag in services.items()}


def archive(path, files):
    with tarfile.open(path, 'w:gz') as result:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            result.addfile(member, io.BytesIO(content))
    return path


class ReleaseCleanupTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.ledger = self.root / 'history.json'
        paths = patch.multiple(release, BACKUPS=self.root, LEDGER=self.ledger)
        paths.start()
        self.addCleanup(paths.stop)

    def directory(self, name):
        path = self.root / name
        path.mkdir()
        return path

    def test_removes_only_verified_obsolete_archives_and_disposable_staging(self):
        oldest, shared, previous, current, unverified = (
            self.directory(name) for name in ('oldest', 'shared', 'previous', 'current', 'unverified')
        )
        old_images = images(web='web:old')
        shared_images = images(web='web:shared', api='api:shared')
        previous_images = images(web='web:previous', api='api:shared')
        current_images = images(web='web:current', api='api:shared')
        records = [
            release.record(oldest.name, old_images, {}),
            release.record(shared.name, shared_images, old_images),
            release.record(previous.name, previous_images, shared_images),
            release.record(current.name, current_images, previous_images),
        ]
        obsolete = archive(oldest / 'source-updates.tar.gz', {
            'apps/web/package.json': b'{}', 'packages/domain/migrations/001_schema.sql': b'SELECT 1;'
        })

        def saved_image(path, tag):
            manifest = [{'RepoTags': [tag], 'Config': 'config.json', 'Layers': ['layer.tar']}]
            return archive(path, {
                'manifest.json': json.dumps(manifest).encode(),
                'config.json': b'{}',
                'layer.tar': b'layer files',
            })
        kept = [
            saved_image(oldest / 'web.tar.gz', 'web:previous'),
            archive(oldest / 'domain.tar.gz', {'db/campus.dump': b'PGDMP'}),
            saved_image(shared / 'images.tar.gz', 'api:shared'),
            saved_image(previous / 'images.tar.gz', 'web:previous'),
            saved_image(current / 'images.tar.gz', 'web:current'),
            saved_image(unverified / 'images.tar.gz', 'web:unfinished'),
            oldest / 'after-verification.dump',
        ]
        kept[-1].write_bytes(b'PGDMP')
        staging = current / 'staging'
        staging.mkdir()
        (staging / 'build-output.tmp').write_text('temporary')
        backup_stage = previous / 'staging'
        backup_stage.mkdir()
        kept.append(backup_stage / 'emergency.sql.gz')
        kept[-1].write_bytes(b'compressed backup')

        result = release.cleanup(records)

        self.assertCountEqual(result['removed'], [str(obsolete), str(staging)])
        self.assertTrue(all(file.is_file() for file in kept))
        self.assertEqual(len(result['preservedForReview']), 3)

    def test_failed_verification_keeps_history_and_artifacts(self):
        previous = self.directory('previous')
        current = self.directory('current')
        candidate = self.directory('candidate')
        verifier = candidate / 'verify'
        verifier.write_text('#!/bin/sh\nexit 2\n')
        verifier.chmod(0o700)
        old = images(web='web:previous')
        before = images(web='web:current')
        after = images(web='web:candidate')
        records = [release.record(previous.name, old, {}), release.record(current.name, before, old)]
        release.save_history(records)
        with patch.object(release, 'snapshot', return_value=after), patch.object(release, 'cleanup') as cleanup:
            with self.assertRaises(subprocess.CalledProcessError):
                release.verify_release(candidate, records, before, after)
        cleanup.assert_not_called()
        self.assertEqual(release.load_history()[-1]['name'], current.name)

    def test_projection_grant_failure_keeps_release_unverified(self):
        previous = self.directory('previous')
        current = self.directory('current')
        candidate = self.directory('candidate')
        verifier = candidate / 'verify'
        verifier.write_text('#!/bin/sh\nexit 0\n')
        verifier.chmod(0o700)
        old = images(web='web:previous')
        before = images(web='web:current')
        after = images(web='web:candidate')
        records = [release.record(previous.name, old, {}), release.record(current.name, before, old)]
        release.save_history(records)
        with patch.object(release, 'snapshot', return_value=after), patch.object(release, 'check_images'), \
                patch.object(release, 'output', return_value='f') as probe_command, \
                patch.object(release, 'cleanup') as cleanup:
            with self.assertRaisesRegex(RuntimeError, 'learner problem projection grants'):
                release.verify_release(candidate, records, before, after)
        self.assertEqual(probe_command.call_args.args[:3], ('docker', 'exec', release.PROJECT + '-db-1'))
        cleanup.assert_not_called()
        self.assertEqual(release.load_history()[-1]['name'], current.name)

    def test_probe_checks_https_after_validating_projection_grants(self):
        with patch.object(release, 'output', side_effect=[
            't', '{"ok":true,"database":true}', '<script src="/_next/static/chunks/app.js"></script>', '',
        ]) as probe_command:
            release.probe()
        self.assertEqual([call.args[-1] for call in probe_command.call_args_list[1:]], [
            release.ORIGIN + path for path in ('/healthz', '/login', '/_next/static/chunks/app.js')
        ])

    def test_run_verifies_before_rotating_releases_and_clearing_artifacts(self):
        previous = self.directory('previous')
        current = self.directory('current')
        candidate = self.directory('candidate')
        obsolete = archive(previous / 'source-updates.tar.gz', {'apps/web/package.json': b'{}'})
        (candidate / 'activate').write_text('#!/bin/sh\ntouch activated\n')
        (candidate / 'verify').write_text(f'#!/bin/sh\ntest -f activated && test -f "{obsolete}"\n')
        for step in ('activate', 'verify'):
            (candidate / step).chmod(0o700)
        compose = self.root / 'compose.yaml'
        override = self.root / 'compose.ali99.yaml'
        for file in (compose, override, self.root / 'RELEASE'):
            file.write_text('old')
        old = images(web='web:previous')
        before = images(web='web:current')
        after = images(web='web:candidate')
        release.save_history([release.record(previous.name, old, {}), release.record(current.name, before, old)])
        with patch.multiple(release, ROOT=self.root, COMPOSE=compose, OVERRIDE=override), \
                patch.object(release, 'snapshot', side_effect=[before, after, after, after]), \
                patch.object(release, 'check_images'), patch.object(release, 'probe'), patch('builtins.print'):
            release.run_release(candidate.name)
        self.assertEqual([entry['name'] for entry in release.load_history()], ['previous', 'current', 'candidate'])
        self.assertFalse(obsolete.exists())
        self.assertEqual((candidate / 'rollback' / 'compose.yaml').read_text(), 'old')


if __name__ == '__main__':
    unittest.main()
