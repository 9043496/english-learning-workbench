(function(){
 'use strict';
 document.getElementById('cloud-login-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button'),status=document.getElementById('login-status');button.disabled=true;status.textContent='正在登录…';
  try{
   const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value.trim(),password:form.elements.password.value})});
   const body=await response.json();if(!response.ok)throw Error(body.message||'登录失败。');
   form.elements.password.value='';location.replace('/#today');
  }catch(error){status.textContent=error.message;button.disabled=false;}
 });
})();
