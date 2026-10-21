/* Cloudflare Pages Advanced Mode. Only the public Supabase key is needed here.
 * User JWTs remain HttpOnly cookies; every database operation is also guarded by RLS/RPC.
 * Never accept service-role keys or copy local pairing tokens into this deployment. */
export const BUILD='workbench-cloud-2.1-20261020.5';
const BUCKET='workbench-audio',MAX_JSON=2000000,MAX_BLOB=25000000;
const ACCESS='__Host-wb-access',REFRESH='__Host-wb-refresh';
const collectionNames=new Set(['inputs','sentences','dictation_tasks','progress','vocab','shadowing','dictation']);
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'');
function publicKey(value){
 if(typeof value!=='string')return false;
 if(value.startsWith('sb_publishable_')&&value.length>24)return true;
 try{const payload=value.split('.')[1];return value.split('.').length===3&&JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{return false;}
}
const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
const errorMessage=body=>{
 const raw=String(body?.message||body?.error_description||body?.error||'');
 if(raw.includes('WB_QUOTA'))return failure(413,'QUOTA','云端免费方案预留空间已用完，本机数据保留；不会自动升级。');
 if(/WB_(COACH_ONLY|FORBIDDEN)/.test(raw))return failure(403,'INVALID','此账号没有访问或批改权限。');
 if(raw.includes('WB_NOT_FOUND'))return failure(404,'NOT_FOUND','云端记录不存在。');
 if(/WB_/.test(raw))return failure(400,'INVALID','云端拒绝了无效变更，原教材、原答案和评分保留。');
 return failure(502,'NETWORK','云端服务暂不可用，请保留本机记录后重试。');
};
function reply(status,value,headers={}){
 return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
}
async function limited(request,max){
 if(Number(request.headers.get('Content-Length'))>max)throw failure(413,'QUOTA','文件超过本次验证允许的大小，请保留本机录音。');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 let size=0;const parts=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw failure(413,'QUOTA','文件超过本次验证允许的大小，请保留本机录音。');}parts.push(value);}
 const data=new Uint8Array(size);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return data;
}
async function jsonBody(request,max=MAX_JSON){
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await limited(request,max)));}
 catch(error){if(error.status)throw error;throw failure(400,'INVALID','请求JSON格式错误。');}
}
function cookieMap(request){
 return Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(p=>p.trim().split(/=(.*)/s)).filter(p=>p.length>=2).map(p=>[p[0],p[1]]));
}
function cookie(name,value,age){return name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;}
const encodePath=path=>path.split('/').map(encodeURIComponent).join('/');
const hex=data=>Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
const validKey=key=>typeof key==='string'&&key.length>0&&key.length<=200&&!key.includes('\0');
function resolveRecord(c,row){
 if(!row)return row;
 const media=key=>'/media/'+encodeURIComponent(key);
 if(c==='inputs'){
  const raw=row.audio_blob_key||row.audio_full||row.audio;
  return {...row,audio_full:(row.audioKey||row.audio_blob_key)?media(row.audioKey||row.audio_blob_key):raw?(/^(https?:|blob:|\/)/.test(raw)?raw:media(row.id+'/'+raw)):media(row.id+'/full.mp3')};
 }
 if(c==='sentences')return {...row,items:(row.items||row.sentences||[]).map(s=>({...s,audio:/^(https:|blob:|\/)/.test(s.audio||'')?s.audio:media(s.audioKey||s.audio_blob_key||(s.audio?row.id+'/'+s.audio:row.id+'/sentence-'+String(s.n).padStart(2,'0')))}))};
 return row;
}
export function createHandler(upstreamFetch=fetch){
 return async function handle(request,env){
  const url=new URL(request.url),path=url.pathname,headersToSet=[];
  const finish=response=>{
   for(const value of headersToSet)response.headers.append('Set-Cookie',value);
   response.headers.set('Permissions-Policy','microphone=(self)');
   response.headers.set('Referrer-Policy','no-referrer');
   response.headers.set('X-Content-Type-Options','nosniff');
   response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
   return response;
  };
  try{
   if(!['/','/index.html','/cloud-session.js','/health'].includes(path)&&!path.startsWith('/api/')&&!path.startsWith('/media/'))return env.ASSETS.fetch(request);
   const allowedLocal=env.LOCAL_VERIFY_ONLY==='1'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.SUPABASE_URL||'');
   const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL||'')||allowedLocal;
   const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
   if(!['GET','HEAD'].includes(request.method)&&(site==='cross-site'||(origin&&origin!==url.origin)))throw failure(403,'INVALID','请在工作台自身页面提交。');
   if(path==='/health')return reply(200,{ok:true,build:BUILD,configured:configured&&publicKey(env.SUPABASE_PUBLISHABLE_KEY),validation_only:false,engineering_accounts_supported:true,storage_limit_bytes:800000000});
   if(!configured||!publicKey(env.SUPABASE_PUBLISHABLE_KEY))throw failure(503,'NETWORK','云端验证环境尚未配置有效的公开Key；禁止使用管理员密钥。');
   if(env.SUPABASE_SERVICE_ROLE_KEY)throw failure(503,'INVALID','本方案禁止使用service-role密钥，请移除该配置。');
   const base=env.SUPABASE_URL,key=env.SUPABASE_PUBLISHABLE_KEY;
   async function upstream(route,init={},token){
    const response=await upstreamFetch(base+route,{...init,headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...init.headers},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(response.status>=300&&response.status<400)throw failure(502,'NETWORK','云服务返回非预期跳转，未向其他站点转发登录信息。');
    if(!response.ok){let body;try{body=await response.json();}catch{}if(response.status===401)throw failure(401,'INVALID','登录已过期，请重新登录；本机记录保留。');if(response.status===413)throw failure(413,'QUOTA','录音超过云端允许的大小。');throw errorMessage(body);}
    return response;
   }
   const cookies=cookieMap(request);
   function setSession(session){
    if(!session.access_token||!session.refresh_token||!/^[A-Za-z0-9_.-]+$/.test(session.access_token)||!/^[A-Za-z0-9_.-]+$/.test(session.refresh_token))throw failure(502,'INVALID','登录服务返回格式无效。');
    headersToSet.push(cookie(ACCESS,session.access_token,Math.min(session.expires_in||3600,3600)),cookie(REFRESH,session.refresh_token,2592000));
   }
   if(path==='/api/auth/login'&&request.method==='POST'){
    const body=await jsonBody(request,4096);
    if(typeof body.email!=='string'||typeof body.password!=='string'||body.email.length>254||body.password.length>1024)throw failure(400,'INVALID','请填写有效的邮箱与密码。');
    let response;
    try{response=await upstream('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:body.email,password:body.password})});}
    catch{throw failure(401,'INVALID','登录未成功，请检查账号和密码，或稍后重试。');}
    setSession(await response.json());return finish(reply(200,{ok:true}));
   }
   let access=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1]||cookies[ACCESS],user;
   async function loadUser(){
    if(!access)throw failure(401,'INVALID','请先登录工作台。');
    user=await (await upstream('/auth/v1/user',{},access)).json();if(!uuid(user.id))throw failure(401,'INVALID','登录身份无效。');
   }
   try{await loadUser();}
   catch(error){
    if(error.status!==401||request.headers.has('Authorization')||!cookies[REFRESH])throw error;
    const session=await (await upstream('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:cookies[REFRESH]})})).json();
    setSession(session);access=session.access_token;await loadUser();
   }
   const owner=request.headers.get('X-Learner-Id')||user.id;
   if(!uuid(owner))throw failure(400,'INVALID','学习者编号无效。');
   const formal=user.app_metadata?.workbench_role==='learner'&&user.app_metadata?.engineering_fixture!==true;
   const validation=!formal;
   if(formal&&user.app_metadata?.workbench_ready!==true&&path!=='/api/auth/logout')throw failure(503,'NETWORK','学习资料正在迁移核对，请稍后重新打开。');
   if(path==='/api/auth/password'&&request.method==='POST'){
    const body=await jsonBody(request,4096);
    if(typeof body.current_password!=='string'||!body.current_password.length||body.current_password.length>1024||typeof body.new_password!=='string'||body.new_password.length<8||body.new_password.length>128||body.new_password!==body.confirm_password)throw failure(400,'INVALID','请填写当前密码；新密码须为8–128位，且两次输入一致。');
    if(body.current_password===body.new_password)throw failure(400,'INVALID','新密码不能与当前密码相同。');
    let verified;
    try{verified=await(await upstream('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:body.current_password})})).json();}
    catch{throw failure(400,'INVALID','当前密码不正确或验证暂不可用，请检查后重试。');}
    if(verified.user?.id!==user.id||!verified.access_token||!verified.refresh_token)throw failure(403,'INVALID','当前账号验证未通过。');
    try{
     await upstream('/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:body.new_password,current_password:body.current_password})},verified.access_token);
    }catch{
     try{await upstream('/auth/v1/logout?scope=local',{method:'POST'},verified.access_token);}catch{}
     throw failure(400,'INVALID','新密码未能更新，请检查密码规则或稍后重试。');
    }
    setSession(verified);return finish(reply(200,{ok:true,message:'密码已更新，下次登录请使用新密码。'}));
   }
   const rpc=async(name,args)=>(await upstream('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_owner:owner,...args})},access)).json();
   async function rows(table,params={}){
    const query=new URLSearchParams({owner_id:'eq.'+owner,...params});
    return (await upstream('/rest/v1/'+table+'?'+query,{},access)).json();
   }
   if(path==='/api/auth/logout'&&request.method==='POST'){
    await upstream('/auth/v1/logout?scope=local',{method:'POST'},access);
    headersToSet.push(cookie(ACCESS,'',0),cookie(REFRESH,'',0));return finish(reply(200,{ok:true}));
   }
   if(path==='/cloud-session.js'&&request.method==='GET')return finish(new Response('window.CloudSession=Object.freeze('+JSON.stringify({userId:user.id,build:BUILD,validation})+');',{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}));
   if(path==='/'||path==='/index.html'){
    // Pages redirects /index.html to /. Fetch its canonical root after Auth so
    // the asset response contains HTML instead of redirecting / back to itself.
    const response=await env.ASSETS.fetch(new Request(new URL('/',url),request));const result=new Response(response.body,response);result.headers.set('Cache-Control','no-store');return finish(result);
   }
   if(path==='/api/session'&&request.method==='POST')return finish(reply(200,{ok:true,user_id:user.id,validation_only:validation}));
   if(path==='/api/cloud/check'&&request.method==='GET'){
    await rpc('wb_ping',{});return finish(reply(200,{ok:true,build:BUILD,database:'reachable',classification:'cloud-endpoint-check',validation_only:validation}));
   }
   if(path==='/api/sync/push'&&request.method==='POST')return finish(reply(200,await rpc('wb_push',{p_payload:await jsonBody(request)})));
   if(path==='/api/sync/pull'&&request.method==='GET'){
    const since=Number(url.searchParams.get('since')||0);if(!Number.isSafeInteger(since)||since<0)throw failure(400,'INVALID','同步游标无效。');
    return finish(reply(200,await rpc('wb_pull',{p_since:since})));
   }
   if(path==='/api/sync/log'&&request.method==='GET')return finish(reply(200,await rows('wb_sync_log',{select:'id,at,device_id,collection,record_id,fields',order:'id.desc',limit:'100'})));
   if(path==='/api/import'&&request.method==='POST')return finish(reply(200,await rpc('wb_import',{p_bundle:await jsonBody(request)})));
   if(path==='/api/coach/grades'&&request.method==='POST'){
    const body=await jsonBody(request);return finish(reply(200,await rpc('wb_grade',{p_updates:body.updates})));
   }
   if(path==='/api/coach/pending'&&request.method==='GET'){
    // RLS still controls every row, including for an explicitly assigned coach.
    const result={};for(const c of ['progress','vocab','shadowing','inputs'])result[c]=await listRecords(c);
    return finish(reply(200,result));
   }
   async function listRecords(c){
    // Explicit pagination also handles textbook/word libraries exceeding PostgREST's default cap.
    let result=[];for(let start=0;start<50000;start+=500){
     const page=await rows('wb_records',{collection:'eq.'+c,select:'data',order:'id.asc',offset:String(start),limit:'500'});
     result.push(...page.map(r=>resolveRecord(c,r.data)));if(page.length<500)return result;
    }throw failure(413,'QUOTA','记录数量超过验证版本上限，未返回截断结果。');
   }
   if(path.startsWith('/api/records/')){
    const bits=path.slice(13).split('/'),c=decodeURIComponent(bits.shift()),id=bits.length?decodeURIComponent(bits.join('/')):undefined;
    if(!collectionNames.has(c))throw failure(400,'INVALID','未知数据集合。');
    if(request.method!=='GET')throw failure(403,'INVALID','教材只读；学习变更须通过受保护的同步接口提交。');
    if(id===undefined)return finish(reply(200,await listRecords(c)));
    const found=await rows('wb_records',{collection:'eq.'+c,id:'eq.'+id,select:'data',limit:'1'});
    return finish(reply(200,resolveRecord(c,found[0]?.data||null)));
   }
   if(path==='/api/blobs'&&request.method==='GET'){
    const prefix=url.searchParams.get('prefix')||'';
    const found=await rows('wb_blobs',{select:'key,size,mime',order:'key.asc',limit:'1000'});
    if(found.length===1000)throw failure(413,'QUOTA','音频列表超过验证版单次限制，未静默截断。');
    return finish(reply(200,found.filter(r=>r.key.startsWith(prefix))));
   }
   if((path.startsWith('/api/blobs/')||path.startsWith('/media/'))&&['GET','HEAD'].includes(request.method)){
    const logical=decodeURIComponent(path.slice(path.startsWith('/media/')?7:11));
    const found=(await rows('wb_blobs',{key:'eq.'+logical,select:'path,size,mime',limit:'1'}))[0];
    if(!found)throw failure(404,'NOT_FOUND','音频尚未上传。');
    const range=request.headers.get('Range');
    if(range){
     const match=/^bytes=(\d*)-(\d*)$/.exec(range);
     let valid=!!match&&(match[1]!==''||match[2]!=='');
     if(valid){const a=match[1]?Number(match[1]):Math.max(0,found.size-Number(match[2])),b=match[1]&&match[2]?Math.min(Number(match[2]),found.size-1):found.size-1;valid=Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a<=b&&a<found.size&&!(match[1]===''&&Number(match[2])===0);}
     if(!valid)return finish(new Response(null,{status:416,headers:{'Content-Range':'bytes */'+found.size,'Cache-Control':'no-store'}}));
    }
    const response=await upstream('/storage/v1/object/authenticated/'+BUCKET+'/'+encodePath(found.path),{headers:range?{Range:range}:{},method:request.method},access);
    const result=new Response(response.body,{status:response.status,headers:{'Content-Type':found.mime,'Cache-Control':'no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'}});
    for(const name of ['Content-Length','Content-Range'])if(response.headers.has(name))result.headers.set(name,response.headers.get(name));return finish(result);
   }
   if((path.startsWith('/api/sync/blobs/')||path.startsWith('/api/blobs/'))&&request.method==='PUT'){
    const content=path.startsWith('/api/blobs/'),logical=decodeURIComponent(path.slice(content?11:16));
    if(!validKey(logical))throw failure(400,'INVALID','录音编号无效。');
    const bytes=await limited(request,MAX_BLOB);if(!bytes.length)throw failure(400,'INVALID','不能上传空录音。');
    let meta;try{const raw=atob(request.headers.get('X-Blob-Meta')||'');meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,x=>x.charCodeAt(0))));}catch{throw failure(400,'INVALID','录音元数据无效。');}
    const mime=request.headers.get('Content-Type')?.split(';')[0];if(!/^audio\/[a-z0-9.+-]+$/i.test(mime||''))throw failure(400,'INVALID','录音须保留真实音频格式。');meta={...meta,mime};
    const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))),objectPath=owner+'/'+(content?'content':'learning')+'/'+hex(new TextEncoder().encode(logical))+'/'+digest+'-'+crypto.randomUUID();
    // Preflight validates actor/owner and avoids uploading into another learner's folder.
    await rpc('wb_blob_preflight',{p_key:logical,p_content:content,p_size:bytes.length});
    await upstream('/storage/v1/object/'+BUCKET+'/'+encodePath(objectPath),{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes},access);
    let result;
    try{result=await rpc(content?'wb_content_blob':'wb_finish_blob',{p_key:logical,p_path:objectPath,p_size:bytes.length,p_mime:mime,p_meta:meta,p_digest:digest,...(!content?{p_at:Number(request.headers.get('X-Updated-At')),p_device:request.headers.get('X-Device-Id')}:{})});}
    catch(error){try{await upstream('/storage/v1/object/'+BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[objectPath]})},access);}catch{}throw error;}
    if(result.garbage_path){try{await upstream('/storage/v1/object/'+BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[result.garbage_path]})},access);}catch{}}
    delete result.garbage_path;return finish(reply(200,result));
   }
   throw failure(404,'NOT_FOUND','接口不存在。');
  }catch(error){
   if(error.status===401&&(path==='/'||path==='/index.html'))return new Response(null,{status:303,headers:{Location:'/login.html','Cache-Control':'no-store'}});
   return reply(error.status||503,error.status?{code:error.code,message:error.message}:{code:'NETWORK',message:'云端暂不可用，学习记录和录音仍保留本机。'});
  }
 };
}
export default {fetch:createHandler()};
