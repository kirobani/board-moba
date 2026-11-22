'use strict';
const fs = require('node:fs');
function line(){let out=[],b=Buffer.alloc(1);while(fs.readSync(0,b,0,1,null)){if(b[0]===10)return Buffer.from(out).toString('utf8');out.push(b[0]);}throw Error('Controller input closed');}
function sleep(ms){if(ms>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}
function put(p,d){if(!p)return;const t=p+'.tmp';fs.writeFileSync(t,JSON.stringify(d));for(let n=0;;n++){try{fs.renameSync(t,p);return;}catch(e){if(n>=199||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;sleep(5);}}}
let stepSeen=0;
function gate(job){if(!job.controlPath)return;for(;;){let c=JSON.parse(fs.readFileSync(job.controlPath,'utf8'));if(c.stop)throw Error('Stopped by user');if(!c.paused){sleep(Math.max(0,Math.min(2000,c.delayMs||0)));return;}if((c.step||0)>stepSeen){stepSeen=c.step;return;}sleep(40);}}
function frame(job,s){if(job.livePath)fs.appendFileSync(job.livePath,JSON.stringify(s)+'\n');put(job.requestPath,{waiting:false,turn:s.turn,done:!!s.result});}
module.exports = {line, put, gate, frame};
