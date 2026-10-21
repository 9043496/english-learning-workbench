/* 正文匹配工具。只解析 Muse 提供的文本、翻译和 wordpack，不生成词义。 */
(function(root){
'use strict';
const lex=text=>Array.from(String(text??'').matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu),m=>({text:m[0],start:m.index,end:m.index+m[0].length,key:m[0].normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu,'')}));
const normalize=text=>lex(text).map(t=>t.key).join(' ');
const term=entry=>typeof entry?.phrase==='string'&&entry.phrase.trim()?entry.phrase:entry?.w||'';
function sentences(pack,group){
 const saved=Array.isArray(group)?group:group?.items||group?.sentences||[];
 const inline=Array.isArray(pack?.sentences)?pack.sentences:[];
 return (inline.length?inline:saved).map((row,i)=>{const n=row.n??i+1,extra=saved.find(s=>String(s.n??saved.indexOf(s)+1)===String(n));return {...(extra?.text===row.text?extra:{}),...row,n};}).filter(row=>typeof row.text==='string'&&row.text.trim());
}
function units(pack,rows){
 const body=Array.isArray(pack?.body)?pack.body.map(p=>typeof p==='string'?p:p?.text||'').join('\n\n'):typeof pack?.body==='string'?pack.body:'';
 if(!body)return rows.map((r,i)=>({...r,index:i,mapped:true}));
 const result=[];let offset=0;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],pattern=row.text.trim().split(/\s+/).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
  const match=new RegExp(pattern,'u').exec(body.slice(offset));if(!match)continue;
  const start=offset+match.index;if(start>offset)result.push({text:body.slice(offset,start),n:null,index:-1,mapped:false});
  result.push({...row,text:match[0],index:i,mapped:true});offset=start+match[0].length;
 }
 if(offset<body.length)result.push({text:body.slice(offset),n:null,index:-1,mapped:false});
 return result;
}
function segments(text,wordpack,n,vocab=[]){
 const tokens=lex(text),candidates=[];
 for(const entry of Array.isArray(wordpack)?wordpack:[]){
  if(!entry||typeof entry.w!=='string')continue;
  const contextual=entry.n!==undefined&&entry.n!==null;
  if(contextual&&(n==null||!(Array.isArray(entry.n)?entry.n:[entry.n]).some(v=>String(v)===String(n))))continue;
  const keys=lex(term(entry)).map(t=>t.key);if(keys.length)candidates.push({keys,entry,contextual});
 }
 for(const v of vocab){if(v.status==='mastered'||v.manual_known||Object.keys(v.review_articles||{}).length>=12)continue;const keys=lex(v.word).map(t=>t.key);if(keys.length)candidates.push({keys,entry:null,contextual:false});}
 candidates.sort((a,b)=>b.keys.length-a.keys.length||Number(b.contextual)-Number(a.contextual)||Number(!!b.entry)-Number(!!a.entry));
 const result=[];let offset=0;
 for(let i=0;i<tokens.length;){
  const t=tokens[i];if(t.start>offset)result.push({text:text.slice(offset,t.start),word:false});
  const found=candidates.find(c=>c.keys.every((key,j)=>tokens[i+j]?.key===key)),length=found?.keys.length||1,end=tokens[i+length-1].end;
  const raw=text.slice(t.start,end),w=found?.entry?term(found.entry):raw,key=normalize(w),existing=vocab.find(v=>normalize(v.word)===key);
  result.push({text:raw,word:true,w,key,entry:found?.entry||null,existing:existing||null,unknown:!!existing&&existing.status!=='mastered'&&!existing.manual_known&&Object.keys(existing.review_articles||{}).length<12});offset=end;i+=length;
 }
 if(offset<text.length)result.push({text:text.slice(offset),word:false});
 return result;
}

const api={lex,normalize,term,sentences,units,segments};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReadingLogic=api;
})(typeof window==='undefined'?globalThis:window);
