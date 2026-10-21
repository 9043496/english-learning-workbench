#!/usr/bin/env python3
"""Portable, dependency-free local setup. Never downloads or opens a cloud account."""
import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ('english-learning-daily', 'english-learning-coach', 'english-learning-materials',
         'english-learning-audio', 'english-learning-publish', 'english-learning-feedback')


def defaults(home=None):
    home = Path(home or Path.home())
    if sys.platform == 'darwin':
        private = home / 'Library/Application Support/English Learning Workbench'
    elif os.name == 'nt':
        private = Path(os.environ.get('LOCALAPPDATA', home / 'AppData/Local')) / 'English Learning Workbench'
    else:
        private = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'english-learning-workbench'
    return private


def install_skills(hosts, home=None):
    home = Path(home or Path.home())
    targets = {'codex': Path(os.environ.get('CODEX_HOME', home / '.codex')) / 'skills',
               'claude': home / '.claude/skills', 'hermes': home / '.hermes/skills'}
    if hosts == 'auto':
        chosen = [h for h in targets if targets[h].parent.is_dir()]
        if not chosen:
            return {'installed': [], 'note': 'No agent host found; use --skills codex/claude/hermes or open AGENTS.md.'}
    elif hosts == 'none':
        return {'installed': []}
    else:
        chosen = hosts.split(',')
    planned = []
    for host in chosen:
        if host not in targets:
            raise ValueError('Unknown agent host: ' + host)
        for name in NAMES:
            source = ROOT / 'skills' / name
            link = targets[host] / name
            if link.exists() or link.is_symlink():
                if link.is_symlink() and link.resolve() == source.resolve():
                    continue
                raise ValueError('Existing skill preserved; select another host or resolve manually: ' + str(link))
            planned.append((source, link))
    for source, link in planned:
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(source, target_is_directory=True)
    return {'installed': [str(link) for _, link in planned]}


def install(private, hosts='none', home=None):
    private = Path(private).expanduser().resolve()
    if private == ROOT or ROOT in private.parents:
        raise ValueError('Private data/config must be outside the Git checkout.')
    if private.exists() and not (private / 'config.json').exists() and any(private.iterdir()):
        raise ValueError('Choose an empty private directory or an existing workbench installation.')
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != 'nt':
        private.chmod(0o700)
    config = private / 'config.json'
    created = False
    if not config.exists():
        value = {'mode': 'local', 'data_dir': str(private / 'data'),
                 'workspace_dir': str(private / 'workspace'), 'base_url': 'http://127.0.0.1:8780',
                 'time_zone': 'Asia/Seoul', 'profile_file': str(private / 'learner-profile.json')}
        with config.open('x', encoding='utf-8') as stream:
            if os.name != 'nt': os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
        created = True
    profile = private / 'learner-profile.json'
    if not profile.exists():
        with profile.open('x', encoding='utf-8') as stream:
            if os.name != 'nt': os.fchmod(stream.fileno(), 0o600)
            stream.write((ROOT / 'learner-profile.example.json').read_text(encoding='utf-8'))
    registration = install_skills(hosts, home)
    return {'config': str(config), 'created': created, 'skills': registration,
            'next': 'python3 scripts/run.py --config ' + json.dumps(str(config))}


def main():
    parser = argparse.ArgumentParser(description='Install a private local English learning workbench. Python 3.10+ required.')
    parser.add_argument('--private-dir', type=Path, default=defaults())
    parser.add_argument('--skills', default='auto', help='auto, none, codex, claude, hermes, or comma-separated hosts')
    parser.add_argument('--start', action='store_true', help='Run the local server after setup; foreground, Ctrl+C stops')
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        raise SystemExit('Python 3.10+ is required.')
    result = install(args.private_dir, args.skills)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.start:
        raise SystemExit(subprocess.call([sys.executable, str(ROOT / 'scripts/run.py'), '--config', result['config']]))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
