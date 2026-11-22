'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createHash,randomBytes} = require('node:crypto');
const {createInterface} = require('node:readline');
const {isDeepStrictEqual} = require('node:util');
const {gunzipSync,gzipSync} = require('node:zlib');
const {formalPairs,readReceipt,readClock} = require('./contest-policy.cjs');

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const active=require('./active-benchmark.json');
const enginePath=path.join(__dirname,'judge-engine.cjs');
const configPath=path.resolve(__dirname,'./config.json');
const engineText=fs.readFileSync(enginePath,'utf8');
const config=require(configPath);
const G=require(enginePath);
if(digest(engineText)!==active.judgeEngineSha256||digest(fs.readFileSync(configPath))!==active.configSha256){
  throw Error('Pinned judge rules changed');
}
const {Bot}=require('./bot-vm.cjs');
const {RefereeBot}=require('./referee-bot.cjs');
const registered=active.tiers??{pressure:{id:active.primary,sourceSha256:active.sourceSha256}};
if(registered.pressure?.id!==active.primary||registered.pressure?.sourceSha256!==active.sourceSha256){
  throw Error('Pressure tier no longer matches the pinned primary benchmark');
}
const entries=Object.entries(registered);
if(new Set(entries.map(([,item])=>item.id)).size!==entries.length)throw Error('Duplicate baseline tiers');
const tiers=Object.fromEntries(entries.map(([tier,item])=>[item.id,tier]));
const references=Object.freeze(Object.fromEntries(entries.map(([,item])=>{
  if(!/^[a-z][a-z0-9-]*$/.test(item.id)) throw Error('Invalid registered baseline');
  const source=fs.readFileSync(path.join(__dirname,'agents',item.id+'.cjs'),'utf8');
  if(digest(source)!==item.sourceSha256)throw Error('Pinned benchmark source changed');
  return [item.id,source];
})));

const sides = ['A','B'];
const playingRoles = ['top','mid','jungle','adc','support'];
const roles = [...playingRoles,'coach'];
function squad(files) {
  if (!files || Array.isArray(files) || typeof files !== 'object') throw Error('Missing source files');
  for (const role of roles) if (typeof files[role+'.cjs'] !== 'string') throw Error('Missing '+role+'.cjs');
  let bytes = 0;
  for (const [name,source] of Object.entries(files)) {
    if (!/^[a-z][a-z0-9_-]{0,63}\.cjs$/.test(name) || typeof source !== 'string') throw Error('Invalid CJS entry');
    bytes += Buffer.byteLength(source);
  }
  if (bytes > 1024*1024 || Object.keys(files).length>64) throw Error('Submission exceeds source size');
  return files;
}

function rosterFor(rosters, entry) {
  if (!Object.hasOwn(rosters,entry)) return {coreRole:null};
  const roster = rosters[entry];
  if (!roster || Array.isArray(roster) || typeof roster!=='object' ||
      Object.keys(roster).some(key=>key!=='coreRole' && key!=='playerIds') || !Object.hasOwn(roster,'coreRole') ||
      (roster.coreRole!==null && !playingRoles.includes(roster.coreRole))) {
    throw Error('Invalid '+entry+' roster. Choose top, mid, jungle, adc or support as coreRole');
  }
  if (!Object.hasOwn(roster,'playerIds')) return {coreRole:roster.coreRole};
  const ids = roster.playerIds;
  if (!ids || typeof ids!=='object' || Array.isArray(ids) || Object.entries(ids).some(([role,id])=>
    !playingRoles.includes(role) || typeof id!=='string' || id.length<1 || id.length>10 || /[^A-Za-z0-9]/.test(id))) {
    throw Error('Invalid '+entry+' playerIds. Use 1–10 ASCII letters or digits per player');
  }
  const playerIds = Object.fromEntries(playingRoles.filter(role=>Object.hasOwn(ids,role)).map(role=>[role,ids[role]]));
  return {coreRole:roster.coreRole,playerIds};
}

function createReceipt(file, fields) {
  // Publish the complete receipt atomically without replacing a competing submission.
  const temp = file+'.'+randomBytes(8).toString('hex')+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(fields,null,2)+'\n',{flag:'wx'});
  try {
    try {fs.linkSync(temp,file);return true;}
    catch(error) {
      if (error.code!=='EEXIST') throw error;
      return false;
    }
  } finally {
    fs.unlinkSync(temp);
  }
}

function checkPublicClock(file,startedAt) {
  if (!file) return;
  const published = readReceipt(file);
  if (published && published.startedAt!==startedAt) throw Error('Public clock file already belongs to a different start');
}

function publishClock(sealPath,file) {
  const clock = readClock(sealPath);
  checkPublicClock(file,clock.startedAt);
  if (file && !isDeepStrictEqual(readReceipt(file),clock) && !createReceipt(file,clock)) {
    checkPublicClock(file,clock.startedAt);
    const temp = file+'.'+randomBytes(8).toString('hex')+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(clock,null,2)+'\n',{flag:'wx'});
    try {fs.renameSync(temp,file);}
    finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  console.log(JSON.stringify(clock));
}

function settleEntry(sealPath, formal, roster, candidate, receivedAt, clockCheck) {
  if (!sealPath) return;
  const finalPath = sealPath+'.final';
  const existing = readReceipt(finalPath);
  const clock = readClock(sealPath);
  const {coreRole,playerIds} = roster;
  const fields = {candidate,coreRole,...(playerIds&&{playerIds})};
  function confirm(stored) {
    // Earlier receipts also pinned a practice squad. Only the submitted team is scored now.
    const {receivedAt,clockCheckedAt,first,firstCoreRole,...previous} = stored;
    if (!isDeepStrictEqual(previous,fields)) throw Error('Formal roster or programs differ from the sealed submission');
    return receivedAt;
  }
  if (existing!==undefined) return confirm(existing);

  if (formal) {
    if (!coreRole || !playerIds || playingRoles.some(role=>!Object.hasOwn(playerIds,role))) {
      throw Error('Formal submission requires a core role and IDs for all five players');
    }
    if (!clock || receivedAt<clock.startedAt) throw Error('Register the contest start with the referee first');
    if (receivedAt>=clock.closesAt) throw Error('The 210-minute submission deadline has passed');
    if (clockCheck && (!Number.isSafeInteger(clockCheck.checkedAt) || clockCheck.checkedAt<clock.startedAt ||
      clockCheck.checkedAt>receivedAt || clockCheck.developmentEndsAt!==clock.developmentEndsAt || clockCheck.closesAt!==clock.closesAt)) {
      throw Error('The submission requires a fresh referee clock check');
    }
  } else if (clock && receivedAt>=clock.developmentEndsAt) {
    throw Error('The 180-minute development window has ended');
  }
  if (!formal) return;
  if (createReceipt(finalPath,{...fields,receivedAt,...(clockCheck&&{clockCheckedAt:clockCheck.checkedAt})})) return receivedAt;
  return confirm(readReceipt(finalPath));
}

function childPilot(files, coreRole) {
  // The referee never evaluates submitted code in its own process.
  const script = path.resolve(__dirname,'./competitor.mjs');
  const child = spawn(process.execPath,['--permission','--allow-fs-read='+script,
    '--max-old-space-size=128',script],{cwd:__dirname,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{}});
  const lines = createInterface({input:child.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
  child.stdin.on('error',()=>{});
  let launchError;
  child.on('error',error=>{launchError=error;});
  async function request(message,timeout) {
    if (launchError || child.exitCode != null) throw Error('Program process closed');
    child.stdin.write(JSON.stringify(message)+'\n');
    let timer;
    try {
      const out = await Promise.race([
        lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Program response timed out')),timeout);})
      ]);
      if (out.done) throw Error('Program process closed');
      const value = JSON.parse(out.value);
      if (value.fault) throw Error(value.fault+' '+value.message);
      return value;
    } finally {clearTimeout(timer);}
  }
  return {
    ready:()=>request({type:'initialize',files,engine:engineText,coreRole},10_000),
    decide:observation=>request({type:'decide',observation},2700),
    close:()=>{child.stdin.end();child.kill();}
  };
}
function participant(name,files,rosters) {
  if (name in files) return childPilot(files[name],rosters[name].coreRole);
  const Pilot = tiers[name]==='standard' ? RefereeBot : Bot;
  const bot = new Pilot(references[name],engineText);
  return {decide:observation=>bot.decide(observation),close(){}};
}
function replayFrame({ _seed,_mirrorRandomness,_ancientPlans,...state}) {return state;}
async function game(job, files, rosters, outputDir, onFrame) {
  const pilots = {}, faults = {};
  let state = G.makeState(job.seed,config);
  const frames = job.replay ? [replayFrame(state)] : null;
  if (onFrame) onFrame(frames?.[0] ?? replayFrame(state));
  try {
    for (const side of sides) {
      try {
        pilots[side] = participant(job[side],files,rosters);
        await pilots[side].ready?.();
      } catch(error) {faults[side]=error.message;}
    }
    while (!state.result && state.turn < 1000 && !Object.keys(faults).length) {
      const active = state.phase==='map' ? sides : state.phase==='final_battle' ? [state.battle.actor[0]] : [];
      const commands = {};
      await Promise.all(active.map(async side=>{
        try {commands[side] = await pilots[side].decide(G.observe(state,side));}
        catch(error) {faults[side] = error.message;}
      }));
      if (Object.keys(faults).length) break;
      state = G.step(state,commands);
      if (frames || onFrame) {
        const frame = replayFrame(state);
        frames?.push(frame);
        onFrame?.(frame);
      }
    }
    const id = job.opponent+'-'+job.pair+'-'+(job.A==='candidate'?'blue':'red');
    const result = {id, opponent:job.opponent,tier:tiers[job.opponent]??'self',candidateSide:job.A==='candidate'?'A':'B',
      mapTurns:state.mapTurn, winner:state.result?.winner??null,
      reason:state.result?.reason??(Object.keys(faults).length?'technical':'unfinished'),
      faults};
    result.outcome = result.reason==='technical'||result.reason==='unfinished' ? result.reason
      : result.winner===null ? 'draw' : result.winner===result.candidateSide ? 'win' : 'loss';
    if(frames){
      result.replay = id+'.json.gz';
      const labels = {A:job.A,B:job.B};
      const coreRoles = {A:rosters[job.A]?.coreRole??null,B:rosters[job.B]?.coreRole??null};
      fs.writeFileSync(path.join(outputDir,result.replay),gzipSync(JSON.stringify({
        id,format:'full-frames-v1',labels,coreRoles,frames,result:state.result
      })));
    }
    return result;
  } finally {
    for (const pilot of Object.values(pilots)) pilot.close();
  }
}
async function main() {
  const receivedAt = Date.now();
  const [submission,outputDir,countText,sealPath,mode,replayText] = process.argv.slice(2);
  if (submission==='--start-clock' && outputDir && sealPath===undefined) {
    if (!readClock(outputDir)) createReceipt(outputDir+'.clock',{startedAt:receivedAt});
    publishClock(outputDir,countText);
    return;
  }
  if (submission==='--credit-interruption' && outputDir && countText && sealPath && mode && replayText===undefined) {
    const clock = readClock(outputDir);
    if (![sealPath,mode].every(value=>/(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
      throw Error('Interruption timestamps must include a timezone');
    }
    const [from,to] = [sealPath,mode].map(value=>Date.parse(value));
    if (!clock || !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
      from<clock.startedAt||from>=clock.closesAt||to<=from||to>receivedAt) throw Error('Invalid interruption interval');
    if (readReceipt(outputDir+'.final')) throw Error('The submitted team is sealed');
    checkPublicClock(countText,clock.startedAt);
    const directory = outputDir+'.interruptions';
    fs.mkdirSync(directory,{recursive:true});
    createReceipt(path.join(directory,from+'-'+to+'.json'),{from,to});
    publishClock(outputDir,countText);
    return;
  }
  if (!submission || !outputDir) {
    throw Error('node challenge.cjs SUBMISSION NEW_RESULTS_DIR [PAIR_COUNT] [SEAL_PATH] [MODE] [REPLAY_PAIRS]');
  }
  const raw = fs.readFileSync(submission);
  if(raw.length>3_000_000)throw Error('Submission envelope too large');
  const data = /^[{]/.test(raw.toString('utf8').trimStart()) ? JSON.parse(raw) :
    JSON.parse(gunzipSync(Buffer.from(raw.toString().trim().replace(/^MOBA_SUBMISSION /,''),'base64'),{maxOutputLength:3_000_000}));
  const knownModes=['active','both','self','standard','pressure','final'];
  const selectedMode=mode||'active';
  if(!knownModes.includes(selectedMode))throw Error('Unknown challenge mode');
  const files = {candidate:squad(data.candidate)};
  const submittedRosters = Object.hasOwn(data,'rosters') ? data.rosters : {};
  if (!submittedRosters || Array.isArray(submittedRosters) || typeof submittedRosters!=='object' ||
      Object.keys(submittedRosters).some(entry=>!['candidate','sparring','first'].includes(entry))) {
    throw Error('Invalid rosters. Use candidate and an optional sparring roster');
  }
  const roster = rosterFor(submittedRosters,'candidate');
  const rosters = {candidate:roster};
  if (selectedMode==='self') {
    const field = Object.hasOwn(data,'sparring') ? 'sparring' : 'first';
    if (!data[field]) throw Error('Self-play needs a sparring team');
    files.sparring=squad(data[field]);
    rosters.sparring=rosterFor(submittedRosters,field);
  }
  const sources = Object.entries(files.candidate).sort();
  const candidate = digest(JSON.stringify(roster.coreRole===null && !roster.playerIds ? sources : [sources,roster]));
  const formal = selectedMode==='final';
  const pairCount = Number(countText??(formal?formalPairs:3));
  if (!Number.isInteger(pairCount)||pairCount<1||pairCount>64) throw Error('Invalid pair count');
  if (formal && pairCount!==formalPairs) throw Error('Formal evaluation requires 20 games per baseline');
  const replayPairs = Number(replayText??0);
  if(!Number.isInteger(replayPairs)||replayPairs<0||replayPairs>pairCount)throw Error('Invalid replay pair count');
  const refs=Object.keys(references);
  const opponents = selectedMode==='self'?['sparring']:
   (selectedMode==='standard'||selectedMode==='pressure')?refs.filter(id=>tiers[id]===selectedMode):refs;
  if(!opponents.length)throw Error('Requested tier has no registered benchmark');
  if (formal && !sealPath) throw Error('Formal submission requires a referee seal path');
  if (formal && (!registered.standard || !registered.pressure)) {
    throw Error('Formal evaluation requires both registered baselines');
  }
  const formalReceivedAt = settleEntry(sealPath,formal,roster,candidate,receivedAt,data.clockCheck);
  fs.mkdirSync(outputDir);
  const seeds=Array.from({length:pairCount},()=>randomBytes(16).toString('hex'));
  const jobs = opponents.flatMap(opponent=>seeds.flatMap((seed,pair)=>
    [{opponent,pair,seed,replay:pair<replayPairs,A:'candidate',B:opponent},
     {opponent,pair,seed,replay:pair<replayPairs,A:opponent,B:'candidate'}]));
  let i = 0, count = 0;
  const results = new Array(jobs.length);
  fs.writeFileSync(path.join(outputDir,'judge-seeds.json'),JSON.stringify(jobs,null,2)+'\n');
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
    while(i<jobs.length) {
      const index = i++, job = jobs[index];
      results[index] = await game(job,files,rosters,outputDir);
      console.log(JSON.stringify({completed:++count,total:jobs.length,...results[index]}));
    }
  }));
  const standings = Object.fromEntries(opponents.map(opponent=>[opponent,
    Object.fromEntries(sides.map(side=>[side,Object.fromEntries(['win','loss','draw','technical','unfinished'].map(outcome=>[
      outcome,results.filter(match=>match.opponent===opponent&&match.candidateSide===side&&match.outcome===outcome).length
    ]))]))]));
  fs.writeFileSync(path.join(outputDir,'summary.json'),JSON.stringify({submission:{candidate},rosters,formal,
    ...(formalReceivedAt!==undefined && {formalReceivedAt}),tiers,standings,matches:results},null,2)+'\n');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = {game, rosterFor, squad, childPilot, engine: G, config, engineSha256: digest(engineText)};
