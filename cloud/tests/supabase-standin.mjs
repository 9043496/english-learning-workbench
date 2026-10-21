/* Auth and Storage HTTP protocol stand-ins; real SQL/RLS via PostgreSQL WASM.
 * This explicitly does NOT constitute a hosted Supabase validation. */
import {database,users} from './database.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const identity=token=>Object.entries(users).find(([name])=>token==='verify-access-'+name)?.[1];
export async function standin(){
 const d=await database(),bytes=new Map(),calls=[],profiles=new Map(),passwords=new Map();
 async function handle(request){
  const url=new URL(request.url),route=url.pathname,authorization=request.headers.get('Authorization')||'',actor=identity(authorization.replace('Bearer ',''));calls.push({route,method:request.method});
  try{
   if(route==='/auth/v1/token'){
    const data=await request.json(),name=data.refresh_token?.replace('verify-refresh-','')||data.email?.split('@')[0];
    if(!users[name]||(!data.refresh_token&&data.password!==(passwords.get(users[name])||'fixture-password')))return json({message:'Invalid login'},400);
    return json({access_token:'verify-access-'+name,refresh_token:'verify-refresh-'+name,expires_in:3600,user:{id:users[name]}});
   }
   if(!actor)return json({message:'unauthenticated'},401);
   if(route==='/auth/v1/user'){
    if(request.method==='PUT'){const data=await request.json();if(data.current_password!==(passwords.get(actor)||'fixture-password'))return json({message:'Wrong password'},400);passwords.set(actor,data.password);}
    return json({id:actor,email:Object.entries(users).find(([,id])=>id===actor)[0]+'@fixture.invalid',...profiles.get(actor)});
   }
   if(route==='/auth/v1/logout')return json({ok:true});
   if(route.startsWith('/rest/v1/rpc/')){
    const name=route.split('/').at(-1);if(!/^wb_[a-z_]+$/.test(name))return json({},404);
    return json(await d.rpc(actor,name,await request.json()));
   }
   if(route.startsWith('/rest/v1/')){
    const table=route.split('/').at(-1);
    const columns={wb_records:['data'],wb_blobs:['key','size','mime','path'],wb_sync_log:['id','at','device_id','collection','record_id','fields']}[table];
    if(!columns||request.method!=='GET')return json({},404);
    const select=(url.searchParams.get('select')||columns.join(',')).split(',');if(select.some(c=>!columns.includes(c)))return json({},400);
    let sql='select '+select.join(',')+' from public.'+table+' where owner_id=$1',params=[url.searchParams.get('owner_id').slice(3)];
    for(const field of ['collection','id','key'])if(url.searchParams.has(field)){params.push(url.searchParams.get(field).slice(3));sql+=' and '+field+'=$'+params.length;}
    const order=url.searchParams.get('order');if(order==='id.asc')sql+=' order by id asc';if(order==='id.desc')sql+=' order by id desc';if(order==='key.asc')sql+=' order by key asc';
    params.push(Number(url.searchParams.get('limit')||1000));sql+=' limit $'+params.length;params.push(Number(url.searchParams.get('offset')||0));sql+=' offset $'+params.length;
    return json((await d.as(actor,db=>db.query(sql,params))).rows);
   }
   const prefix='/storage/v1/object/',bucket='workbench-audio';
   if(route===prefix+bucket&&request.method==='DELETE'){
    const body=await request.json();
    for(const path of body.prefixes){const deleted=await d.as(actor,db=>db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id',[bucket,path]));if(deleted.rows.length)bytes.delete(path);}
    return json({ok:true});
   }
   const authenticated=route.startsWith(prefix+'authenticated/'+bucket+'/');
   const marker=prefix+(authenticated?'authenticated/':'')+bucket+'/',path=decodeURIComponent(route.slice(marker.length));
   if(!route.startsWith(marker))return json({},404);
   if(request.method==='POST'){
    const data=new Uint8Array(await request.arrayBuffer()),mime=request.headers.get('Content-Type');
    await d.as(actor,db=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,path,{size:data.length,mimetype:mime}]));
    bytes.set(path,{data,mime});return json({Key:path});
   }
   if(['GET','HEAD'].includes(request.method)){
    const found=await d.as(actor,db=>db.query('select name from storage.objects where bucket_id=$1 and name=$2',[bucket,path]));
    if(!found.rows.length||!bytes.has(path))return json({},404);
    const {data,mime}=bytes.get(path),range=request.headers.get('Range'),headers={'Content-Type':mime,'Content-Length':String(data.length)};
    if(range){
     const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});
     const a=match[1]?Number(match[1]):Math.max(0,data.length-Number(match[2])),b=match[1]&&match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;
     if(a>b||a>=data.length)return new Response(null,{status:416});
     return new Response(data.slice(a,b+1),{status:206,headers:{...headers,'Content-Length':String(b-a+1),'Content-Range':'bytes '+a+'-'+b+'/'+data.length}});
    }
    return new Response(request.method==='HEAD'?null:data,{headers});
   }
   return json({},404);
  }catch(error){return json({message:error.message},400);}
 }
 return {d,calls,bytes,profiles,passwords,fetch:(input,init)=>handle(input?.url&&input?.method?input:new Request(input,init)),close:()=>d.close()};
}
