import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('workbench_installer', ROOT / 'scripts/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fresh_install_has_no_learner_records_or_credentials(self):
        result = installer.install(self.root / 'private')
        config = json.loads(Path(result['config']).read_text())
        self.assertEqual(config['mode'], 'local')
        self.assertFalse(Path(config['data_dir']).exists())
        self.assertNotIn('password', json.dumps(config))
        self.assertEqual(result['skills']['installed'], [])

    def test_reinstall_preserves_custom_configuration_and_profile(self):
        result = installer.install(self.root / 'private')
        config = Path(result['config'])
        value = json.loads(config.read_text()); value['base_url'] = 'http://127.0.0.1:9999'
        config.write_text(json.dumps(value)); profile = config.parent / 'learner-profile.json'
        profile.write_text('{"name":"custom learner"}')
        again = installer.install(self.root / 'private')
        self.assertFalse(again['created'])
        self.assertEqual(json.loads(config.read_text())['base_url'], value['base_url'])
        self.assertEqual(profile.read_text(), '{"name":"custom learner"}')

    def test_private_data_cannot_enter_checkout_or_unrelated_nonempty_directory(self):
        with self.assertRaises(ValueError): installer.install(ROOT / 'var/unsafe-private')
        marker = self.root / 'unrelated.txt'; marker.write_text('preserve this file')
        with self.assertRaises(ValueError): installer.install(self.root)
        self.assertEqual(marker.read_text(), 'preserve this file')

    @unittest.skipIf(os.name == 'nt', 'symlink privileges not verified on Windows')
    def test_agent_links_use_actual_skill_sources_and_reinstall_is_idempotent(self):
        with patch.dict(os.environ, {'CODEX_HOME': str(self.root / '.codex')}):
            result = installer.install_skills('codex,claude,hermes', self.root)
            self.assertEqual(len(result['installed']), 18)
            for item in result['installed']:
                link = Path(item)
                self.assertTrue(link.is_symlink())
                self.assertEqual(link.resolve(), ROOT / 'skills' / link.name)
            self.assertEqual(installer.install_skills('codex,claude,hermes', self.root)['installed'], [])

    def test_existing_skill_conflict_causes_no_registration_changes(self):
        host = self.root / '.claude/skills'; host.mkdir(parents=True)
        conflict = host / 'english-learning-feedback'; conflict.mkdir()
        marker = conflict / 'SKILL.md'; marker.write_text('existing user content')
        with self.assertRaises(ValueError): installer.install_skills('claude', self.root)
        self.assertEqual(list(host.iterdir()), [conflict])
        self.assertEqual(marker.read_text(), 'existing user content')

    def test_real_empty_service_starts_with_own_database_and_authenticated_page(self):
        result = installer.install(self.root / 'private')
        process = subprocess.Popen([sys.executable, '-B', str(ROOT / 'scripts/run.py'), '--config', result['config'], '--port', '0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            line = process.stdout.readline()
            self.assertTrue(line, process.stderr.read() if process.poll() is not None else 'missing startup line')
            started = json.loads(line)
            self.assertTrue(json.load(urllib.request.urlopen(started['health'], timeout=5))['ok'])
            session = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
            html = session.open(started['url'], timeout=5).read().decode()
            for section in ('今日学习', '跟读录音', '生词本', '学习进度'):
                self.assertIn(section, html)
            base = started['health'].removesuffix('/health')
            self.assertEqual(json.load(session.open(base + '/api/records/inputs')), [])
            self.assertEqual(json.load(session.open(base + '/api/records/progress')), [])
            self.assertEqual(json.load(session.open(base + '/api/records/vocab')), [])
            settings = Path(started['data_dir']) / 'settings.json'
            if os.name != 'nt': self.assertEqual(settings.stat().st_mode & 0o777, 0o600)
        finally:
            process.terminate(); process.communicate(timeout=8)

    def test_no_implicit_public_listener_or_cloud_boot(self):
        result = installer.install(self.root / 'private'); config = Path(result['config'])
        value = json.loads(config.read_text()); value['base_url'] = 'http://0.0.0.0:8780'; config.write_text(json.dumps(value))
        run = subprocess.run([sys.executable, str(ROOT / 'scripts/run.py'), '--config', str(config)], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(run.returncode, 0); self.assertIn('loopback', run.stderr)
        value['mode'] = 'cloud'; config.write_text(json.dumps(value))
        run = subprocess.run([sys.executable, str(ROOT / 'scripts/run.py'), '--config', str(config)], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(run.returncode, 0); self.assertIn('cloud deployment', run.stderr)


if __name__ == '__main__': unittest.main()
