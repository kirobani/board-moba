'use strict';
const fs=require('node:fs');
const path=require('node:path');
const accessFile=path.join(__dirname,'.referee-access.json');

async function main(){
  const [tool,arg,folder]=process.argv.slice(2);
  if(!tool) throw Error('Usage: node referee.cjs TOOL [JSON or @file]');
  let access;
  for(let i=0;i<90;i++){
    try { access=JSON.parse(fs.readFileSync(accessFile,'utf8'));break; }
    catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!access)throw Error('Referee is registering this job. Please retry.');
  const address=new URL(access.address);
  if(address.origin!=='http://127.0.0.1:18796')throw Error('Invalid referee address');
  async function call(command,params){
    const destination=['run_trials','results','replay'].includes(command)
      ? new URL(address.pathname,'http://127.0.0.1:18799') : address;
    const response=await fetch(destination,{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),
      headers:{Authorization:'Bearer '+access.token,'Content-Type':'application/json'},body:JSON.stringify({tool:command,params})});
    const answer=await response.json();
    if(answer.error)throw Error(answer.error);
    if(!response.ok)throw Error('Referee HTTP '+response.status);
    return answer.result;
  }
  if(tool==='upload'){
    if(!arg||!folder)throw Error('Usage: node referee.cjs upload TEAM_NAME FOLDER');
    const root=path.resolve(folder), desk=path.resolve(__dirname);
    const real=fs.realpathSync(root);
    if(real!==desk&&!real.startsWith(desk+path.sep))throw Error('Squad folder must be inside the workspace');
    const files=Object.fromEntries(fs.readdirSync(real,{withFileTypes:true})
      .filter(e=>e.isFile()&&/^[a-z][a-z0-9_-]{0,63}\.cjs$/.test(e.name)&&e.name!=='engine.cjs')
      .map(({name})=>[name,fs.readFileSync(path.join(real,name),'utf8')]));
    const saved=await call('save_modules',{squad:arg,files});
    const rosterFile=path.join(real,'roster.json');
    if(fs.existsSync(rosterFile)){
      const {coreRole,playerIds}=JSON.parse(fs.readFileSync(rosterFile,'utf8').trimStart());
      saved.roster=await call('set_roster',{squad:arg,coreRole,playerIds});
    }
    console.log(JSON.stringify(saved,null,2));return;
  }
  const params=arg ? JSON.parse(arg.startsWith('@')?fs.readFileSync(arg.slice(1),'utf8').trimStart():arg) : {};
  console.log(JSON.stringify(await call(tool,params),null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
