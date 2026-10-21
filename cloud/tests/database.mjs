import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const users = {
 a:'11111111-1111-4111-8111-111111111111',
 b:'22222222-2222-4222-8222-222222222222',
 coach:'33333333-3333-4333-8333-333333333333'
};
export async function database(){
 const db=new PGlite();
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon;
  grant execute on function auth.uid() to authenticated,anon;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  grant usage on schema storage to authenticated;
  grant select,insert,update,delete on storage.objects to authenticated;
 `);
 for(const id of Object.values(users))await db.query('insert into auth.users values($1)',[id]);
 for(const name of ['001_workbench.sql','002_coach.sql'])await db.exec(await readFile(new URL('../sql/'+name,import.meta.url),'utf8'));
 await db.query('insert into public.wb_coaches values($1,$2)',[users.coach,users.a]);
 // Real PostgreSQL executes queries and RLS. Auth/storage schemas above are
 // test scaffolding, not hosted Supabase.
 let queue=Promise.resolve();
 const as=(id,fn,role='authenticated')=>{
  const operation=queue.then(async()=>{
   await db.exec('begin');
   try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
    await db.exec('set local role '+role);
    const result=await fn(db);await db.exec('commit');return result;
   }catch(error){await db.exec('rollback');throw error;}
  });
  queue=operation.catch(()=>{});return operation;
 };
 const rpc=(actor,name,args)=>as(actor,async db=>{
  const placeholders=Object.keys(args).map((_,i)=>'$'+(i+1)).join(',');
  const r=await db.query('select public.'+name+'('+placeholders+') as result',Object.values(args));
  return r.rows[0].result;
 });
 return {db,as,rpc,async close(){await queue;await db.close();}};
}
export const change=(id,data,collection='progress',at=Date.now())=>({
 collection,id,change_id:crypto.randomUUID(),updated_at:at,data:{...data,id}
});
export const push=(d,actor,changes,device='device-a')=>d.rpc(actor,'wb_push',{p_owner:actor,p_payload:{device_id:device,changes}});
export function testPack(){
 const options=['a','b','c','d'].map(id=>({id,text:'Fixture option '+id}));
 return {id:'monthly-fixture',type:'level_test',title:'ISOLATED TEST FIXTURE',
  score_scale:{min:0,max:9},
  sections:{
   listening:{audioKey:'monthly-fixture/listen.mp3',questions:[{id:'listen-1',q:'Fixture listening?',options}]},
   reading:{body:['Fixture reading.'],questions:[{id:'read-1',q:'Fixture reading?',options}]},
   writing:{prompt:'Write an isolated fixture response.'},
   speaking:{parts:[{part:1,questions:[{id:'speak-1',text:'Fixture first question?'}]},{part:2,preparation_seconds:60,response_seconds:120,task:{id:'speak-2',text:'Fixture cue card?'}},{part:3,questions:[{id:'speak-3',text:'Fixture follow-up?'}]}]}
  }
 };
}
