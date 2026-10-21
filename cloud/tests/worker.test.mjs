import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,BUILD} from '../src/worker.mjs';
import {standin} from './supabase-standin.mjs';
import {users,change} from './database.mjs';
let backend,handle;
const env={SUPABASE_URL:'https://verification.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_verification_public_key',ASSETS:{fetch:async()=>new Response('<html>isolated assets</html>',{headers:{'Content-Type':'text/html'}})}};
const cookie=name=>'__Host-wb-access=verify-access-'+name+'; __Host-wb-refresh=verify-refresh-'+name;
async function call(path,init={},name='a',override={}){
 return handle(new Request('https://workbench.test'+path,{...init,headers:{...(name?{Cookie:cookie(name)}:{}),...init.headers}}),{...env,...override});
}
const jsonInit=(body,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const apply=async(changes,name='a')=>{
 const r=await call('/api/sync/push',jsonInit({device_id:'worker-fixture',changes}),name);const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;
};
before(async()=>{backend=await standin();handle=createHandler(backend.fetch);await backend.d.rpc(users.coach,'wb_import',{p_owner:users.a,p_bundle:{inputs:[{id:'input01',title:'WORKER ISOLATED FIXTURE',body:['Try a word.'],audioKey:'input01/full.mp3'}]}});});
after(async()=>backend?.close());
test('W01 未配置不能伪称云库已连通；不允许service-role密钥',async()=>{
 const health=await call('/health',{},null,{SUPABASE_URL:''});assert.equal((await health.json()).configured,false);
 assert.equal((await call('/api/session',{method:'POST'},'a',{SUPABASE_URL:''})).status,503);
 assert.equal((await call('/api/session',{method:'POST'},'a',{SUPABASE_SERVICE_ROLE_KEY:'forbidden-fixture'})).status,503);
 assert.equal((await call('/api/session',{method:'POST'},'a',{SUPABASE_PUBLISHABLE_KEY:'sb_secret_not_a_public_key'})).status,503);
 const adminKey=btoa('{}')+'.'+btoa(JSON.stringify({role:'service_role'}))+'.fixture';
 assert.equal((await call('/api/session',{method:'POST'},'a',{SUPABASE_PUBLISHABLE_KEY:adminKey})).status,503);
});
test('W02 登录设置HttpOnly/Secure/SameSite会话，页面和接口无登录不可访问',async()=>{
 const r=await call('/api/auth/login',jsonInit({email:'a@fixture.invalid',password:'fixture-password'}),null);
 assert.equal(r.status,200);const cookies=r.headers.getSetCookie();assert.equal(cookies.length,2);for(const c of cookies){assert.match(c,/HttpOnly/);assert.match(c,/Secure/);assert.match(c,/SameSite=Strict/);}
 const body=await r.text();assert.doesNotMatch(body,/access_token|refresh_token|fixture-password/);
 assert.equal((await call('/',{},null)).status,303);assert.equal((await call('/api/records/inputs',{},null)).status,401);
 assert.equal((await call('/api/auth/login',jsonInit({email:'a@fixture.invalid',password:'wrong'}),null)).status,401);
});
test('W03 过期会话刷新与身份验证，跨站提交拒绝，账号编号只进受保护的脚本',async()=>{
 const r=await call('/api/session',{method:'POST',headers:{Cookie:'__Host-wb-access=expired; __Host-wb-refresh=verify-refresh-a'}},null);
 assert.equal(r.status,200);assert.equal((await r.json()).user_id,users.a);assert.equal(r.headers.getSetCookie().length,2);
 assert.equal((await call('/api/sync/push',{...jsonInit({device_id:'x',changes:[]}),headers:{Origin:'https://other.test'}})).status,403);
 const script=await call('/cloud-session.js');assert.equal(script.headers.get('Cache-Control'),'no-store');assert.match(await script.text(),new RegExp(users.a));
});
test('W04 原Store读取教材与句音路径；只读教材不接受任意PUT/DELETE',async()=>{
 const r=await call('/api/records/inputs');const rows=await r.json();assert.equal(rows[0].id,'input01');assert.equal(rows[0].audio_full,'/media/input01%2Ffull.mp3');
 assert.equal((await call('/api/records/inputs/input01',{method:'DELETE'})).status,403);
 assert.equal((await call('/api/records/progress/abc',jsonInit({id:'abc'},'PUT'))).status,403);
 assert.equal(await (await call('/api/records/progress/missing')).json(),null);
 assert.equal((await call('/api/records/inputs',{headers:{Cookie:cookie('b')}})).status,200);
 assert.equal((await (await call('/api/records/inputs',{},'b')).json()).length,0);
});
test('W05 设备上传→另一设备拉取→评分保护与冲突清单，不泄露其他账号',async()=>{
 await apply([change('work',{reading_checked:true,text:'first'})]);
 let r=await call('/api/sync/pull?since=0');assert.equal((await r.json()).records.find(x=>x.id==='work').data.reading_checked,true);
 const result=await apply([change('work',{reading_checked:false,text:'stale'},'progress',1000)]);assert.ok(result.conflicts.length);
 r=await call('/api/sync/log');assert.ok((await r.json()).length);
 const attempt=await call('/api/sync/push',{...jsonInit({device_id:'bad',changes:[change('work',{text:'steal'})]}),headers:{'Content-Type':'application/json','X-Learner-Id':users.a}},'b');assert.equal(attempt.status,403);
 assert.equal((await call('/api/coach/grades',jsonInit({updates:[{collection:'progress',id:'work',grade:{i1_final:'hit'}}]}))).status,403);
 assert.equal((await call('/api/sync/pull?since=-1')).status,400);
});
test('W06 教练账号通过X-Learner-Id注入，原input01不能改；学习者不能伪装教练',async()=>{
 const headers={'Content-Type':'application/json','X-Learner-Id':users.a};
 assert.equal((await call('/api/import',{...jsonInit({inputs:[{id:'input02',title:'ANOTHER FIXTURE',body:['Another.']}]}),headers},'coach')).status,200);
 assert.equal((await call('/api/import',{...jsonInit({inputs:[{id:'input01',title:'rewrite'}]}),headers},'coach')).status,400);
 assert.equal((await call('/api/import',jsonInit({inputs:[{id:'forbidden'}]}))).status,403);
});
test('W07 多遍录音原字节/MIME经存储传输保持一致；Range可播，元数据不装成.m4a',async()=>{
 for(const id of ['one','two']){
  const logical='shadowing/'+id+'.webm';await apply([change(id,{blobKey:logical,mime:'audio/webm',inputId:'input01'},'shadowing')]);
  const data=Uint8Array.from([26,69,223,163,0,1,2,id==='one'?3:4]);
  const r=await call('/api/sync/blobs/'+encodeURIComponent(logical),{method:'PUT',headers:{'Content-Type':'audio/webm','X-Blob-Meta':btoa(JSON.stringify({mime:'audio/webm',inputId:'input01'})),'X-Updated-At':String(Date.now()),'X-Device-Id':'phone'},body:data});
  assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).mime,'audio/webm');
  const download=await call('/api/blobs/'+encodeURIComponent(logical));assert.equal(download.headers.get('Content-Type'),'audio/webm');assert.deepEqual(new Uint8Array(await download.arrayBuffer()),data);
  const range=await call('/media/'+encodeURIComponent(logical),{headers:{Range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal(range.headers.get('Content-Range'),'bytes 0-3/8');assert.deepEqual(new Uint8Array(await range.arrayBuffer()),data.slice(0,4));
 }
 const sync=await (await call('/api/sync/pull?since=0')).json();assert.equal(sync.blobs.length,2);
});
test('W08 录音错误、超限、空音频、未引用音频拒绝，失败后本机可重试',async()=>{
 const headers={'Content-Type':'audio/webm','X-Blob-Meta':btoa('{}'),'X-Updated-At':String(Date.now()),'X-Device-Id':'phone'};
 assert.equal((await call('/api/sync/blobs/no-record',{method:'PUT',headers,body:new Uint8Array([1])})).status,400);
 assert.equal((await call('/api/sync/blobs/empty',{method:'PUT',headers,body:new Uint8Array()})).status,400);
 assert.equal((await call('/api/sync/blobs/huge',{method:'PUT',headers:{...headers,'Content-Length':'25000001'},body:new Uint8Array([1])})).status,413);
 assert.equal((await call('/api/sync/blobs/bad-meta',{method:'PUT',headers:{...headers,'X-Blob-Meta':'invalid'},body:new Uint8Array([1])})).status,400);
 assert.equal((await call('/api/blobs/absent')).status,404);
});
test('W09 健康检查与数据库检查区分；注销只清当前设备会话，敏感响应不缓存',async()=>{
 const health=await (await call('/health')).json();assert.equal(health.build,BUILD);assert.equal(health.validation_only,false);
 const check=await call('/api/cloud/check');assert.equal((await check.json()).database,'reachable');assert.equal(check.headers.get('Cache-Control'),'no-store');
 const logout=await call('/api/auth/logout',{method:'POST'});assert.equal(logout.status,200);for(const c of logout.headers.getSetCookie())assert.match(c,/Max-Age=0/);
 assert.ok(backend.calls.some(c=>c.route==='/auth/v1/logout'));
});
test('W10 上游跳转不能将用户JWT或密码转发给其他站点',async()=>{
 let requests=0;const redirectHandler=createHandler(async(_url,init)=>{requests++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});});
 const r=await redirectHandler(new Request('https://workbench.test/api/session',{method:'POST',headers:{Cookie:cookie('a')}}),env);assert.equal(r.status,502);assert.equal(requests,1);
});
test('W11 音频HEAD与无效/后缀Range按HTTP语义返回，避免Safari播放探测失败',async()=>{
 const path='/media/'+encodeURIComponent('shadowing/one.webm');
 const head=await call(path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'8');assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const range of ['bytes=99-','bytes=-0','bytes=0-1,3-4','bytes=-']){const r=await call(path,{headers:{Range:range}});assert.equal(r.status,416);assert.equal(r.headers.get('Content-Range'),'bytes */8');}
 const suffix=await call(path,{headers:{Range:'bytes=-3'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,3);
});
test('W12 Pages规范化index.html时，登录后首页返回正文且不循环跳转；未登录仍受保护',async()=>{
 const paths=[],ASSETS={fetch:async request=>{
  const path=new URL(request.url).pathname;paths.push(path);
  return path==='/index.html'?new Response(null,{status:308,headers:{Location:'/'}}):new Response('<html>authenticated workbench</html>',{headers:{'Content-Type':'text/html'}});
 }};
 for(const path of ['/','/index.html']){const r=await call(path,{},'a',{ASSETS});assert.equal(r.status,200);assert.equal(r.headers.get('Location'),null);assert.match(await r.text(),/authenticated workbench/);assert.equal(r.headers.get('Cache-Control'),'no-store');}
 assert.deepEqual(paths,['/','/']);
 assert.equal((await call('/',{},null,{ASSETS})).status,303);assert.equal(paths.length,2);
});
test('W13 正式账号迁移完成前不开放；服务端app_metadata区分工程/正式，user_metadata不能冒充',async()=>{
 try{
  backend.profiles.set(users.b,{user_metadata:{workbench_role:'learner',workbench_ready:true}});
  assert.equal((await(await call('/api/session',{method:'POST'},'b')).json()).validation_only,true);
  backend.profiles.set(users.b,{app_metadata:{workbench_role:'learner',workbench_ready:false}});
  assert.equal((await call('/',{},'b')).status,503);assert.equal((await call('/api/cloud/check',{},'b')).status,503);
  backend.profiles.set(users.b,{app_metadata:{workbench_role:'learner',workbench_ready:true,engineering_fixture:false}});
  const session=await call('/api/session',{method:'POST'},'b');assert.equal((await session.json()).validation_only,false);
  const script=await call('/cloud-session.js',{},'b');assert.match(await script.text(),/"validation":false/);
  assert.equal((await call('/',{},'b')).status,200);
 }finally{backend.profiles.delete(users.b);}
});
test('W14 修改密码要求登录/同源/当前密码及一致的新密码，仅修改当前账号，不泄露凭证',async()=>{
 const payload={current_password:'fixture-password',new_password:'Changed-fixture-123',confirm_password:'Changed-fixture-123'};
 try{
  assert.equal((await call('/api/auth/password',jsonInit(payload),null)).status,401);
  assert.equal((await call('/api/auth/password',{...jsonInit(payload),headers:{Origin:'https://untrusted.test'}})).status,403);
  for(const fields of [{current_password:'wrong'},{confirm_password:'mismatch'},{new_password:'short',confirm_password:'short'}])assert.equal((await call('/api/auth/password',jsonInit({...payload,...fields}))).status,400);
  assert.equal(backend.passwords.size,0);
  const response=await call('/api/auth/password',jsonInit({...payload,email:'b@fixture.invalid',id:users.b}));assert.equal(response.status,200);
  const text=await response.text();assert.doesNotMatch(text,/fixture-password|Changed-fixture|access_token|refresh_token/);
  assert.equal(response.headers.getSetCookie().length,2);for(const cookie of response.headers.getSetCookie())assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(backend.passwords.get(users.a),payload.new_password);assert.equal(backend.passwords.has(users.b),false);
  assert.equal((await call('/api/auth/login',jsonInit({email:'a@fixture.invalid',password:payload.current_password}),null)).status,401);
  assert.equal((await call('/api/auth/login',jsonInit({email:'a@fixture.invalid',password:payload.new_password}),null)).status,200);
 }finally{backend.passwords.clear();}
});
test('W15 身份重验不匹配或Auth更新失败时不设置新会话；临时会话退出，学习数据保留',async()=>{
 const init=jsonInit({current_password:'fixture-password',new_password:'Changed-fixture-123',confirm_password:'Changed-fixture-123'});
 const wrongIdentity=createHandler(async(url,options)=>String(url).includes('/auth/v1/token?')?new Response(JSON.stringify({access_token:'verify-access-b',refresh_token:'verify-refresh-b',user:{id:users.b}}),{headers:{'Content-Type':'application/json'}}):backend.fetch(url,options));
 const wrong=await wrongIdentity(new Request('https://workbench.test/api/auth/password',{...init,headers:{...init.headers,Cookie:cookie('a')}}),env);assert.equal(wrong.status,403);assert.equal(wrong.headers.get('Set-Cookie'),null);assert.equal(backend.passwords.size,0);
 let signouts=0;
 const failUpdate=createHandler(async(url,options)=>{
  if(String(url).includes('/auth/v1/user')&&options.method==='PUT')return new Response('{}',{status:503});
  if(String(url).includes('/auth/v1/logout'))signouts++;
  return backend.fetch(url,options);
 });
 const r=await failUpdate(new Request('https://workbench.test/api/auth/password',{...init,headers:{...init.headers,Cookie:cookie('a')}}),env);
 assert.equal(r.status,400);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(signouts,1);assert.equal(backend.passwords.size,0);
});
