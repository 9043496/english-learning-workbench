#!/usr/bin/env python3
"""Run only the configured local service. No system launch agents or Tailscale setup."""
import argparse
import json
import sys
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'local'))
from server import make_server
from install import defaults


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=defaults() / 'config.json')
    parser.add_argument('--port', type=int)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    if config.get('mode') != 'local':
        raise SystemExit('This command starts local mode. See docs/cloud.md for cloud deployment.')
    address = urlsplit(config['base_url'])
    if address.scheme != 'http' or address.hostname not in ('127.0.0.1', 'localhost'):
        raise SystemExit('Local starter binds loopback only; configure HTTPS separately for phone access.')
    server = make_server(config['data_dir'], '127.0.0.1', args.port if args.port is not None else address.port or 8780)
    url = 'http://127.0.0.1:' + str(server.server_port)
    print(json.dumps({'ok': True, 'url': url + '/open-local', 'health': url + '/health', 'data_dir': config['data_dir']}, ensure_ascii=False), flush=True)
    if args.open: webbrowser.open(url + '/open-local')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__':
    main()
