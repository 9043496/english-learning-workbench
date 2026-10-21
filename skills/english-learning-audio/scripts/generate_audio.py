"""Supervised Gemini TTS generation for fixed, reviewed daily manifests.

The API key is read from the central private credentials vault after consent.
This script generates files only; it does not declare listening approval or publish.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_BASE = Path(os.environ.get('WORKBENCH_WORKSPACE_DIR', Path.home() / '.local/share/english-learning-workbench/workspace'))
MODEL = os.environ.get('GEMINI_TTS_MODEL', 'gemini-3.1-flash-tts-preview')
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent'
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json_atomic(path, value):
    temp = path.with_name(path.name + '.tmp')
    with open(temp, 'w') as f:
        os.fchmod(f.fileno(), 0o600)
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(temp, path)


def payload_for(entry):
    if entry['kind'] == 'full':
        voices = entry['voices']
        speech = {'multiSpeakerVoiceConfig': {'speakerVoiceConfigs': [
            {'speaker': speaker, 'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}
            for speaker, voice in voices.items()
        ]}}
        text = entry['prompt'] + '\n\n' + entry['text']
    else:
        speech = {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': entry['voice']}}}
        text = entry['prompt']
    return {'contents': [{'role': 'user', 'parts': [{'text': text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': speech}}


def request_audio(key, payload):
    request = urllib.request.Request(ENDPOINT, data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read()).get('error', {})
            reason = [x.get('reason') for x in detail.get('details', []) if isinstance(x, dict)]
        except Exception:
            detail, reason = {}, []
        raise RuntimeError('GEMINI_HTTP_' + str(error.code) + ':' + str(detail.get('status') or 'unknown') + ':' + ','.join(x for x in reason if x))
    except Exception as error:
        raise RuntimeError('GEMINI_NETWORK_' + type(error).__name__)
    pieces = [part['inlineData'] for candidate in result.get('candidates', [])
        for part in candidate.get('content', {}).get('parts', [])
        if part.get('inlineData', {}).get('mimeType', '').lower().startswith('audio/')]
    if not pieces:
        raise RuntimeError('GEMINI_NO_AUDIO_' + ','.join(str(c.get('finishReason', 'unknown')) for c in result.get('candidates', [])))
    mime = pieces[0]['mimeType']
    if any(p['mimeType'] != mime for p in pieces):
        raise RuntimeError('GEMINI_MIXED_AUDIO_FORMATS')
    data = b''.join(base64.b64decode(p['data'], validate=True) for p in pieces)
    return data, mime, result.get('usageMetadata', {})


def encode_mp3(data, mime, output):
    asset_dir = output.parent
    asset_dir.mkdir(mode=0o700, exist_ok=True)
    wav_path = output.with_suffix('.wav.tmp')
    mp3_path = output.with_suffix('.mp3.tmp')
    try:
        if data[:4] == b'RIFF':
            wav_path.write_bytes(data)
        elif 'l16' in mime.lower() or 'pcm' in mime.lower():
            matched = re.search(r'rate=(\d+)', mime, re.I)
            if not matched:
                raise RuntimeError('AUDIO_SAMPLE_RATE_MISSING')
            rate = int(matched.group(1))
            with wave.open(str(wav_path), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(rate)
                audio.writeframes(data)
        else:
            raise RuntimeError('UNSUPPORTED_AUDIO_FORMAT')
        os.chmod(wav_path, 0o600)
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(wav_path), '-c:a', 'libmp3lame',
            '-b:a', '128k', '-f', 'mp3', str(mp3_path)], check=True, capture_output=True, timeout=120)
        probe = subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
            '-of', 'json', str(mp3_path)], check=True, capture_output=True, timeout=30)
        metadata = json.loads(probe.stdout)
        duration = float(metadata['format']['duration'])
        if duration <= 0 or not any(s['codec_type'] == 'audio' for s in metadata.get('streams', [])):
            raise RuntimeError('AUDIO_DECODE_FAILED')
        subprocess.run([FFMPEG, '-v', 'error', '-i', str(mp3_path), '-f', 'null', '-'],
            check=True, capture_output=True, timeout=120)
        os.chmod(mp3_path, 0o600)
        os.replace(mp3_path, output)
        return duration
    finally:
        wav_path.unlink(missing_ok=True)
        mp3_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--day-dir', type=Path, required=True)
    parser.add_argument('--phase', choices=['full', 'sentences', 'dry-run'], required=True)
    args = parser.parse_args()
    root = args.day_dir.resolve()
    if not root.is_relative_to(OUTPUT_BASE.resolve()) or root.name != '每日教材' or not root.is_dir():
        raise RuntimeError('DAY_DIRECTORY_BLOCKED')
    manifests = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        lesson_path = folder / 'lesson.json'
        manifest = json.loads((folder / '音频制作请求_无凭证.json').read_text())
        if digest(lesson_path.read_bytes()) != manifest['lesson_sha256'] or manifest['model'] != MODEL:
            raise RuntimeError('MANIFEST_OR_LESSON_CHANGED:' + folder.name)
        manifests.append((folder, manifest))
    total = sum(len(m['requests']) for _, m in manifests)
    print('FIXED_MANIFESTS_VERIFIED', len(manifests), total, flush=True)
    if args.phase == 'dry-run':
        return
    key = os.environ.get('GEMINI_API_KEY', '')
    key_file = os.environ.get('GEMINI_API_KEY_FILE')
    if not key and key_file:
        secret = Path(key_file).expanduser().resolve()
        if os.name != 'nt' and stat.S_IMODE(secret.stat().st_mode) & 0o077:
            raise RuntimeError('CREDENTIAL_FILE_MUST_BE_0600')
        key = secret.read_text().strip()
    if not key:
        raise RuntimeError('GEMINI_CREDENTIAL_REQUIRED')
    try:
        for folder, manifest in manifests:
            evidence_path = folder / '音频生成证据.json'
            evidence = json.loads(evidence_path.read_text()) if evidence_path.exists() else {
                'model': MODEL, 'lesson_sha256': manifest['lesson_sha256'], 'files': []}
            if evidence['lesson_sha256'] != manifest['lesson_sha256'] or evidence['model'] != MODEL:
                raise RuntimeError('EVIDENCE_CONFLICT:' + folder.name)
            for entry in manifest['requests']:
                if args.phase == 'full' and entry['kind'] != 'full':
                    continue
                if args.phase == 'sentences' and entry['kind'] != 'sentence':
                    continue
                basename = 'full.mp3' if entry['kind'] == 'full' else 'sentence-' + str(entry['n']).zfill(2) + '.mp3'
                output = folder / 'assets' / basename
                payload = payload_for(entry)
                prompt_sha = digest(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode())
                old = next((f for f in evidence['files'] if f['key'] == entry['key']), None)
                if old:
                    if not output.exists() or digest(output.read_bytes()) != old['sha256'] or old['request_sha256'] != prompt_sha:
                        raise RuntimeError('EXISTING_FILE_CONFLICT:' + entry['key'])
                    print('SKIP_VERIFIED', entry['key'], flush=True)
                    continue
                if output.exists():
                    raise RuntimeError('UNRECORDED_EXISTING_FILE:' + entry['key'])
                data, mime, usage = request_audio(key, payload)
                duration = encode_mp3(data, mime, output)
                evidence['files'].append({'key': entry['key'], 'file': 'assets/' + basename,
                    'mime': 'audio/mpeg', 'sha256': digest(output.read_bytes()),
                    'bytes': output.stat().st_size, 'duration_seconds': duration,
                    'request_sha256': prompt_sha, 'provider_mime': mime,
                    'usage': usage, 'generated_at': datetime.now(timezone.utc).isoformat()})
                write_json_atomic(evidence_path, evidence)
                print('GENERATED', entry['key'], round(duration, 2), flush=True)
                time.sleep(1)
    finally:
        key = None


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        print(message if re.fullmatch(r'[A-Z0-9_:/.-]+', message) else 'AUDIO_GENERATION_STOPPED_DETAILS_WITHHELD', file=sys.stderr)
        raise SystemExit(1)
