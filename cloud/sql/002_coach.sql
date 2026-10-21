begin;
create function wb_private.validate_pack(pack jsonb) returns void language plpgsql set search_path='' as $$
declare kind text; q jsonb; p jsonb; ids text[]:=array[]::text[]; opt text[]; part_ids text[]; tasks jsonb;
begin
 if jsonb_typeof(pack) is distinct from 'object' or length(trim(coalesce(pack->>'id','')))=0 then raise exception 'WB_INVALID_PACK'; end if;
 if pack->>'type' is distinct from 'level_test' then
  if pack ? 'reused_vocab' then
   if jsonb_typeof(pack->'reused_vocab') is distinct from 'array' or jsonb_array_length(pack->'reused_vocab') not between 3 and 5 then raise exception 'WB_INVALID_REUSED_VOCAB'; end if;
  end if;
  return;
 end if;
 if jsonb_typeof(pack->'sections') is distinct from 'object' or (select count(*) from jsonb_object_keys(pack->'sections'))<>4 or not (pack->'sections') ?& array['listening','reading','speaking','writing'] then raise exception 'WB_INVALID_SECTIONS'; end if;
 foreach kind in array array['listening','reading'] loop
  if jsonb_typeof(pack#>array['sections',kind,'questions']) is distinct from 'array' or jsonb_array_length(pack#>array['sections',kind,'questions'])=0 then raise exception 'WB_INVALID_QUESTIONS'; end if;
  for q in select * from jsonb_array_elements(pack#>array['sections',kind,'questions']) loop
   if length(trim(coalesce(q->>'id','')))=0 or length(trim(coalesce(q->>'q','')))=0 or q->>'id'=any(ids) or jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options')<>4 then raise exception 'WB_INVALID_QUESTIONS'; end if;
   select array_agg(o->>'id') into opt from jsonb_array_elements(q->'options') o where length(trim(coalesce(o->>'id','')))>0 and length(trim(coalesce(o->>'text','')))>0;
   if cardinality(opt) is distinct from 4 or (select count(distinct x) from unnest(opt) x)<>4 or (q ? 'correct_option_id' and not (q->>'correct_option_id'=any(opt))) then raise exception 'WB_INVALID_OPTIONS'; end if;
   ids:=array_append(ids,q->>'id');
  end loop;
 end loop;
 if length(trim(coalesce(pack#>>'{sections,listening,audioKey}','')))=0 or pack#>'{sections,reading,body}' is null or length(trim(coalesce(pack#>>'{sections,writing,prompt}','')))=0 then raise exception 'WB_INVALID_SECTIONS'; end if;
 select array_agg(t.part->>'part' order by t.n) into part_ids from jsonb_array_elements(pack#>'{sections,speaking,parts}') with ordinality t(part,n);
 if part_ids is distinct from array['1','2','3'] then raise exception 'WB_INVALID_PARTS'; end if;
 for p in select * from jsonb_array_elements(pack#>'{sections,speaking,parts}') loop
  if p->>'part'='2' then
   if coalesce(p->>'preparation_seconds','60')<>'60' or coalesce(p->>'response_seconds','120')<>'120' or jsonb_typeof(p->'task') is distinct from 'object' then raise exception 'WB_INVALID_PART2'; end if;
  elsif jsonb_typeof(p->'questions') is distinct from 'array' or jsonb_array_length(p->'questions')=0 then raise exception 'WB_INVALID_PARTS'; end if;
 end loop;
 tasks:=wb_private.speech_tasks(pack);
 for q in select * from jsonb_array_elements(tasks) loop
  if length(trim(coalesce(q->>'id','')))=0 or length(trim(coalesce(q->>'text','')))=0 or q->>'id'=any(ids) then raise exception 'WB_INVALID_TASK'; end if;
  ids:=array_append(ids,q->>'id');
 end loop;
 if pack ? 'score_scale' and (jsonb_typeof(pack#>'{score_scale,min}') is distinct from 'number' or jsonb_typeof(pack#>'{score_scale,max}') is distinct from 'number' or (pack#>>'{score_scale,min}')::numeric>=(pack#>>'{score_scale,max}')::numeric) then raise exception 'WB_INVALID_SCALE'; end if;
end $$;

create function wb_private.wb_import(p_owner uuid,p_bundle jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c text; r jsonb; old jsonb; count_rows integer:=0; stamp bigint;
begin
 perform wb_private.require_coach(p_owner);perform wb_private.lock_owner(p_owner);
 if jsonb_typeof(p_bundle) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_bundle) k where k not in ('inputs','sentences','dictation_tasks')) then raise exception 'WB_IMPORT_CONTENT_ONLY'; end if;
 for c in select jsonb_object_keys(p_bundle) loop
  if jsonb_typeof(p_bundle->c) is distinct from 'array' or jsonb_array_length(p_bundle->c)>100 then raise exception 'WB_INVALID_BUNDLE'; end if;
  for r in select * from jsonb_array_elements(p_bundle->c) loop
   if length(trim(coalesce(r->>'id','')))=0 or length(r->>'id')>200 or octet_length(r::text)>2000000 then raise exception 'WB_INVALID_PACK'; end if;
   if c='inputs' then perform wb_private.validate_pack(r); end if;
   select data into old from public.wb_records where owner_id=p_owner and collection=c and id=r->>'id';
   if found then
    if old is distinct from r then raise exception 'WB_CONTENT_IMMUTABLE'; end if;
    continue;
   end if;
   stamp:=wb_private.tick(p_owner);
   insert into public.wb_records values(p_owner,c,r->>'id',r,stamp,stamp);count_rows:=count_rows+1;
  end loop;
 end loop;
 return jsonb_build_object('imported',count_rows);
end $$;

create function wb_private.teaching_key(p_owner uuid,p_key text) returns boolean language plpgsql stable set search_path='' as $$
declare r record; k text; v jsonb;
begin
 for r in select id,data from public.wb_records where owner_id=p_owner and collection in ('inputs','sentences','dictation_tasks') loop
  if p_key=r.id||'/full.mp3' then return true; end if;
  foreach k in array array['audio','audio_full','audioKey','audio_blob_key','blobKey'] loop
   for v in select * from jsonb_path_query(r.data,('$.**.'||k)::jsonpath) loop
    if jsonb_typeof(v)='string' and (v#>>'{}'=p_key or r.id||'/'||(v#>>'{}')=p_key) then return true; end if;
   end loop;
  end loop;
 end loop;return false;
end $$;

create function wb_private.wb_content_blob(p_owner uuid,p_key text,p_path text,p_size bigint,p_mime text,p_meta jsonb,p_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.wb_blobs; obj storage.objects; stamp bigint;
begin
 perform wb_private.require_coach(p_owner);perform wb_private.lock_owner(p_owner);
 if not coalesce(length(p_key) between 1 and 200 and p_path like p_owner::text||'/content/'||encode(convert_to(p_key,'UTF8'),'hex')||'/%' and p_mime like 'audio/%' and p_size between 1 and 25000000 and p_digest ~ '^[a-f0-9]{64}$',false) then raise exception 'WB_INVALID_BLOB'; end if;
 select * into obj from storage.objects where bucket_id='workbench-audio' and name=p_path;
 if obj.id is null or (obj.metadata->>'size')::bigint is distinct from p_size or obj.metadata->>'mimetype' is distinct from p_mime then raise exception 'WB_BLOB_NOT_UPLOADED'; end if;
 select * into old from public.wb_blobs where owner_id=p_owner and key=p_key;
 if old.key is not null then
  if old.digest=p_digest and old.mime=p_mime then return jsonb_build_object('key',p_key,'size',old.size,'mime',old.mime,'garbage_path',p_path); end if;
  raise exception 'WB_CONTENT_IMMUTABLE';
 end if;
 if (select coalesce(sum(size),0) from public.wb_blobs where owner_id=p_owner)+p_size>800000000 then raise exception 'WB_QUOTA'; end if;
 stamp:=wb_private.tick(p_owner);
 insert into public.wb_blobs values(p_owner,p_key,p_path,p_size,p_mime,p_meta,p_digest,stamp,stamp);
 return jsonb_build_object('key',p_key,'size',p_size,'mime',p_mime);
end $$;

create function wb_private.wb_blob_preflight(p_owner uuid,p_key text,p_content boolean,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_content then perform wb_private.require_coach(p_owner);else perform wb_private.require_owner(p_owner);end if;
 if not coalesce(length(p_key) between 1 and 200 and p_size between 1 and 25000000,false) then raise exception 'WB_INVALID_BLOB';end if;
 if not p_content and (not wb_private.blob_referenced(p_owner,p_key) or wb_private.teaching_key(p_owner,p_key)) then raise exception 'WB_BLOB_NOT_LEARNING';end if;
 if (select coalesce(sum(size),0) from public.wb_blobs where owner_id=p_owner)+p_size>800000000 then raise exception 'WB_QUOTA';end if;
 return '{"ok":true}'::jsonb;
end $$;
create function wb_private.wb_ping(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform wb_private.require_owner(p_owner);
 return jsonb_build_object('ok',true,'cursor',coalesce((select value from public.wb_clocks where owner_id=p_owner),0));
end $$;
create policy wb_audio_delete_coach_orphan on storage.objects for delete to authenticated using(bucket_id='workbench-audio' and (storage.foldername(name))[2]='content' and wb_private.is_coach(((storage.foldername(name))[1])::uuid) and wb_private.unreferenced(name));

create function wb_private.grade_one(p_owner uuid,c text,cur jsonb,g jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb:=cur; k text; v jsonb; part jsonb; total numeric; correct numeric; score numeric; a jsonb; pack jsonb; history jsonb; entry jsonb;
begin
 if jsonb_typeof(g) is distinct from 'object' then raise exception 'WB_INVALID_GRADE'; end if;
 if c='progress' and cur->>'kind'='level_test' then
  if coalesce(cur->>'status','') not in ('submitted','graded') or not g ? 'assessment' or exists(select 1 from jsonb_object_keys(g) x where x not in ('assessment','status','graded_at')) then raise exception 'WB_INVALID_GRADE'; end if;
  a:=g->'assessment';
  if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a))<>4 or not a ?& array['scores','overall_comment','level','next_month_advice'] or jsonb_typeof(a->'scores') is distinct from 'object' or (select count(*) from jsonb_object_keys(a->'scores'))<>4 or not (a->'scores') ?& array['listening','reading','speaking','writing'] then raise exception 'WB_INVALID_ASSESSMENT'; end if;
  select data into pack from public.wb_records where owner_id=p_owner and collection='inputs' and id=cur->>'inputId';
  foreach k in array array['listening','reading','speaking','writing'] loop
   if jsonb_typeof(a#>array['scores',k]) is distinct from 'number' then raise exception 'WB_INVALID_ASSESSMENT'; end if;
   score:=(a#>>array['scores',k])::numeric;
   if score<0 or (pack ? 'score_scale' and (score<(pack#>>'{score_scale,min}')::numeric or score>(pack#>>'{score_scale,max}')::numeric)) then raise exception 'WB_INVALID_ASSESSMENT'; end if;
  end loop;
  foreach k in array array['overall_comment','level','next_month_advice'] loop
   if length(trim(coalesce(a->>k,'')))=0 then raise exception 'WB_INVALID_ASSESSMENT'; end if;
  end loop;
  perform wb_private.validate_attempt(p_owner,'{}',cur);
  for entry in select * from jsonb_array_elements(cur#>'{answers,speaking}') loop
   if not exists(select 1 from public.wb_blobs where owner_id=p_owner and key=entry->>'blobKey') then raise exception 'WB_MISSING_SPEECH_BLOB'; end if;
  end loop;
  result:=cur||g||'{"status":"graded","completed":false,"i1_suggested":null}'::jsonb;
 elsif c='progress' then
  if exists(select 1 from jsonb_object_keys(g) x where x not in ('status','note','graded_at','i1_final','i1_overridden','i1_override_note','discussion_completed','discussion_note','comprehension','polysemy')) then raise exception 'WB_ORIGINAL_ANSWERS'; end if;
  for k,v in select * from jsonb_each(g) loop
   if k in ('comprehension','polysemy') then
    part:=cur->k;
    if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(part) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v) x where x not in ('correct','total','note','status','graded_at')) or coalesce(part->>'status','') not in ('submitted','graded') then raise exception 'WB_INVALID_GRADE'; end if;
    total:=coalesce((part->>'total')::numeric,jsonb_array_length(part->'answers'));correct:=(v->>'correct')::numeric;
    if total is null or total<0 or total<>floor(total) or coalesce((v->>'total')::numeric,total)<>total or correct is null or correct<0 or correct>total or correct<>floor(correct) then raise exception 'WB_INVALID_GRADE'; end if;
    result:=result||jsonb_build_object(k,part||v||jsonb_build_object('status','graded','correct',correct,'total',total));
   else result:=result||jsonb_build_object(k,v); end if;
  end loop;
  if g ? 'i1_final' and coalesce(g->>'i1_final','') not in ('hit','easy','hard') then raise exception 'WB_INVALID_GRADE'; end if;
 elsif c='shadowing' then
  if exists(select 1 from jsonb_object_keys(g) x where x not in ('score','status','graded_at')) or jsonb_typeof(g->'score') is distinct from 'object' or exists(select 1 from jsonb_object_keys(g->'score') x where x not in ('fluency','pronunciation','completeness','note')) then raise exception 'WB_ORIGINAL_AUDIO'; end if;
  foreach k in array array['fluency','pronunciation','completeness'] loop
   if jsonb_typeof(g#>array['score',k]) is distinct from 'number' or (g#>>array['score',k])::numeric not between 1 and 3 or (g#>>array['score',k])::numeric<>floor((g#>>array['score',k])::numeric) then raise exception 'WB_INVALID_GRADE'; end if;
  end loop;
  result:=cur||g||'{"status":"graded"}'::jsonb;
 elsif c='vocab' then
  if exists(select 1 from jsonb_object_keys(g) x where x not in ('status','note','graded_at','quiz_history')) or coalesce(g->>'status',cur->>'status','') not in ('new','reviewing','mastered') or jsonb_typeof(coalesce(g->'quiz_history','[]'))<>'array' then raise exception 'WB_INVALID_GRADE'; end if;
  history:=coalesce(cur->'quiz_history','[]');
  for entry in select * from jsonb_array_elements(coalesce(g->'quiz_history','[]')) loop
   if jsonb_typeof(entry->'correct') is distinct from 'boolean' or length(trim(coalesce(entry->>'quiz_id','')))=0 or exists(select 1 from jsonb_object_keys(entry) x where x not in ('quiz_id','date','correct','note')) then raise exception 'WB_INVALID_GRADE'; end if;
   if not exists(select 1 from jsonb_array_elements(history) h where h->>'quiz_id'=entry->>'quiz_id') then history:=history||jsonb_build_array(entry); end if;
  end loop;
  result:=cur||(g-'quiz_history')||jsonb_build_object('quiz_history',history,'quizzes',jsonb_array_length(history),'correct',(select count(*) from jsonb_array_elements(history) h where h->'correct'='true'::jsonb));
 else raise exception 'WB_INVALID_GRADE_COLLECTION'; end if;
 return result||jsonb_build_object('graded_at',clock_timestamp());
end $$;
create function wb_private.wb_grade(p_owner uuid,p_updates jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; cur jsonb; next_data jsonb; stamp bigint; n integer:=0;
begin
 perform wb_private.require_coach(p_owner);perform wb_private.lock_owner(p_owner);
 if jsonb_typeof(p_updates) is distinct from 'array' or jsonb_array_length(p_updates)>100 then raise exception 'WB_INVALID_GRADE'; end if;
 for item in select * from jsonb_array_elements(p_updates) loop
  if (select count(*) from jsonb_object_keys(item))<>3 or not item ?& array['collection','id','grade'] then raise exception 'WB_INVALID_GRADE'; end if;
  select data into cur from public.wb_records where owner_id=p_owner and collection=item->>'collection' and id=item->>'id';
  if cur is null then raise exception 'WB_NOT_FOUND'; end if;
  next_data:=wb_private.grade_one(p_owner,item->>'collection',cur,item->'grade');stamp:=wb_private.tick(p_owner);
  update public.wb_records set data=next_data,updated_at=stamp,write_at=stamp where owner_id=p_owner and collection=item->>'collection' and id=item->>'id';n:=n+1;
 end loop;return jsonb_build_object('gradedRecords',n);
end $$;
-- Public RPCs preserve the caller; private implementations independently check identity and owner/coach rights.
create function public.wb_import(p_owner uuid,p_bundle jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_import(p_owner,p_bundle)
$$;
create function public.wb_content_blob(p_owner uuid,p_key text,p_path text,p_size bigint,p_mime text,p_meta jsonb,p_digest text) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_content_blob(p_owner,p_key,p_path,p_size,p_mime,p_meta,p_digest)
$$;
create function public.wb_blob_preflight(p_owner uuid,p_key text,p_content boolean,p_size bigint) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_blob_preflight(p_owner,p_key,p_content,p_size)
$$;
create function public.wb_ping(p_owner uuid) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_ping(p_owner)
$$;
create function public.wb_grade(p_owner uuid,p_updates jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_grade(p_owner,p_updates)
$$;
revoke execute on all functions in schema wb_private from public,anon,authenticated;
grant execute on function wb_private.is_coach(uuid),wb_private.unreferenced(text) to authenticated;
grant execute on function wb_private.wb_push(uuid,jsonb),wb_private.wb_pull(uuid,bigint),wb_private.wb_finish_blob(uuid,text,text,bigint,text,jsonb,text,bigint,text),wb_private.wb_import(uuid,jsonb),wb_private.wb_content_blob(uuid,text,text,bigint,text,jsonb,text),wb_private.wb_blob_preflight(uuid,text,boolean,bigint),wb_private.wb_ping(uuid),wb_private.wb_grade(uuid,jsonb) to authenticated;

revoke execute on function public.wb_import(uuid,jsonb),public.wb_content_blob(uuid,text,text,bigint,text,jsonb,text),public.wb_grade(uuid,jsonb),public.wb_blob_preflight(uuid,text,boolean,bigint),public.wb_ping(uuid) from public,anon;
grant execute on function public.wb_import(uuid,jsonb),public.wb_content_blob(uuid,text,text,bigint,text,jsonb,text),public.wb_grade(uuid,jsonb),public.wb_blob_preflight(uuid,text,boolean,bigint),public.wb_ping(uuid) to authenticated;
commit;
