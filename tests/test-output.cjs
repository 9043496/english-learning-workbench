/* 持久测试产出统一进入README规定的成品/日期，不散落在源码目录。 */
const fs=require('node:fs'),path=require('node:path');
module.exports=function(name){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 const folder=process.env.WORKBENCH_TEST_OUTPUT_DIR||path.resolve(__dirname,'../var/test-reports',date);
 fs.mkdirSync(folder,{recursive:true});return path.join(folder,name);
};
