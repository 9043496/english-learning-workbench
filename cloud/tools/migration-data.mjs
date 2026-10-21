/* Trusted local migration SQL, never a public RPC or deployed Worker module. */
import {createHash} from 'node:crypto';
export const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validateSnapshot(snapshot){
 const collections=new Set(['inputs','sentences','dictation_tasks','progress','vocab','shadowing','dictation']),ids=new Set(),keys=new Set();
 if(!Array.isArray(snapshot.records)||!Array.isArray(snapshot.blobs))throw Error('Invalid source snapshot');
 for(const row of snapshot.records){
  const key=row.collection+'\0'+row.id;
  if(!collections.has(row.collection)||typeof row.id!=='string'||!row.id.length||row.id.length>200||row.data?.id!==row.id||ids.has(key)||!Number.isSafeInteger(row.updated_at)||!Number.isSafeInteger(row.write_at))throw Error('Invalid or duplicate source record');
  ids.add(key);
 }
 for(const row of snapshot.blobs){
  if(typeof row.key!=='string'||!row.key.length||row.key.length>200||keys.has(row.key)||row.filename!==digest(row.key)+'.blob'||!/^audio\//.test(row.mime)||!Number.isSafeInteger(row.size)||row.size<1||row.size>25000000||!Number.isSafeInteger(row.updated_at)||!Number.isSafeInteger(row.write_at)||!row.meta||typeof row.meta!=='object')throw Error('Invalid or duplicate source audio');
  keys.add(row.key);
 }
 if(snapshot.blobs.reduce((sum,row)=>sum+row.size,0)>800000000)throw Error('Source exceeds reserved free storage');
 return snapshot;
}
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
export function migrationSql(snapshot,owner,coach){
 validateSnapshot(snapshot);
 if(!uuid(owner)||!uuid(coach)||owner===coach)throw Error('Invalid migration identity');
 for(const row of snapshot.blobs)if(!row.path?.startsWith(owner+'/')||!/^[a-f0-9]{64}$/.test(row.digest||''))throw Error('Invalid destination audio');
 let delimiter='$wb_migration$';const body=JSON.stringify(snapshot);
 while(body.includes(delimiter))delimiter=delimiter.slice(0,-1)+'_$';
 return `begin;
 select wb_private.lock_owner('${owner}'::uuid);
 do ${delimiter}
 declare o uuid:='${owner}'; r jsonb; b jsonb; old jsonb; stamp bigint;
   source jsonb:=${literal(snapshot.records)};
   audio jsonb:=${literal(snapshot.blobs.map(({filename,...row})=>row))};
 begin
   -- Refuse mixed accounts and edits: no UPDATE, DELETE or grade recalculation.
   if exists(select 1 from public.wb_records t where owner_id=o and not exists(select 1 from jsonb_array_elements(source) s where s->>'collection'=t.collection and s->>'id'=t.id)) then raise exception 'MIGRATION_TARGET_NOT_EMPTY'; end if;
   for r in select * from jsonb_array_elements(source) loop
     select data into old from public.wb_records where owner_id=o and collection=r->>'collection' and id=r->>'id';
     if found then
       if old is distinct from r->'data' then raise exception 'MIGRATION_RECORD_CONFLICT'; end if;
     else
       stamp:=wb_private.tick(o);
       insert into public.wb_records values(o,r->>'collection',r->>'id',r->'data',stamp,greatest((r->>'updated_at')::bigint,(r->>'write_at')::bigint,0));
     end if;
   end loop;
   for b in select * from jsonb_array_elements(audio) loop
     if not exists(select 1 from storage.objects where bucket_id='workbench-audio' and name=b->>'path' and (metadata->>'size')::bigint=(b->>'size')::bigint and metadata->>'mimetype'=b->>'mime') then raise exception 'MIGRATION_AUDIO_NOT_UPLOADED'; end if;
     select to_jsonb(t) into old from public.wb_blobs t where owner_id=o and key=b->>'key';
     if found then
       if old->>'digest' is distinct from b->>'digest' or old->>'mime' is distinct from b->>'mime' or old->'size' is distinct from b->'size' or old->'meta' is distinct from b->'meta' then raise exception 'MIGRATION_BLOB_CONFLICT'; end if;
     else
       stamp:=wb_private.tick(o);
       insert into public.wb_blobs values(o,b->>'key',b->>'path',(b->>'size')::bigint,b->>'mime',b->'meta',b->>'digest',stamp,greatest((b->>'updated_at')::bigint,(b->>'write_at')::bigint,0));
     end if;
   end loop;
   insert into public.wb_coaches values('${coach}',o) on conflict do nothing;
 end ${delimiter};
 commit;
 select jsonb_build_object('records',(select count(*) from public.wb_records where owner_id='${owner}'),'blobs',(select count(*) from public.wb_blobs where owner_id='${owner}')) as migration_result;`;
}
