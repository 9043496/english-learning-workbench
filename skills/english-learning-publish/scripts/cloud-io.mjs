/* Uses existing authorized Mac CLI only to establish the fixed formal coach.
 * All content traffic then uses that coach through the existing restricted API. */
import {readFile,writeFile,mkdir,rm,realpath,open} from 'node:fs/promises';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {validate,within,sha,normalize} from './validate.mjs';
import {connect,loadConfig} from './runtime.mjs';
const hub=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const project=resolve(loadConfig(true)?.workspace_dir||resolve(hub,'var'));
export const seoulDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const stop=code=>{throw Error(code);};
function canonical(c,row){
 if(row===null)return null;
 const value=structuredClone(row);
 if(c==='inputs')delete value.audio_full;
 if(c==='sentences')for(const s of value.items||[])delete s.audio;
 return value;
}
export async function withDayLock(root,date,fn){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))stop('INVALID_DATE');
 await mkdir(root,{recursive:true,mode:0o700});const folder=resolve(root,date+'.release.lock');
 try{await mkdir(folder,{mode:0o700});}catch(e){if(e.code==='EEXIST')stop('DAY_LOCKED_CHECK_PREVIOUS_RUN');throw e;}
 try{await writeFile(resolve(folder,'owner.json'),JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}),{mode:0o600,flag:'wx'});return await fn();}
 finally{await rm(folder,{recursive:true});}
}
export async function snapshot(api){
 const pending=await api.json('/api/coach/pending');
 const sentences=await api.json('/api/records/sentences');
 if(!Array.isArray(pending.inputs)||!Array.isArray(pending.vocab)||!Array.isArray(sentences))stop('SNAPSHOT_SHAPE');
 return {...pending,sentences,fetched_at:new Date().toISOString()};
}
export async function releaseLesson(path,{api,date=seoulDate(),lockRoot=resolve(project,'_tmp/每日教材')}={}){
 const report=await validate(path);
 if(report.result!=='TECHNICAL_PASS')stop('PACKAGE_CHECK_FAILED');
 const raw=await readFile(path);if(sha(raw)!==report.lesson_sha256)stop('PACKAGE_CHANGED');
 const lesson=JSON.parse(raw),p=lesson.input,g=lesson.sentences,folder=dirname(await realpath(path));
 if(p.date!==date)stop('NOT_TODAYS_LESSON');
 return withDayLock(lockRoot,date,async()=>{
  const current=await snapshot(api),old=current.inputs.find(x=>x.id===p.id),oldSentences=current.sentences.find(x=>x.id===g.id);
  if(old&&!isDeepStrictEqual(canonical('inputs',old),p)||oldSentences&&!isDeepStrictEqual(canonical('sentences',oldSentences),g))stop('EXISTING_CONTENT_DIFFERS');
  const daily=current.inputs.filter(x=>x.date===date&&x.type!=='level_test'&&x.id!=='input_local_01');
  // Conservative: do not hide incomplete existing packages by publishing extra IDs.
  if(!old&&daily.length>=2)stop('DAILY_TARGET_ALREADY_PRESENT_VERIFY_EXISTING');
  for(const ref of p.reused_vocab||[]){
   const w=typeof ref==='string'?ref:ref.w,v=typeof ref==='object'&&ref.vocabId?current.vocab.find(x=>x.id===ref.vocabId):current.vocab.find(x=>normalize(x.word)===normalize(w));
   if(!v||normalize(v.word)!==normalize(w))stop('REUSED_VOCAB_NOT_IN_REAL_LIBRARY');
  }
  const missing=[];
  for(const entry of report.files){
   // Read only this package's keys; the legacy global blob list caps at 1000.
   try{
    const existing=await api.bytes('/api/blobs/'+encodeURIComponent(entry.key),{requireMime:entry.mime});
    if(sha(existing)!==entry.sha256||existing.length!==entry.size)stop('EXISTING_AUDIO_DIFFERS');
   }catch(e){if(e.message==='COACH_HTTP_404')missing.push(entry);else throw e;}
  }
  // Re-read each immutable file immediately before sending. No automatic write retries.
  for(const entry of missing){
   const data=await readFile(await within(folder,entry.file));if(sha(data)!==entry.sha256)stop('AUDIO_CHANGED');
   await api.json('/api/blobs/'+encodeURIComponent(entry.key),{method:'PUT',body:data,headers:{'Content-Type':entry.mime,'X-Blob-Meta':Buffer.from(JSON.stringify({mime:entry.mime})).toString('base64')}});
  }
  if(sha(await readFile(path))!==report.lesson_sha256)stop('PACKAGE_CHANGED');
  if(!old||!oldSentences)await api.json('/api/import',{method:'POST',body:JSON.stringify({inputs:[p],sentences:[g]}),headers:{'Content-Type':'application/json'}});
  const got=await api.json('/api/records/inputs/'+encodeURIComponent(p.id)),sent=await api.json('/api/records/sentences/'+encodeURIComponent(g.id));
  if(!isDeepStrictEqual(canonical('inputs',got),p)||!isDeepStrictEqual(canonical('sentences',sent),g))stop('RECORD_READBACK_MISMATCH');
  const audio=[];
  for(const entry of report.files){
   const data=await api.bytes('/api/blobs/'+encodeURIComponent(entry.key),{requireMime:entry.mime});
   if(sha(data)!==entry.sha256)stop('AUDIO_READBACK_MISMATCH');
   const range=await api.bytes('/media/'+encodeURIComponent(entry.key),{headers:{Range:'bytes=0-15'},requireStatus:206,requireMime:entry.mime});
   if(!data.subarray(0,16).equals(range))stop('MEDIA_RANGE_MISMATCH');
   audio.push({key:entry.key,sha256:entry.sha256,size:data.length,range_status:206});
  }
  const result={result:'PUBLISHED_VERIFIED',time:new Date().toISOString(),date,input_id:p.id,lesson_sha256:report.lesson_sha256,uploaded_files:missing.length,record_readback:'exact_except_server_derived_audio_urls',audio,environment:report.environment,device_gate:'Mac Chrome和iPhone Safari本次未执行；不代表听感或麦克风验收'};
  await writeFile(resolve(folder,'技术校验.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(folder,'发布回读.json'),JSON.stringify(result,null,2)+'\n');
  return result;
 });
}
const localCoach=connect;
async function privateSnapshot(path,api){
 const allowed=resolve(project,'_tmp');await mkdir(allowed,{recursive:true,mode:0o700});
 const target=resolve(path),rel=relative(allowed,target);
 if(!rel||rel.startsWith('..')||rel.startsWith('/'))stop('PRIVATE_OUTPUT_PATH_REQUIRED');
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 if(!((await realpath(dirname(target)))+'/').startsWith((await realpath(allowed))+'/'))stop('PRIVATE_OUTPUT_PATH_REQUIRED');
 const data=await snapshot(api),handle=await open(target,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(data,null,2)+'\n');}finally{await handle.close();}
 return {result:'SNAPSHOT_SAVED',output:target,inputs:data.inputs.length,vocab:data.vocab.length,classification:'私有真实学习数据，不打印学生答案'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let api;
 try{
  const action=process.argv[2],flag=name=>process.argv[process.argv.indexOf(name)+1];
  if(!['snapshot','release'].includes(action))stop('USE_SNAPSHOT_OR_RELEASE');
  if(action==='release'&&!process.argv.includes('--lesson')||action==='snapshot'&&!process.argv.includes('--out'))stop('MISSING_ARGUMENT');
  // Validate before accessing official credentials or creating any cloud session.
  if(action==='release'&&(await validate(resolve(flag('--lesson')))).result!=='TECHNICAL_PASS')stop('PACKAGE_CHECK_FAILED');
  api=await localCoach();
  const result=action==='snapshot'?await privateSnapshot(flag('--out'),api):await releaseLesson(resolve(flag('--lesson')),{api});
  console.log(JSON.stringify(action==='release'?{result:result.result,input_id:result.input_id,uploaded_files:result.uploaded_files}:result));
 }catch(e){console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'TEACHING_IO_STOPPED_DETAILS_WITHHELD');process.exitCode=1;}
 finally{if(api)try{await api.close();}catch{console.error('COACH_SESSION_CLEANUP_FAILED');process.exitCode=1;}}
}
