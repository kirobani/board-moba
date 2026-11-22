'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {gzipSync} = require('node:zlib');

const {positionals,values} = parseArgs({options:{sparring:{type:'string'}},allowPositionals:true});
const [candidateDir,output] = positionals;
if (!candidateDir || positionals.length>2 || values.sparring==='') {
  throw Error('node submit.cjs TEAM_DIR [ENVELOPE_FILE] [--sparring OTHER_TEAM_DIR]');
}

const submission = {rosters:{}};
const teams = {candidate:candidateDir,...(values.sparring&&{sparring:values.sparring})};
for (const [entry,dir] of Object.entries(teams)) {
  const files = fs.readdirSync(dir,{withFileTypes:true})
    .filter(item=>item.isFile() && /^[a-z][a-z0-9_-]*\.cjs$/.test(item.name));
  submission[entry] = Object.fromEntries(files.map(({name})=>[name,fs.readFileSync(path.join(dir,name),'utf8')]));
  const rosterPath = path.join(dir,'roster.json');
  if (fs.existsSync(rosterPath)) {
    submission.rosters[entry] = JSON.parse(fs.readFileSync(rosterPath,'utf8').trimStart());
  }
}

const body = JSON.stringify(submission);
if (output) fs.writeFileSync(output,body+'\n',{flag:'wx'});
else console.log('MOBA_SUBMISSION '+gzipSync(body,{level:9}).toString('base64'));
