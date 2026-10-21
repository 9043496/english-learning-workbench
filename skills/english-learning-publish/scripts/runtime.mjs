/* Portable user-owned configuration. Never uses an installed author's accounts. */
import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,isAbsolute} from 'node:path';
export function configPath(){
 const home=homedir();
 const root=process.platform==='darwin'?resolve(home,'Library/Application Support/English Learning Workbench'):process.platform==='win32'?resolve(process.env.LOCALAPPDATA||resolve(home,'AppData/Local'),'English Learning Workbench'):resolve(process.env.XDG_DATA_HOME||resolve(home,'.local/share'),'english-learning-workbench');
 return process.env.WORKBENCH_CONFIG||resolve(root,'config.json');
}
export function loadConfig(optional=false){
 try{return JSON.parse(readFileSync(configPath(),'utf8'));}
 catch(e){if(optional&&e.code==='ENOENT')return null;throw Error('PRIVATE_CONFIG_REQUIRED_RUN_INSTALLER');}
}
function privateJson(file){
 if(!isAbsolute(file||''))throw Error('PRIVATE_ABSOLUTE_PATH_REQUIRED');
 const stat=statSync(file);if(process.platform!=='win32'&&(stat.mode&0o077))throw Error('CREDENTIAL_FILE_MUST_BE_0600');
 return JSON.parse(readFileSync(file,'utf8'));
}
export async function connect(){
 const config=loadConfig(),url=new URL(config.base_url);
 if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('CONFIG_ROOT_URL_REQUIRED');
 const local=config.mode==='local';
 if(local&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('LOCAL_LOOPBACK_REQUIRED');
 if(!local&&(config.mode!=='cloud'||url.protocol!=='https:'||!/^[a-f0-9-]{36}$/i.test(config.learner_id||'')))throw Error('CLOUD_CONFIG_INVALID');
 let token,cookies='',headers={},cloudLogin=false;
 if(local){token=privateJson(resolve(config.data_dir,'settings.json')).token;if(!token)throw Error('START_LOCAL_SERVICE_FIRST');}
 else{
  const credentials=privateJson(config.coach_credentials_file);
  if(credentials.access_token)token=credentials.access_token;
  else{
   if(!credentials.email||!credentials.password)throw Error('COACH_CREDENTIALS_REQUIRED');
   const r=await fetch(url.origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:credentials.email,password:credentials.password}),redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw Error('COACH_LOGIN_FAILED');
   cookies=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');cloudLogin=true;
  }
  headers['X-Learner-Id']=config.learner_id;
 }
 if(token)headers.Authorization='Bearer '+token;else headers.Cookie=cookies;
 async function request(route,init={}){
  if(!/^\/(api|media)\//.test(route)||route.includes('..')||route.includes('://'))throw Error('ROUTE_BLOCKED');
  const {requireStatus,requireMime,...options}=init;
  const r=await fetch(url.origin+route,{...options,headers:{...options.headers,...headers},redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!r.ok||requireStatus&&r.status!==requireStatus)throw Error('COACH_HTTP_'+r.status);
  if(requireMime&&r.headers.get('Content-Type')?.split(';')[0]!==requireMime)throw Error('COACH_AUDIO_MIME_MISMATCH');
  return r;
 }
 return {json:async(route,init)=>(await request(route,init)).json(),bytes:async(route,init)=>Buffer.from(await(await request(route,init)).arrayBuffer()),close:async()=>{
  if(cloudLogin){const r=await fetch(url.origin+'/api/auth/logout',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('COACH_SESSION_CLEANUP_FAILED');}
 }};
}
