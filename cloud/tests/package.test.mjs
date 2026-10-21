import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
const execute=promisify(execFile),cloud=fileURLToPath(new URL('..',import.meta.url));
let folder,dest;
before(async()=>{folder=await mkdtemp(join(tmpdir(),'wb-cloud-package-'));dest=join(folder,'pages');await execute(process.execPath,[join(cloud,'tools/build.mjs'),'--output',dest]);});
after(async()=>{if(folder)await rm(folder,{recursive:true,force:true});});
test('PK01 部署目录为白名单文件，校验和匹配，不含私有库/凭证/录音/过程文件',async()=>{
 const files=await readdir(dest),manifest=JSON.parse(await readFile(join(dest,'build-manifest.json'),'utf8'));
 for(const filename of files){assert.ok(!/^\.|sqlite|\.py$|\.mp3$|\.wav$|token|credential|backup|\.env/.test(filename),filename);if(filename==='build-manifest.json')continue;const bytes=await readFile(join(dest,filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files[filename]);}
 assert.equal(manifest.private_data_included,false);assert.equal(manifest.credentials_included,false);
 for(const file of ['index.html','_worker.js','_routes.json','manifest.webmanifest','login.html','features21.js','workbench.js','device-sync.js'])assert.ok(files.includes(file));
});
test('PK02 原四导航/模块保留，账号隔离缓存与仅Cookie传输；正式运行源文件不被打包器改写',async()=>{
 const html=await readFile(join(dest,'index.html'),'utf8'),sync=await readFile(join(dest,'device-sync.js'),'utf8'),transport=await readFile(join(dest,'local-store.js'),'utf8');
 assert.equal((html.match(/class="site-nav"/g)||[]).length,1);assert.match(html,/cloud-session\.js/);assert.match(html,/features21\.js/);assert.match(html,/cloud-ui\.js/);
 assert.match(sync,/indexedDB\.open\('english-workbench-cloud:'\+window\.CloudSession\.userId/);assert.doesNotMatch(sync,/indexedDB\.open\('english-workbench-device-sync-v1'/);
 assert.match(sync,/request\('\/api\/cloud\/check'/);assert.doesNotMatch(transport,/savedKey|localStorage|#pair|service_role|service-role/);
 for(const file of ['reading.js','logic.js','playback-speed.js','word-pronunciation.js','features21.css','today-choice.css'])assert.deepEqual(await readFile(join(dest,file)),await readFile(resolve(cloud,'..',file)));
 assert.equal(await readFile(join(dest,'features21.js'),'utf8'),(await readFile(resolve(cloud,'..','features21.js'),'utf8')).replaceAll('Muse','教练'));
});
test('PK03 Worker只有默认入口，页面脚本符合CSP；静态资源不消耗动态请求额度',async()=>{
 const worker=await readFile(join(dest,'_worker.js'),'utf8'),routes=JSON.parse(await readFile(join(dest,'_routes.json'),'utf8')),html=await readFile(join(dest,'index.html'),'utf8');
 assert.doesNotMatch(worker,/export const|export function/);assert.match(worker,/export default/);assert.match(worker,/redirect:'manual'/);
 assert.ok(routes.include.includes('/cloud-session.js'));assert.ok(!routes.include.includes('/*'));
 assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>[\s\S]+?<\/script>/);
 assert.equal(JSON.parse(await readFile(join(dest,'manifest.webmanifest'),'utf8')).display,'standalone');
});
test('PK04 拒绝把部署输出写进正式程序或私有运行目录',async()=>{
 await assert.rejects(execute(process.execPath,[join(cloud,'tools/build.mjs'),'--output',resolve(cloud,'..')]),/部署产出必须/);
});
test('PK05 缺云端账号配置的验证脚本明确返回未验证，不生成虚假通过结论',async()=>{
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(cloud,'tools/verify-remote.mjs')]);let out='';child.stdout.on('data',x=>out+=x);child.on('error',reject);child.on('exit',code=>resolve({code,report:JSON.parse(out)}));child.stdin.end('{}');});
 assert.equal(result.code,1);assert.equal(result.report.cloud_transport_verified,false);assert.equal(result.report.production_data_migrated,false);
});
test('PK06 目标目录混入额外文件时停止构建，不能把未列明文件打包发布',async()=>{
 const mixed=join(folder,'mixed');await mkdir(mixed);await writeFile(join(mixed,'unexpected.json'),'{"fixture":"do not publish"}');
 await assert.rejects(execute(process.execPath,[join(cloud,'tools/build.mjs'),'--output',mixed]),/非白名单/);
 assert.deepEqual(await readdir(mixed),['unexpected.json']);
});
