/* All credentials and payloads arrive through stdin. No service-role key required. */
import {readFile} from 'node:fs/promises';
let input;
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2100000)throw Error('输入超过允许大小。');}input=JSON.parse(raw);
 const target=new URL(input.base);
 if(target.protocol!=='https:'||!target.hostname.endsWith('.pages.dev')||target.pathname!=='/'||target.search||target.hash)throw Error('仅允许工作台Cloudflare Pages的HTTPS根地址。');
 if(!['pending','import','grade','audio'].includes(input.action))throw Error('action仅接受pending/import/grade/audio。');
 const login=await fetch(target.origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:input.email,password:input.password}),redirect:'error'});
 if(!login.ok)throw Error('教练登录失败。');
 const cookies=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 if(input.action==='audio'){
  const data=await readFile(input.file);if(!data.length||data.length>25000000)throw Error('音频文件须为1–25000000字节。');
  const signature=data.subarray(0,12),kind=signature.subarray(0,4).toString();
  const mime=kind==='RIFF'&&signature.subarray(8,12).toString()==='WAVE'?'audio/wav':kind==='OggS'?'audio/ogg':signature.subarray(4,8).toString()==='ftyp'?'audio/mp4':signature.subarray(0,4).toString('hex')==='1a45dfa3'?'audio/webm':signature.subarray(0,3).toString()==='ID3'||(signature[0]===255&&(signature[1]&224)===224)?'audio/mpeg':null;
  if(!mime)throw Error('未识别到允许的真实音频格式，未上传。');
  const r=await fetch(target.origin+'/api/blobs/'+encodeURIComponent(input.key),{method:'PUT',redirect:'error',headers:{Cookie:cookies,'X-Learner-Id':input.learnerId,'Content-Type':mime,'X-Blob-Meta':Buffer.from(JSON.stringify({...input.meta,mime})).toString('base64')},body:data});
  if(!r.ok)throw Error('教材音频上传被拒绝：HTTP '+r.status);console.log(await r.text());process.exit(0);
 }
 const routes={pending:'/api/coach/pending',import:'/api/import',grade:'/api/coach/grades'},read=input.action==='pending';
 const response=await fetch(target.origin+routes[input.action],{method:read?'GET':'POST',redirect:'error',headers:{Cookie:cookies,'X-Learner-Id':input.learnerId,'Content-Type':'application/json'},...(!read?{body:JSON.stringify(input.payload)}:{})});
 if(!response.ok)throw Error('受控教练接口拒绝请求：HTTP '+response.status);
 console.log(await response.text());
}catch(error){console.error(String(error.message));process.exitCode=1;}
