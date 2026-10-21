/* 仅设备本地英语语音；不使用在线词典、语音接口或学习数据存储。 */
(function(){
'use strict';
const button=document.querySelector('#demo-word-pronounce'),label=document.querySelector('#word-pronunciation-status');
const synth=window.speechSynthesis,supported=!!(synth&&window.SpeechSynthesisUtterance);
let serial=0,current=null,pending=null,voiceTimer=null;
function message(text,busy=false){label.textContent=text;button.setAttribute('aria-busy',String(busy));button.classList.toggle('is-speaking',busy);}
function stop(){serial++;pending=null;clearTimeout(voiceTimer);if(current){current.onend=null;current.onerror=null;current=null;try{synth.cancel();}catch{}}message(supported?'设备本地英语发音':'当前浏览器不支持单词发音');}
function play(text){
 stop();const word=String(text||'').trim();if(!word)return;
 button.setAttribute('aria-label','播放 '+word+' 的发音');
 if(!supported){button.disabled=true;return;}
 button.disabled=false;const request=serial;
 function attempt(){
  if(request!==serial)return true;
  let voices;try{voices=synth.getVoices();}catch{message('无法读取本机语音，请点击发音按钮重试。');return true;}
  const english=voices.filter(v=>v.localService===true&&/^en(?:[-_]|$)/i.test(v.lang));
  const voice=english.find(v=>/^en[-_]US$/i.test(v.lang))||english.find(v=>v.default)||english[0];
  if(!voice)return false;
  pending=null;clearTimeout(voiceTimer);
  const utterance=new window.SpeechSynthesisUtterance(word);current=utterance;utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=window.PlaybackSpeed?.get()||1;
  utterance.onstart=()=>{if(request===serial)message('正在发音…',true);};
  utterance.onend=()=>{if(request===serial){current=null;message('设备本地英语发音 · 可点击重听');}};
  utterance.onerror=()=>{if(request===serial){current=null;message('未能播放，请点击发音按钮重试。');}};
  try{synth.resume?.();message('正在发音…',true);synth.speak(utterance);}catch{current=null;message('未能播放，请点击发音按钮重试。');}
  return true;
 }
 if(!attempt()){message('正在准备本机英语语音…');pending=attempt;voiceTimer=setTimeout(()=>{if(request===serial){pending=null;message('本机尚无可用的英语本地语音，请稍后重试。');}},1500);}
}
button.disabled=!supported;button.addEventListener('click',()=>play(document.querySelector('#card-title').textContent));
synth?.addEventListener?.('voiceschanged',()=>{pending?.();});
window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
window.DemoWordVoice={play,stop,supported};message(supported?'设备本地英语发音':'当前浏览器不支持单词发音');
})();
