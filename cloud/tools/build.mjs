/* Explicit allowlist: no private runtime data, API credentials, tests or old outputs. */
import {readFile,writeFile,mkdir,copyFile,realpath,readdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
const here=dirname(fileURLToPath(import.meta.url)),cloud=resolve(here,'..'),root=resolve(cloud,'..');
const args=process.argv.slice(2),output=args[args.indexOf('--output')+1];
if(!args.includes('--output')||!output)throw Error('请提供 --output 交付目录/cloud-pages。');
const destination=resolve(output),hub=root;
const temporaryRoots=[resolve(tmpdir()),await realpath(tmpdir())];
const allowedOutput=value=>value.startsWith(resolve(root,'dist')+'/')||temporaryRoots.some(folder=>value.startsWith(folder+'/'));
if(!allowedOutput(destination))throw Error('部署产出必须进入项目成品目录或临时测试目录。');
await mkdir(destination,{recursive:true});
// Reject symlink destinations that could redirect writes into the running workbench.
const physical=await realpath(destination);if(!allowedOutput(physical))throw Error('部署目录不能通过软链接指向运行数据。');
function replaceOnce(content,before,after){
 if(content.includes(after)&&!content.includes(before))return content;
 if(content.split(before).length!==2)throw Error('云端前端适配位置已变化，停止构建以免旧界面漏入部署。');
 return content.replace(before,after);
}
let html=await readFile(resolve(root,'index.html'),'utf8');
const refs=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m=>m[1]);
const allowed=new Set([...refs,'index.html','login.html','login.js','cloud.css','cloud-ui.js','_worker.js','_routes.json','_headers','manifest.webmanifest','icon.svg','build-manifest.json']);
for(const file of await readdir(destination,{withFileTypes:true}))if(!file.isFile()||!allowed.has(file.name))throw Error('部署目录包含非白名单文件或链接，停止构建，未将其纳入部署包。');
for(const name of new Set(refs)){
 if(!/^[a-z0-9-]+\.(js|css)$/.test(name))throw Error('发现非预期前端引用');
 let content=await readFile(resolve(root,name),'utf8');
 if(name==='config.js')content="window.APP_CONFIG={build:'workbench-cloud-2.1-20261020.5',storeMode:'local',coachName:'教练',cloudVerification:window.CloudSession.validation};\n";
 if(name==='local-store.js')content=await readFile(resolve(cloud,'src/transport.js'),'utf8');
 if(name==='features21.js')content=content.replaceAll('Muse','教练');
 if(name==='device-sync.js'){
  content=content.replace("const prefix='english-workbench:mac-local:v1:'","const prefix='english-workbench:cloud:'+window.CloudSession.userId+':'");
  content=content.replace("indexedDB.open('english-workbench-device-sync-v1',1)","indexedDB.open('english-workbench-cloud:'+window.CloudSession.userId,1)");
  content=content.replaceAll('教材已从Mac读取','教材已从云端读取');
  content=content.replace("await request('/health',","await request('/api/cloud/check',");
 }
 if(name==='workbench.js'){
  // Keep complete questions and feedback; incomplete transport fixtures have no
  // exercise to render. The cloud-validation banner still identifies test data.
  content=replaceOnce(content,"note('真实教材已读取。已有学习记录可点击“下载学习数据”取回；当前作答先存本机。');","note('');");
 }
 await writeFile(resolve(destination,name),content);
}
html=html.replace('<script src="config.js">','<script src="cloud-session.js"></script><script src="config.js">')
 .replace('<script src="workbench.js">','<script src="cloud-ui.js"></script><script src="workbench.js">')
 .replace('</head>','<meta name="theme-color" content="#f6f5ed"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/cloud.css"></head>')
 .replace('正在读取本地教材…','正在加载…').replaceAll('Muse','教练')
 .replace('本样例不填充示例释义','按本句语境显示');
await writeFile(resolve(destination,'index.html'),html);
for(const name of ['login.html','login.js','cloud.css','cloud-ui.js'])await copyFile(resolve(cloud,'src',name),resolve(destination,name));
// workerd treats named entry-module exports as Worker entrypoints. Test-only
// constants/factories must remain local in the deployed single-file module.
const worker=(await readFile(resolve(cloud,'src/worker.mjs'),'utf8')).replace('export const BUILD=','const BUILD=').replace('export function createHandler(','function createHandler(');
await writeFile(resolve(destination,'_worker.js'),worker);
await writeFile(resolve(destination,'_routes.json'),JSON.stringify({version:1,include:['/','/index.html','/cloud-session.js','/api/*','/media/*','/health'],exclude:[]},null,2));
await writeFile(resolve(destination,'_headers'),"/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: microphone=(self)\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'\n");
await writeFile(resolve(destination,'manifest.webmanifest'),JSON.stringify({id:'/',name:'英语学习工作台',short_name:'英语学习',lang:'zh-CN',start_url:'/',scope:'/',display:'standalone',background_color:'#f6f5ed',theme_color:'#f6f5ed',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]},null,2));
await writeFile(resolve(destination,'icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="42" fill="#617751"/><path d="M47 53h42c14 0 20 7 20 15v75c-5-9-11-13-24-13H47zm98 0h-16c-14 0-20 7-20 15v75c5-9 11-13 24-13h12z" fill="#f6f5ed"/><path d="M109 68v75" stroke="#617751" stroke-width="5"/></svg>');
const manifest={build:'workbench-cloud-2.1-20261020.5',source:relative(hub,root),private_data_included:false,credentials_included:false,baseline:'固定2.1运行前端；新增故事与量化审核页未冒充正式接入',files:{}};
for(const name of await readdir(destination))if(name!=='build-manifest.json')manifest.files[name]=createHash('sha256').update(await readFile(resolve(destination,name))).digest('hex');
await writeFile(resolve(destination,'build-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({output:destination,files:Object.keys(manifest.files).length,private_data_included:false}));
