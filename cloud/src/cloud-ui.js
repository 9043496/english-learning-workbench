(function(){
 'use strict';
 const bar=document.createElement('div');bar.className='cloud-validation';
 bar.innerHTML='<span></span><div class="cloud-account-actions"><button type="button" id="cloud-settings">账号设置</button><button type="button" id="cloud-logout">退出账号</button></div>';
 bar.querySelector('span').textContent=window.CloudSession.validation?'云端隔离验证版 · 工程账号，非正式学习资料':'云端学习空间 · 学完后上传，换设备后下载';document.body.prepend(bar);
 const settings=document.createElement('dialog');settings.id='cloud-account-settings';settings.className='cloud-account-dialog';settings.setAttribute('aria-labelledby','cloud-account-title');
 settings.innerHTML='<form id="cloud-password-form"><h2 id="cloud-account-title">修改密码</h2><label>当前密码<input name="current_password" type="password" autocomplete="current-password" required maxlength="1024"></label><label>新密码<input name="new_password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"><small>8–128位</small></label><label>确认新密码<input name="confirm_password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p id="cloud-password-status" role="status" aria-live="polite"></p><div class="cloud-account-actions"><button type="button" id="cloud-settings-close">关闭</button><button type="submit">更新密码</button></div></form>';
 document.body.append(settings);const form=settings.querySelector('form'),passwordStatus=settings.querySelector('[role=status]');let changing=false;
 const recording=()=>document.getElementById('stop-record')?.disabled===false||document.getElementById('real-stop-answer')?.disabled===false;
 function closeSettings(){if(changing)return;form.reset();if(typeof settings.close==='function')settings.close();else settings.removeAttribute('open');document.getElementById('cloud-settings')?.focus();}
 document.getElementById('cloud-settings').addEventListener('click',()=>{
  if(recording()){document.getElementById('app-status').textContent='请先结束当前录音，再修改密码。';return;}
  form.reset();passwordStatus.textContent='';if(typeof settings.showModal==='function')settings.showModal();else settings.setAttribute('open','');form.elements.current_password.focus();
 });
 document.getElementById('cloud-settings-close').addEventListener('click',closeSettings);settings.addEventListener('cancel',event=>{event.preventDefault();closeSettings();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(changing)return;
  const current=form.elements.current_password.value,password=form.elements.new_password.value,confirm=form.elements.confirm_password.value;
  if(!current||password.length<8||password.length>128||password!==confirm){passwordStatus.textContent='新密码须为8–128位，且两次输入一致。';return;}
  if(recording()){passwordStatus.textContent='请先结束当前录音。';return;}
  changing=true;for(const button of form.querySelectorAll('button'))button.disabled=true;passwordStatus.textContent='正在更新…';
  try{const response=await window.LocalWorkbench.request('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:current,new_password:password,confirm_password:confirm})});const result=await response.json();form.reset();passwordStatus.textContent=result.message||'密码已更新，下次登录请使用新密码。';}
  catch(error){passwordStatus.textContent=error.message;form.elements.current_password.value='';}
  finally{changing=false;for(const button of form.querySelectorAll('button'))button.disabled=false;}
 });
 document.getElementById('cloud-logout').addEventListener('click',async()=>{
  const status=window.Data.status();
  if(changing||status.pending||status.busy||recording()){document.getElementById('app-status').textContent='请先结束录音并上传待同步数据，再退出账号。';return;}
  try{await window.LocalWorkbench.request('/api/auth/logout',{method:'POST'});location.replace('/login.html');}catch(error){document.getElementById('app-status').textContent=error.message;}
 });
 window.addEventListener('cloud-login-expired',()=>{form.reset();if(typeof settings.close==='function')settings.close();else settings.removeAttribute('open');document.getElementById('app-status').textContent='登录已过期。作答和录音仍在此账号的本机缓存，请重新登录同一账号后上传。';const link=document.createElement('a');link.href='/login.html';link.textContent='重新登录';bar.replaceChildren(link);});
})();
