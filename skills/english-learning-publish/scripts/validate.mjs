/* Offline package checks. No network, credentials, learner writes or human-audio claims. */
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const require=createRequire(import.meta.url),exec=promisify(execFile);
const program=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const R=require(resolve(program,'reading.js')),{check}=require(resolve(program,'tools/check_learning_content.cjs'));
export const sha=data=>createHash('sha256').update(data).digest('hex');
export const normalize=R.normalize;
const nonempty=x=>typeof x==='string'&&!!x.trim();
export async function within(folder,name){
 if(!nonempty(name)||isAbsolute(name))throw Error('PATH_OUTSIDE_LESSON');
 const root=await realpath(folder),file=await realpath(resolve(root,name)),rel=relative(root,file);
 if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('PATH_OUTSIDE_LESSON');
 return file;
}
export function mimeOf(data){
 const tag=data.subarray(0,4).toString('ascii');
 if(tag==='RIFF'&&data.subarray(8,12).toString('ascii')==='WAVE')return 'audio/wav';
 if(tag==='OggS')return 'audio/ogg';
 if(data.subarray(4,8).toString('ascii')==='ftyp')return 'audio/mp4';
 if(data.subarray(0,4).toString('hex')==='1a45dfa3')return 'audio/webm';
 if(data.subarray(0,3).toString('ascii')==='ID3'||data[0]===255&&(data[1]&224)===224)return 'audio/mpeg';
 return null;
}
export async function validate(lessonPath,{textOnly=false}={}){
 const source=await readFile(lessonPath),lesson=JSON.parse(source),folder=dirname(await realpath(lessonPath));
 const errors=[],warnings=[],files=[],need=(ok,code)=>{if(!ok)errors.push(code);};
 need(lesson.version===1,'INVALID_HANDOFF_VERSION');
 const p=lesson.input,g=lesson.sentences;
 need(p&&g&&Array.isArray(g.items)&&g.items.length>0,'MISSING_INPUT_OR_SENTENCES');
 if(!p||!g||!Array.isArray(g.items))return {result:'FAIL',errors,warnings,files};
 need(/^daily_\d{8}_0[12]$/.test(p.id||'')&&p.id.slice(6,14)===(p.date||'').replaceAll('-',''),'INVALID_DAILY_ID');
 need(/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&new Date(p.date+'T00:00:00Z').toISOString().slice(0,10)===p.date,'INVALID_DATE');
 need(!p.type||p.type==='daily','DAILY_ONLY');
 need(!['audio','audio_full','audio_blob_key','sentences'].some(k=>Object.hasOwn(p,k)),'USE_CANONICAL_AUDIOKEY_AND_SENTENCE_COLLECTION');
 need(nonempty(p.level)&&nonempty(p.title)&&nonempty(p.audioKey),'MISSING_INPUT_FIELDS');
 const body=(Array.isArray(p.body)?p.body:[]).map(b=>typeof b==='string'?b:b?.text||'').join('\n\n');
 const count=R.lex(body).length;need(count>=250&&count<=350&&p.word_count===count,'ACTUAL_WORD_COUNT_MISMATCH');
 let content;
 try{content=check(lesson);errors.push(...content.errors.map(e=>'CONTENT:'+e));warnings.push(...content.warnings);}
 catch{errors.push('CONTENT_CHECK_FAILED');}
 const units=R.units(p,g.items);need(!units.some(u=>!u.mapped&&R.lex(u.text).length),'UNMAPPED_BODY_WORDS');
 need(g.items.every(s=>Number.isInteger(s.n)&&s.n>0&&nonempty(s.text)&&nonempty(s.cn)&&nonempty(s.speaker)&&nonempty(s.audioKey)),'INVALID_SENTENCE');
 for(const group of ['comprehension','polysemy'])for(const q of p[group]||[]){
  need((q.options||[]).every(o=>nonempty(o.id)&&nonempty(o.text)),'EMPTY_OPTION');
  need(new Set((q.options||[]).map(o=>o.text?.trim().toLowerCase())).size===4,'DUPLICATE_OPTION_TEXT');
 }
 const ids=[...(p.comprehension||[]),...(p.polysemy||[])].map(q=>q.id);need(new Set(ids).size===ids.length,'DUPLICATE_QUESTION_ID');
 need(lesson.teaching&&nonempty(lesson.teaching.selection_reason),'MISSING_TEACHING_REASON');
 const provenance=lesson.source||{};
 need(['human_original','human_adapted','ai_authored'].includes(provenance.kind),'INVALID_SOURCE_KIND');
 for(const name of ['title','author','use_basis','checked_at','adaptation_note'])need(nonempty(provenance[name]),'MISSING_SOURCE_'+name.toUpperCase());
 if(provenance.kind!=='ai_authored'){
  try{need(/^https?:$/.test(new URL(provenance.url).protocol),'INVALID_SOURCE_URL');}catch{errors.push('INVALID_SOURCE_URL');}
 }else need(nonempty(provenance.fallback_reason),'MISSING_HUMAN_SOURCE_SEARCH_REASON');
 if(p.reused_vocab!==undefined){
  need(Array.isArray(p.reused_vocab)&&p.reused_vocab.length>=3&&p.reused_vocab.length<=5,'INVALID_REUSED_VOCAB_COUNT');
  const terms=(p.reused_vocab||[]).map(v=>typeof v==='string'?v:v?.w||'');
  need(new Set(terms.map(R.normalize)).size===terms.length,'DUPLICATE_REUSED_VOCAB');
  need(terms.every(t=>nonempty(t)&&(' '+R.normalize(body)+' ').includes(' '+R.normalize(t)+' ')),'REUSED_WORD_NOT_IN_BODY');
 }
 if(!textOnly){
  const audio=lesson.audio||{};need(nonempty(audio.model)&&audio.voices&&Object.keys(audio.voices).length>0,'MISSING_VOICE_MODEL');
  need(nonempty(audio.style_family)&&nonempty(audio.style_approval_evidence),'MISSING_STYLE_APPROVAL_EVIDENCE');
  for(const name of ['direction_file','text_review_evidence'])try{
   const data=await readFile(await within(folder,audio[name]));need(data.length>0,'EMPTY_AUDIO_EVIDENCE');
  }catch{errors.push('MISSING_AUDIO_'+name.toUpperCase());}
  const entries=Array.isArray(audio.files)?audio.files:[],keys=entries.map(f=>f.key);
  const expected=[p.audioKey,...g.items.map(s=>s.audioKey)];
  need(new Set(expected).size===expected.length,'REUSED_SENTENCE_AUDIOKEY');
  need(new Set(keys).size===keys.length&&keys.length===expected.length&&expected.every(k=>keys.includes(k)),'AUDIO_MANIFEST_COVERAGE');
  for(const entry of entries)try{
   need(nonempty(entry.key)&&entry.key.startsWith(p.id+'/')&&entry.key.length<=200,'AUDIO_KEY_NOT_NAMESPACED');
   const file=await within(folder,entry.file),data=await readFile(file),mime=mimeOf(data),digest=sha(data);
   need(data.length>0&&data.length<=25000000,'AUDIO_SIZE');
   need(mime===entry.mime&&!!mime,'AUDIO_MIME');need(digest===entry.sha256,'AUDIO_DIGEST');
   const extensions={'audio/wav':['.wav'],'audio/mpeg':['.mp3'],'audio/mp4':['.mp4','.m4a'],'audio/webm':['.webm'],'audio/ogg':['.ogg','.opus']};
   need(extensions[mime]?.includes(extname(file).toLowerCase()),'AUDIO_EXTENSION');
   const probe=JSON.parse((await exec(process.env.FFPROBE||'ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',file],{timeout:30000,maxBuffer:1000000})).stdout);
   const seconds=Number(probe.format?.duration);need(seconds>0&&probe.streams?.some(s=>s.codec_type==='audio'),'AUDIO_DURATION');
   await exec(process.env.FFMPEG||'ffmpeg',['-v','error','-i',file,'-f','null','-'],{timeout:60000,maxBuffer:1000000});
   files.push({key:entry.key,file:entry.file,mime,size:data.length,sha256:digest,duration_seconds:seconds});
  }catch{errors.push('AUDIO_FILE_FAILED:'+String(entry.key||'missing'));}
  need(new Set(files.map(f=>f.sha256)).size===files.length,'DUPLICATED_AUDIO_BYTES');
 }
 return {version:1,time:new Date().toISOString(),input_id:p.id,date:p.date,lesson_sha256:sha(source),mode:textOnly?'text-only':'complete',result:errors.length?'FAIL':textOnly?'TEXT_ONLY_PASS':'TECHNICAL_PASS',environment:{node:process.version,platform:process.platform,arch:process.arch,classification:'非真机；结构、当前ReadingLogic、文件hash和ffmpeg解码。来源许可/题义/听感为agent审查，未证明Chrome或Safari验收'},actual_word_count:count,content,files,errors,warnings,declared_review:{source:provenance.use_basis,audio:lesson.audio?.text_review_evidence,style:lesson.audio?.style_approval_evidence}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const path=resolve(process.argv[2]),report=await validate(path,{textOnly:process.argv.includes('--text-only')});
  await writeFile(resolve(dirname(path),process.argv.includes('--text-only')?'正文校验.json':'技术校验.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:report.result,input_id:report.input_id,errors:report.errors,warnings:report.warnings}));
  if(report.errors.length)process.exitCode=1;
 }catch{console.error('教材校验停止：文件/JSON/运行依赖不完整；未发布。');process.exitCode=1;}
}
