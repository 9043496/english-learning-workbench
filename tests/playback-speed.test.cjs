/* 非真机：验证播放器属性、控件与偏好持久化，不证明听感或Safari表现。 */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const code=fs.readFileSync(path.join(__dirname,'../playback-speed.js'),'utf8');
function setup(saved,blocked=false){
 const dom=new JSDOM('<body><audio controls></audio><div class="sentence-actions"></div></body>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window;
 if(saved!==undefined)w.localStorage.setItem('workbench.playback-speed.v1',saved);
 if(blocked){w.Storage.prototype.getItem=()=>{throw Error('blocked');};w.Storage.prototype.setItem=()=>{throw Error('quota');};}
 w.eval(code);return dom;
}
test('六档可选、默认1倍，正文与句卡控件同步',()=>{
 const dom=setup(),w=dom.window,d=w.document;
 try{assert.equal(w.PlaybackSpeed.get(),1);assert.equal(d.querySelectorAll('[data-playback-speed]').length,2);assert.deepEqual([...d.querySelector('select').options].map(o=>o.value),['0.5','0.75','1','1.25','1.5','2']);
 const select=d.querySelector('select');select.value='1.5';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(d.querySelector('audio').playbackRate,1.5);assert.ok([...d.querySelectorAll('select')].every(s=>s.value==='1.5'));assert.equal(w.localStorage.getItem('workbench.playback-speed.v1'),'1.5');}finally{w.close();}
});
test('刷新恢复偏好；异常旧值回退1倍',()=>{
 for(const [saved,expected] of [['0.75',.75],['garbage',1],['-1',1]]){const dom=setup(saved);try{assert.equal(dom.window.document.querySelector('audio').playbackRate,expected);}finally{dom.window.close();}}
});
test('存储拒绝或空间不足时仍能调速，不阻断播放',()=>{
 const dom=setup(undefined,true);try{assert.equal(dom.window.PlaybackSpeed.set(.5),true);assert.equal(dom.window.document.querySelector('audio').playbackRate,.5);}finally{dom.window.close();}
});
test('调速不中断进度，优先保音调，非法速度不应用',()=>{
 const dom=setup(),w=dom.window,a=w.document.querySelector('audio');try{a.currentTime=17;a.preservesPitch=false;a.webkitPreservesPitch=false;w.PlaybackSpeed.set(2);assert.equal(a.currentTime,17);assert.equal(a.preservesPitch,true);assert.equal(a.webkitPreservesPitch,true);assert.equal(w.PlaybackSpeed.set(0),false);assert.equal(a.playbackRate,2);}finally{w.close();}
});
test('后加载音频自动得到控件和当前速度，重复扫描不堆控件',async()=>{
 const dom=setup('.75'),w=dom.window,d=w.document;try{const holder=d.createElement('div');holder.innerHTML='<audio controls src="test.mp3"></audio>';d.body.append(holder);await new Promise(r=>setTimeout(r,0));const a=holder.querySelector('audio');assert.equal(a.playbackRate,.75);assert.equal(holder.querySelectorAll('select').length,1);d.body.append(holder);await new Promise(r=>setTimeout(r,0));assert.equal(holder.querySelectorAll('select').length,1);w.PlaybackSpeed.set(1.25);assert.equal(a.playbackRate,1.25);a.playbackRate=1;a.dispatchEvent(new w.Event('loadedmetadata'));assert.equal(a.playbackRate,1.25);}finally{w.close();}
});
test('浮层句音与口语提问的独立Audio可调速，播放中即时跟随',()=>{
 const dom=setup(),w=dom.window;try{const a=new w.Audio('sentence.mp3');w.PlaybackSpeed.set(.75);w.PlaybackSpeed.prepare(a);assert.equal(a.playbackRate,.75);a.dispatchEvent(new w.Event('play'));w.PlaybackSpeed.set(1.5);assert.equal(a.playbackRate,1.5);a.dispatchEvent(new w.Event('ended'));}finally{w.close();}
});
