"""One short TTS preview; key remains in memory and is never logged or saved."""
import argparse, base64, getpass, hashlib, json, re, subprocess, urllib.error, urllib.request, wave
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT='https://generativelanguage.googleapis.com/v1beta/models/'
MODEL='gemini-3.1-flash-tts-preview'

def run(folder):
    request_path=folder/'试听请求_无凭证.json'
    payload=json.loads(request_path.read_text())
    key=getpass.getpass('API Key（隐藏输入）: ')
    request=urllib.request.Request(ENDPOINT+MODEL+':generateContent',data=json.dumps(payload).encode(),
        headers={'Content-Type':'application/json','x-goog-api-key':key},method='POST')
    print('正在生成短试听；仅发送本次请求。',flush=True)
    report={'time':datetime.now(timezone.utc).isoformat(),'model':MODEL,'requests':1,
        'request_sha256':hashlib.sha256(request_path.read_bytes()).hexdigest(),
        'authorization':'David提供Key并明确要求直接调用；随后确认不必继续核实额度，未授权变更计费设置',
        'billing_settings_changed':False,'key_saved':False,'human_review':'待David试听，不以接口成功判断自然度'}
    try:
        with urllib.request.urlopen(request,timeout=180) as response:
            result=json.load(response);report['http_status']=response.status
    except urllib.error.HTTPError as error:
        try:detail=json.loads(error.read()).get('error',{})
        except Exception:detail={}
        report.update(result='FAIL',http_status=error.code,status=detail.get('status'),
            reasons=[x.get('reason') for x in detail.get('details',[]) if x.get('reason')])
        (folder/'Gemini试听_接口与音频证据.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False));return 1
    except Exception as error:
        report.update(result='FAIL',error_type=type(error).__name__)
        (folder/'Gemini试听_接口与音频证据.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False));return 1
    parts=[p['inlineData'] for c in result.get('candidates',[]) for p in c.get('content',{}).get('parts',[]) if p.get('inlineData',{}).get('mimeType','').startswith('audio/')]
    if not parts:
        report.update(result='FAIL',error='NO_AUDIO',finish_reasons=[c.get('finishReason') for c in result.get('candidates',[])])
        (folder/'Gemini试听_接口与音频证据.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False));return 1
    if len({p['mimeType'] for p in parts})!=1:raise ValueError('Mixed audio formats; preview not saved')
    mime=parts[0]['mimeType'];data=b''.join(base64.b64decode(p['data'],validate=True) for p in parts)
    output=folder/'Gemini双人对话_短试听.wav'
    if data[:4]==b'RIFF':output.write_bytes(data)
    elif 'l16' in mime.lower() or 'pcm' in mime.lower():
        rate=re.search(r'rate=(\d+)',mime)
        if not rate:raise ValueError('Audio sample rate missing')
        with wave.open(str(output),'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(int(rate.group(1)));audio.writeframes(data)
    else:raise ValueError('Unsupported audio format; refusing to guess extension')
    with wave.open(str(output),'rb') as audio:
        seconds=audio.getnframes()/audio.getframerate()
        assert seconds>5 and audio.getnchannels()==1 and audio.getsampwidth()==2
        report.update(duration_seconds=round(seconds,3),sample_rate=audio.getframerate(),channels=audio.getnchannels())
    ffmpeg='ffmpeg'
    subprocess.run([ffmpeg,'-v','error','-i',str(output),'-f','null','-'],check=True,capture_output=True)
    mp3=folder/'Gemini双人对话_短试听.mp3'
    subprocess.run([ffmpeg,'-v','error','-y','-i',str(output),'-c:a','libmp3lame','-b:a','128k',str(mp3)],check=True,capture_output=True)
    report.update(result='TECHNICAL_PASS',mime=mime,audio_bytes=len(data),
        wav_sha256=hashlib.sha256(output.read_bytes()).hexdigest(),mp3_sha256=hashlib.sha256(mp3.read_bytes()).hexdigest(),
        usage=result.get('usageMetadata',{}),post_processing='仅封装WAV与MP3编码，无变速、无补停顿、无音效',
        official_lesson_replaced=False,device_gate='新试听未获Mac Chrome或iPhone Safari真机认可')
    (folder/'Gemini试听_接口与音频证据.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);args=parser.parse_args()
    raise SystemExit(run(args.folder))
