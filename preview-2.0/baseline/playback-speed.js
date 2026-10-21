/* 本设备播放偏好；不修改教材音频、录音文件或学习同步数据。 */
(function(){
'use strict';
const rates=[.5,.75,1,1.25,1.5,2],key='workbench.playback-speed.v1';
let rate=1; // Review preference stays in memory.
const prepared=new WeakSet(),playing=new Set();
function apply(audio){
 audio.defaultPlaybackRate=rate;audio.playbackRate=rate;
 if('preservesPitch' in audio)audio.preservesPitch=true;
 if('webkitPreservesPitch' in audio)audio.webkitPreservesPitch=true;
 return audio;
}
function prepare(audio){
 if(!prepared.has(audio)){
  prepared.add(audio);
  audio.addEventListener('loadedmetadata',()=>apply(audio));
  audio.addEventListener('play',()=>{playing.add(audio);apply(audio);});
  for(const event of ['pause','ended','error'])audio.addEventListener(event,()=>playing.delete(audio));
 }
 return apply(audio);
}
function sync(){document.querySelectorAll('[data-playback-speed]').forEach(select=>{select.value=String(rate);});}
function set(value){
 const next=Number(value);if(!rates.includes(next))return false;
 rate=next;
 document.querySelectorAll('audio').forEach(prepare);playing.forEach(apply);sync();
 return true;
}
function control(){
 const label=document.createElement('label');label.className='playback-speed-control';
 label.append('播放速度 ');const select=document.createElement('select');select.dataset.playbackSpeed='';select.setAttribute('aria-label','播放速度');
 rates.forEach(value=>{const option=document.createElement('option');option.value=String(value);option.textContent=value+'×';select.append(option);});
 select.value=String(rate);label.append(select);return label;
}
function attach(node){
 if(node.nodeType!==1)return;
 const audios=[...(node.matches('audio')?[node]:[]),...node.querySelectorAll('audio')];
 audios.forEach(audio=>{
  prepare(audio);
  if(audio.controls&&!audio.nextElementSibling?.classList.contains('playback-speed-control'))audio.after(control());
 });
}
document.addEventListener('change',event=>{if(event.target.matches('[data-playback-speed]'))set(event.target.value);});
const sentenceActions=document.querySelector('.sentence-actions');if(sentenceActions)sentenceActions.append(control());
attach(document.documentElement);
new MutationObserver(changes=>changes.forEach(change=>change.addedNodes.forEach(attach))).observe(document.body,{childList:true,subtree:true});
window.PlaybackSpeed={get:()=>rate,set,prepare,control};
})();
