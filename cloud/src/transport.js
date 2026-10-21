/* Cookie-only transport. Native Store signatures and DeviceSyncData remain intact. */
(function(){
 'use strict';
 if(!window.CloudSession?.userId){location.replace('/login.html');throw Error('请先登录学习工作台。');}
 const fail=(code,message)=>Object.assign(new Error(message),{code});
 async function request(path,init={}){
  let response;
  try{response=await fetch(path,{...init,credentials:'same-origin'});}catch{throw fail('NETWORK','无法连接云端，已保留本机作答与录音。');}
  if(!response.ok){let body;try{body=await response.json();}catch{}if(response.status===401)window.dispatchEvent(new CustomEvent('cloud-login-expired'));throw fail(body?.code||'NETWORK',body?.message||'云端请求失败，数据仍保留本机。');}
  return response;
 }
 const records=(c,id)=>'/api/records/'+encodeURIComponent(c)+(id===undefined?'':'/'+encodeURIComponent(id));
 window.Store={
  async list(c){return (await request(records(c))).json();},
  async get(c,id){return (await request(records(c,id))).json();},
  async save(){throw fail('INVALID','学习数据通过显式同步提交，教材只读。');},
  async remove(){throw fail('INVALID','学习历史与教材保留，此处不提供删除入口。');},
  async saveBlob(){throw fail('INVALID','录音先存设备，再通过学习同步上传。');},
  async getBlob(key){try{return await (await request('/api/blobs/'+encodeURIComponent(key))).blob();}catch(e){if(e.code==='NOT_FOUND')return null;throw e;}},
  async listBlobs(prefix){return (await request('/api/blobs?prefix='+encodeURIComponent(prefix||''))).json();}
 };
 window.LocalWorkbench={connected:false,request,
  async importContent(){throw fail('INVALID','教材由独立教练账号通过受控接口注入。');},
  async exportBackup(){throw fail('INVALID','请在Mac保留原始资料；当前页面暂不提供全量云端备份下载。');}
 };
})();
