/* Isolated synthetic packages and fake API. No credentials or production writes. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validate,sha} from '../scripts/validate.mjs';
import {releaseLesson,withDayLock} from '../scripts/cloud-io.mjs';
import {connect} from '../scripts/runtime.mjs';
import {spawn} from 'node:child_process';
const hub=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),date='2026-10-20';let root,serial=0;
before(async()=>{const tmp=resolve(hub,'var/test-tmp');await mkdir(tmp,{recursive:true});root=await mkdtemp(resolve(tmp,'技能链隔离测试-'));});
after(async()=>{if(root)await rm(root,{recursive:true});});
function wav(frequency){
 const rate=8000,frames=1600,data=Buffer.alloc(44+frames*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)data.writeInt16LE(Math.round(1000*Math.sin(i*frequency*2*Math.PI/rate)),44+i*2);return data;
}
async function fixture(){
 const folder=resolve(root,'包-'+(++serial));await mkdir(resolve(folder,'assets'),{recursive:true});
 const id='daily_20261020_01',vocabulary='Mara visits the small market after work and asks a friend about fresh food for dinner before they walk home together'.split(' ');
 const sentences=Array.from({length:5},(_,i)=>({n:i+1,text:Array.from({length:50},(_,n)=>vocabulary[n%vocabulary.length]).join(' ')+' '+['first','second','third','fourth','fifth'][i]+'.',cn:'隔离测试译文，不是真实教材。',speaker:'Mara',audioKey:id+'/s'+(i+1)+'.wav'}));
 const words=sentences.flatMap(s=>s.text.replace(/[.]/g,'').split(' '));
 const question=(id,sentence)=>({id,q:'Which answer matches this synthetic test?',options:['A','B','C','D'].map(x=>({id:x,text:'Option '+x})),correct_option_id:'A',explanation_en:'This is synthetic test data.',...(sentence?{sentence}:{})});
 const lesson={version:1,input:{id,date,title:'ISOLATED SYNTHETIC QA ONLY',level:'A2',body:sentences.map(s=>({text:s.text,speaker:s.speaker})),word_count:words.length,audioKey:id+'/full.wav',wordpack:[...new Set(words.map(w=>w.toLowerCase()))].map(w=>({w,pos:'test',cn:'隔离测试义'})),comprehension:[1,2,3].map(n=>question('c'+n)),polysemy:[1,2].map(n=>question('p'+n,sentences[0].text)),chunks:['Mara visits','small market','after work'].map(text=>({text})),discussion_prompts:['Discuss this synthetic fixture.']},sentences:{id,items:sentences},source:{kind:'ai_authored',title:'Synthetic QA fixture',url:'',author:'test runner',use_basis:'Generated only for isolated testing; never publish.',checked_at:date,adaptation_note:'Not a learning resource.',fallback_reason:'Isolated test needs no external material.'},teaching:{selection_reason:'Exercise technical guards only.'},audio:{model:'synthetic-tone-test-only',voices:{Mara:'test-tone'},style_family:'test-only',style_approval_evidence:'Synthetic fixture, no human approval claimed.',direction_file:'声音指导.md',text_review_evidence:'音频内容核对.md',files:[]}};
 for(const [index,key]of[lesson.input.audioKey,...sentences.map(s=>s.audioKey)].entries()){
  const file='assets/'+index+'.wav',data=wav(200+index*35);await writeFile(resolve(folder,file),data);lesson.audio.files.push({key,file,mime:'audio/wav',sha256:sha(data)});
 }
 await writeFile(resolve(folder,'声音指导.md'),'Synthetic tones only; not an actual voice.');await writeFile(resolve(folder,'音频内容核对.md'),'No human audio review. Fixture only.');
 const path=resolve(folder,'lesson.json'),save=()=>writeFile(path,JSON.stringify(lesson));await save();return {lesson,path,folder,save};
}
async function fake(f){
 const records={inputs:[],sentences:[]},blobs=new Map(),writes=[];let corruptRead=false,failImport=false;const vocab=[];
 const api={
  async json(route,init={}){
   if(route==='/api/coach/pending')return structuredClone({inputs:records.inputs,vocab,progress:[],shadowing:[]});
   if(route==='/api/records/sentences')return structuredClone(records.sentences);
   if(route.startsWith('/api/records/')){const [, , ,c,...bits]=route.split('/'),id=decodeURIComponent(bits.join('/'));return structuredClone(records[c].find(r=>r.id===id)||null);}
   if(route.startsWith('/api/blobs/')&&init.method==='PUT'){
    const key=decodeURIComponent(route.slice(11));if(blobs.has(key))throw Error('UNEXPECTED_OVERWRITE');blobs.set(key,Buffer.from(init.body));writes.push('audio');return {ok:true};
   }
   if(route==='/api/import'&&init.method==='POST'){
    if(failImport)throw Error('COACH_HTTP_502');const data=JSON.parse(init.body);assert.deepEqual(Object.keys(data).sort(),['inputs','sentences']);
    for(const c of ['inputs','sentences'])for(const row of data[c])if(!records[c].some(x=>x.id===row.id))records[c].push(structuredClone(row));writes.push('import');return {imported:2};
   }
   throw Error('UNEXPECTED_ROUTE');
  },
  async bytes(route,init={}){
   const key=decodeURIComponent(route.slice(route.startsWith('/media/')?7:11)),data=blobs.get(key);if(!data)throw Error('COACH_HTTP_404');
   if(route.startsWith('/media/')){assert.equal(init.requireStatus,206);return data.subarray(0,16);}
   return corruptRead&&records.inputs.length?Buffer.from('corrupted readback'):data;
  }
 };
 return {api,records,blobs,writes,vocab,setCorrupt:v=>{corruptRead=v;},setFailImport:v=>{failImport=v;},seed:async()=>{records.inputs.push({...structuredClone(f.lesson.input),audio_full:'/media/generated'});records.sentences.push({...structuredClone(f.lesson.sentences),items:f.lesson.sentences.items.map(s=>({...s,audio:'/media/generated'}))});for(const e of f.lesson.audio.files)blobs.set(e.key,await readFile(resolve(f.folder,e.file)));}};
}
const release=(f,server)=>releaseLesson(f.path,{api:server.api,date,lockRoot:resolve(root,'locks')});
test('01 text-only clearly differs from a fully decoded audio package',async()=>{const f=await fixture();assert.equal((await validate(f.path,{textOnly:true})).result,'TEXT_ONLY_PASS');const r=await validate(f.path);assert.equal(r.result,'TECHNICAL_PASS');assert.equal(r.files.length,6);assert.match(r.environment.classification,/非真机/);});
test('02 actual words and full clickable vocabulary are enforced',async()=>{const f=await fixture();f.lesson.input.word_count=250;f.lesson.input.wordpack=f.lesson.input.wordpack.filter(x=>x.w!=='mara');await f.save();const r=await validate(f.path);assert.equal(r.result,'FAIL');assert.ok(r.errors.includes('ACTUAL_WORD_COUNT_MISMATCH'));assert.ok(r.content.missing.length>0);});
test('03 no sentence left outside body mapping, and no reused full-audio key',async()=>{const f=await fixture();f.lesson.sentences.items[0].text='Words missing from this article.';f.lesson.sentences.items[0].audioKey=f.lesson.input.audioKey;await f.save();const r=await validate(f.path);assert.equal(r.result,'FAIL');assert.ok(r.errors.includes('UNMAPPED_BODY_WORDS'));assert.ok(r.errors.includes('REUSED_SENTENCE_AUDIOKEY'));});
test('04 missing files and incorrect hash cannot reach publish',async()=>{const f=await fixture();await rm(resolve(f.folder,f.lesson.audio.files[1].file));f.lesson.audio.files[0].sha256='0'.repeat(64);await f.save();const r=await validate(f.path);assert.equal(r.result,'FAIL');assert.ok(r.errors.includes('AUDIO_DIGEST'));const s=await fake(f);await assert.rejects(release(f,s),/PACKAGE_CHECK_FAILED/);assert.equal(s.writes.length,0);});
test('05 renamed extensions and duplicated audio bytes are rejected',async()=>{const f=await fixture();const e=f.lesson.audio.files[1];const data=await readFile(resolve(f.folder,f.lesson.audio.files[0].file));await writeFile(resolve(f.folder,'assets/fake.mp3'),data);Object.assign(e,{file:'assets/fake.mp3',sha256:sha(data)});await f.save();const r=await validate(f.path);assert.ok(r.errors.includes('AUDIO_EXTENSION'));assert.ok(r.errors.includes('DUPLICATED_AUDIO_BYTES'));});
test('06 a symlink cannot bring an external file into a lesson',async()=>{const f=await fixture();const outside=resolve(root,'external.wav');await writeFile(outside,wav(555));await symlink(outside,resolve(f.folder,'assets/link.wav'));Object.assign(f.lesson.audio.files[0],{file:'assets/link.wav',sha256:sha(await readFile(outside))});await f.save();const r=await validate(f.path);assert.equal(r.result,'FAIL');assert.ok(r.errors.some(x=>x.startsWith('AUDIO_FILE_FAILED:')));});
test('07 missing provenance, repeated options and Chinese quiz text fail',async()=>{const f=await fixture();delete f.lesson.source.use_basis;f.lesson.input.comprehension[0].q='中文';f.lesson.input.comprehension[0].options[1].text=f.lesson.input.comprehension[0].options[0].text;await f.save();const r=await validate(f.path);assert.ok(r.errors.includes('MISSING_SOURCE_USE_BASIS'));assert.ok(r.errors.includes('DUPLICATE_OPTION_TEXT'));assert.ok(r.errors.some(x=>x.startsWith('CONTENT:选择题含中文')));});
test('08 first release uploads audio before content and verifies every hash/range',async()=>{const f=await fixture(),s=await fake(f);const r=await release(f,s);assert.equal(r.result,'PUBLISHED_VERIFIED');assert.deepEqual(s.writes,[...Array(6).fill('audio'),'import']);assert.equal(r.audio.length,6);assert.equal(JSON.parse(await readFile(resolve(f.folder,'发布回读.json'))).input_id,f.lesson.input.id);});
test('09 retry of a completed release is read-only and handles server derived URLs',async()=>{const f=await fixture(),s=await fake(f);await s.seed();const r=await release(f,s);assert.equal(r.uploaded_files,0);assert.equal(s.writes.length,0);});
test('10 existing changed content is rejected before writing',async()=>{const f=await fixture(),s=await fake(f);await s.seed();s.records.inputs[0].title='Existing different title';await assert.rejects(release(f,s),/EXISTING_CONTENT_DIFFERS/);assert.equal(s.writes.length,0);});
test('11 any conflicting audio stops the entire preflight before upload',async()=>{const f=await fixture(),s=await fake(f);s.blobs.set(f.lesson.audio.files[5].key,wav(999));await assert.rejects(release(f,s),/EXISTING_AUDIO_DIFFERS/);assert.equal(s.writes.length,0);});
test('12 partial upload/import failure resumes without overwriting prior blobs',async()=>{const f=await fixture(),s=await fake(f);s.setFailImport(true);await assert.rejects(release(f,s),/COACH_HTTP_502/);assert.equal(s.blobs.size,6);s.setFailImport(false);const r=await release(f,s);assert.equal(r.uploaded_files,0);assert.equal(s.writes.filter(x=>x==='audio').length,6);assert.equal(s.writes.filter(x=>x==='import').length,1);});
test('13 false readback success cannot create a publication certificate',async()=>{const f=await fixture(),s=await fake(f);s.setCorrupt(true);await assert.rejects(release(f,s),/AUDIO_READBACK_MISMATCH/);await assert.rejects(readFile(resolve(f.folder,'发布回读.json')),/ENOENT/);});
test('14 a day with two other daily inputs does not get a third',async()=>{const f=await fixture(),s=await fake(f);s.records.inputs.push({id:'another1',date},{id:'another2',date},{id:'month',date,type:'level_test'});await assert.rejects(release(f,s),/DAILY_TARGET_ALREADY_PRESENT/);assert.equal(s.writes.length,0);});
test('15 fabricated reencounter source is rejected before any writes',async()=>{const f=await fixture(),s=await fake(f);f.lesson.input.reused_vocab=[{w:'market',vocabId:'not-real'},{w:'food',vocabId:'not-real2'},{w:'friend',vocabId:'not-real3'}];await f.save();await assert.rejects(release(f,s),/REUSED_VOCAB_NOT_IN_REAL_LIBRARY/);assert.equal(s.writes.length,0);});
test('16 same-day concurrency is locked and failure releases the lock',async()=>{const locks=resolve(root,'parallel');let unblock;const gate=new Promise(r=>{unblock=r;});const first=withDayLock(locks,date,async()=>{await gate;throw Error('STOP_TEST');});await new Promise(r=>setTimeout(r,40));await assert.rejects(withDayLock(locks,date,async()=>{}),/DAY_LOCKED/);unblock();await assert.rejects(first,/STOP_TEST/);assert.equal(await withDayLock(locks,date,async()=>true),true);});
test('17 portable configured transport releases into a real isolated Python service and resumes read-only',async()=>{
 const f=await fixture(),privateDir=resolve(root,'real-http-data'),configFile=resolve(root,'real-http-config.json');
 const processHandle=spawn(process.env.PYTHON||'python3',['-B',resolve(hub,'local/server.py'),'--host','127.0.0.1','--port','0','--data-dir',privateDir],{stdio:['ignore','pipe','pipe']});
 let api;const old=process.env.WORKBENCH_CONFIG;
 try{
  const port=await new Promise((resolvePort,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(Error('Isolated HTTP start timeout')),10000);processHandle.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolvePort(Number(match[1]));}});processHandle.stderr.on('data',chunk=>{error+=chunk;});processHandle.on('error',reject);processHandle.on('exit',code=>{if(code){clearTimeout(timer);reject(Error('Isolated service failed: '+error));}});});
  await writeFile(configFile,JSON.stringify({mode:'local',base_url:'http://127.0.0.1:'+port,data_dir:privateDir,workspace_dir:resolve(root,'workspace')}),{mode:0o600});process.env.WORKBENCH_CONFIG=configFile;api=await connect();
  const result=await releaseLesson(f.path,{api,date,lockRoot:resolve(root,'real-lock')});assert.equal(result.result,'PUBLISHED_VERIFIED');assert.equal(result.uploaded_files,6);
  const again=await releaseLesson(f.path,{api,date,lockRoot:resolve(root,'real-lock')});assert.equal(again.uploaded_files,0);
  assert.equal((await api.json('/api/records/inputs')).length,1);assert.deepEqual(await api.json('/api/records/progress'),[]);assert.deepEqual(await api.json('/api/records/vocab'),[]);
 }finally{await api?.close();if(old===undefined)delete process.env.WORKBENCH_CONFIG;else process.env.WORKBENCH_CONFIG=old;processHandle.kill();await new Promise(resolveExit=>{if(processHandle.exitCode!==null)resolveExit();else processHandle.on('exit',resolveExit);});}
});
