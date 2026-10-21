#!/usr/bin/env python3
"""Read-only dependency/configuration check. Does not print credential values."""
import argparse
import json
import shutil
import sys
from pathlib import Path
from install import defaults

parser = argparse.ArgumentParser()
parser.add_argument('--config', type=Path, default=defaults() / 'config.json')
args = parser.parse_args()
checks = {'python_3_10_plus': sys.version_info >= (3, 10), 'node_optional_for_tests_and_agent_tools': bool(shutil.which('node')),
          'ffmpeg_optional_for_audio': bool(shutil.which('ffmpeg')), 'ffprobe_optional_for_audio': bool(shutil.which('ffprobe')),
          'config_exists': args.config.is_file()}
print(json.dumps(checks, indent=2))
raise SystemExit(0 if checks['python_3_10_plus'] and checks['config_exists'] else 1)
