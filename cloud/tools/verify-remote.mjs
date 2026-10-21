/* Run AFTER creating an isolated Free project. Secrets via stdin only.
 * No secrets, cookies or answers are written to the report. Never pass production accounts. */
import {BUILD} from '../src/worker.mjs';
const cases=[];let input;
try{
 let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>16384)throw Error('验证输入过长。');}
 input=JSON.parse(raw);
 const base=new URL(input.base);
 if(base.protocol!=='https:'||!base.hostname.endsWith('.pages.dev')||base.pathname!=='/'||base.search||base.hash)throw Error('请使用隔离Cloudflare Pages项目的HTTPS根地址。');
 const origin=base.origin;
 const tokens=input.engineeringTokens;
 if(tokens&&(!['mac','phone','coach','other'].every(k=>typeof tokens[k]==='string'&&tokens[k].split('.').length===3)||input.email!=='wb-learner@workbench-verification.invalid'))throw Error('无效工程会话配置。');
 const client=token=>{
  const cookies=new Map();
  return async(path,init={})=>{
   const r=await fetch(origin+path,{...init,redirect:'error',signal:AbortSignal.timeout(25000),headers:{...(token?{Authorization:'Bearer '+token}:cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...init.headers}});
   for(const line of r.headers.getSetCookie()){const first=line.split(';')[0],i=first.indexOf('=');cookies.set(first.slice(0,i),first.slice(i+1));}
   if(!r.ok)throw Error('接口验证失败 HTTP '+r.status+'：'+path.split('?')[0]);
   return r;
  };
 };
 const json=(data,extra={})=>({method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(data)});
 const mac=client(tokens?.mac),phone=client(tokens?.phone),coach=client(tokens?.coach),other=client(tokens?.other),health=await(await mac('/health')).json();
 if(health.build!==BUILD||health.engineering_accounts_supported!==true||!health.configured)throw Error('目标不是允许隔离工程账号的云端版本。');
 cases.push({case:'真实HTTPS部署健康状态与版本',result:'PASS'});
 if(input.freePlansConfirmed!==true)throw Error('尚未确认Cloudflare与Supabase均为Free；未执行写入验证。');
 if(!input.email||!input.coachEmail||!input.otherEmail||(!tokens&&(!input.password||!input.coachPassword||!input.otherPassword))||input.allowFixtureWrites!==true)throw Error('尚缺隔离测试账号/教练账号/第二账号或测试写入授权。');
 if(!tokens){
  await mac('/api/auth/login',json({email:input.email,password:input.password}));await phone('/api/auth/login',json({email:input.email,password:input.password}));
  await coach('/api/auth/login',json({email:input.coachEmail,password:input.coachPassword}));await other('/api/auth/login',json({email:input.otherEmail,password:input.otherPassword}));
 }
 const learnerSession=await(await mac('/api/session',{method:'POST'})).json();
 if(learnerSession.validation_only!==true||input.email!=='wb-learner@workbench-verification.invalid')throw Error('禁止对正式学习者运行工程写入测试。');
 const owner=learnerSession.user_id;
 cases.push({case:tokens?'独立真实工程Auth会话（Mac/Phone/教练/其他账号），不重置密码':'两设备同账号、独立教练与其他账号登录',result:'PASS'});
 const page=await(await mac('/')).text();
 if(!['学习进度','生词本','跟读录音','水平测试','cloud-session.js'].every(text=>page.includes(text)))throw Error('登录后首页缺少完整工作台入口或账号脚本。');
 cases.push({case:'登录后首页HTTP 200，四导航/月测/账号脚本保留',result:'PASS',classification:'HTTP内容检查，非浏览器渲染'});
 await mac('/api/cloud/check');cases.push({case:'真实Supabase身份/数据库路径可达',result:'PASS'});
 const id='cloud-verification-'+crypto.randomUUID(),device='verification-'+crypto.randomUUID(),make=(rid,data,collection='progress')=>({collection,id:rid,change_id:crypto.randomUUID(),updated_at:Date.now(),data:{...data,id:rid,is_test:true}});
 const sync=async(client,changes)=>(await client('/api/sync/push',json({device_id:device,changes}))).json();
 await coach('/api/import',json({inputs:[{id,title:'ENGINEERING VERIFICATION — NOT A LESSON',is_test:true,body:['This is an isolated transport test.']}]},{'X-Learner-Id':owner}));
 await sync(mac,[make(id,{inputId:id,reading_checked:true,comprehension:{status:'submitted',total:1,answers:[{question_id:'verification',option_id:'a'}]}})]);
 const downloaded=await(await phone('/api/sync/pull?since=0')).json();
 if(!downloaded.records.some(r=>r.id===id&&r.data.reading_checked))throw Error('第二设备没有读到第一设备提交的数据。');
 cases.push({case:'Mac提交→云端→iPhone独立会话下载',result:'PASS'});
 await coach('/api/coach/grades',json({updates:[{collection:'progress',id,grade:{comprehension:{correct:1,total:1,note:'Engineering fixture only'}}}]},{'X-Learner-Id':owner}));
 const conflict=await sync(phone,[make(id,{reading_checked:false,comprehension:null})]);
 const protectedRow=await(await mac('/api/records/progress/'+id)).json();
 if(!conflict.conflicts.length||protectedRow.comprehension.correct!==1||protectedRow.reading_checked!==true)throw Error('评分保护或布尔合并验证失败。');
 cases.push({case:'教练评分保护/进度OR合并/冲突清单',result:'PASS'});
 const outsiders=await(await other('/api/sync/pull?since=0')).json();if(outsiders.records.some(r=>r.id===id))throw Error('其他账号读取到了测试记录。');
 cases.push({case:'跨账号数据隔离',result:'PASS'});
 // Valid short silence WAV. This tests binary transport, NOT speech or microphone quality.
 const audio=new Uint8Array(44+1600),view=new DataView(audio.buffer),ascii=(n,s)=>{for(let i=0;i<s.length;i++)audio[n+i]=s.charCodeAt(i);};
 ascii(0,'RIFF');view.setUint32(4,audio.length-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,1600,true);
 for(let n=1;n<=2;n++){
  const rid=id+'-take-'+n,key='shadowing/'+rid+'.wav';
  await sync(mac,[make(rid,{inputId:id,blobKey:key,mime:'audio/wav',durationSec:0.1},'shadowing')]);
  await mac('/api/sync/blobs/'+encodeURIComponent(key),{method:'PUT',headers:{'Content-Type':'audio/wav','X-Blob-Meta':btoa(JSON.stringify({mime:'audio/wav',inputId:id})),'X-Updated-At':String(Date.now()),'X-Device-Id':device},body:audio});
  const received=new Uint8Array(await(await phone('/api/blobs/'+encodeURIComponent(key))).arrayBuffer());
  if(received.length!==audio.length||received.some((v,i)=>v!==audio[i]))throw Error('录音字节不一致。');
  const range=await phone('/media/'+encodeURIComponent(key),{headers:{Range:'bytes=0-43'}});if(range.status!==206||(await range.arrayBuffer()).byteLength!==44)throw Error('音频Range验证失败。');
 }
 cases.push({case:'两遍WAV经真实对象存储上传/下载原字节一致及Range',result:'PASS',classification:'合成静音夹具，非真机录音'});
 console.log(JSON.stringify({at:new Date().toISOString(),base:origin,classification:'真实云端接口验证，非Mac/iPhone真机测试',cases,cloud_transport_verified:true,free_plan_evidence:'操作者确认，非自动账单审计',billing_changed:false,production_data_migrated:false},null,2));
}catch(error){
 console.log(JSON.stringify({at:new Date().toISOString(),cases,cloud_transport_verified:false,remaining:String(error.message).replace(/https?:\/\/[^\s]+/g,'[target]'),billing_changed:false,production_data_migrated:false},null,2));process.exitCode=1;
}
