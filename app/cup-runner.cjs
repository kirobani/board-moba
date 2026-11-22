'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const {gunzipSync} = require('node:zlib');
const {game, config, engineSha256} = require('../referee/challenge.cjs');
const {demoEntries} = require('../examples/squads.cjs');
const {setup, seedsFromRatings, advance} = require('./swiss-s16.cjs');

const hash = raw => createHash('sha256').update(raw).digest('hex');
const configSha256 = hash(JSON.stringify(config));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const encode = data => JSON.stringify(data) + '\n';
const now = () => new Date().toISOString();
const modes = ['test','sealed','realtime'];
const safeId = /^[a-z0-9][a-z0-9-]{0,55}$/;
const stateFile = dir => path.join(dir, 'state.json');
const wait = new Int32Array(new SharedArrayBuffer(4));

function save(file, data) {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp, encode(data), {flag:'wx'});
  try {
    for (let i=0;; i++) {
      try { fs.renameSync(temp, file); return; }
      catch (error) {
        if (i===14 || !['EPERM','EACCES','EBUSY'].includes(error.code)) throw error;
        Atomics.wait(wait, 0, 0, 15);
      }
    }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

async function locked(file, action) {
  fs.writeFileSync(file, encode({pid:process.pid, startedAt:now()}), {flag:'wx'});
  try { return await action(); }
  finally { fs.unlinkSync(file); }
}

function initial(teams, {id,name,mode,createdAt,drawSeed}, plan = true) {
  return setup(teams, drawSeed, {id,name,mode,createdAt,format:'cup-swiss',configSha256,
    seedCommitment:hash(drawSeed), status:'ready'}, plan);
}

function create(dir, teams, mode, name, manualDraw = false) {
  const id = path.basename(dir);
  assert(safeId.test(id) && modes.includes(mode) && typeof name==='string' && name.trim() && name.length<=60);
  fs.mkdirSync(dir);
  const state = initial(teams, {id,name:name.trim(),mode,createdAt:now(),drawSeed:randomBytes(32).toString('hex')}, !manualDraw);
  if (manualDraw) state.manualDraw = true;
  save(stateFile(dir), state);
  return state;
}

function prepareReset(dir, source, teams) {
  const previous = read(stateFile(source));
  assert.equal(path.basename(dir), previous.id);
  assert(!fs.existsSync(path.join(source,'runner.lock')), '该杯赛正在演算');
  verifyCup(source, previous, teams);
  const state = initial(previous.teams, previous, false);
  assert.equal(state.seedCommitment, previous.seedCommitment);
  state.manualDraw = true;
  fs.mkdirSync(dir);
  save(stateFile(dir), state);
  return state.id;
}

async function planDraw(dir, waveId) {
  return locked(path.join(dir,'runner.lock'), () => {
    const state = read(stateFile(dir));
    const wave = state.waves.at(-1);
    assert(state.manualDraw && state.status==='ready' && wave.id===waveId, '本轮不能抽签');
    if (!wave.pendingDraw) return wave.id;

    const planned = initial(state.teams, state);
    for (const [index, settled] of state.waves.slice(0,-1).entries()) {
      const check = planned.waves[index];
      assert.equal(check.id, settled.id);
      assert.equal(check.fixtures.length, settled.fixtures.length);
      for (const [i,fixture] of settled.fixtures.entries()) {
        assert.deepEqual(check.fixtures[i].teams, fixture.teams);
        check.fixtures[i].winner = fixture.winner;
      }
      advance(planned);
    }
    assert.equal(planned.waves.at(-1).id, wave.id);
    wave.fixtures = planned.waves.at(-1).fixtures;
    delete wave.pendingDraw;
    save(stateFile(dir), state);
    return wave.id;
  });
}

function gameIntent(state, wave, fixture, index) {
  const [a,b] = fixture.teams;
  const flip = (parseInt(hash(`${state.drawSeed}|side|${fixture.id}`).slice(0,2),16)+index)%2;
  const id = `${fixture.id}-m${index+1}`;
  const [A,B] = flip ? [b,a] : [a,b];
  return {id,cup:state.id,wave:wave.id,fixture:fixture.id,index,A,B,
    seed:hash(`${state.drawSeed}|game|${id}`).slice(0,32), engineSha256, configSha256,
    sourceA:state.teams[A].digest,sourceB:state.teams[B].digest};
}

async function playSeries(dir, state, wave, fixture, entries, publish) {
  const wins = Object.fromEntries(fixture.teams.map(id=>[id,0]));
  const required = (fixture.bestOf+1)/2;
  const replayDir = path.join(dir,'replays',fixture.id);
  const receipts = path.join(dir,'receipts');
  fs.mkdirSync(replayDir,{recursive:true});
  fixture.status = 'running';
  publish();
  while (fixture.games.length < fixture.bestOf + 4) {
    const intent = gameIntent(state,wave,fixture,fixture.games.length);
    fs.writeFileSync(path.join(receipts,intent.id+'.intent.json'), encode(intent), {flag:'wx'});
    const {A,B,index,seed,id} = intent;
    const blue = entries.get(A), red = entries.get(B);
    let heat = 0;
    const live = state.mode==='realtime' ? path.join(replayDir,id+'.frames.jsonl') : null;
    const stream = live ? fs.openSync(live,'wx') : null;
    let result;
    try {
      result = await game({A:'candidate',B:'sparring',pair:index,seed,opponent:'sparring',replay:true},
        {candidate:blue.files,sparring:red.files},{candidate:blue.info.roster,sparring:red.info.roster},replayDir, frame=>{
          if (stream!==null) fs.writeFileSync(stream,encode(frame));
          const events = frame.events ?? [];
          heat = Math.max(heat,events.filter(e=>e.kind==='kill'||e.kind==='final_kill').length*2+
            events.filter(e=>e.kind==='tower'||e.kind==='ancient').length);
        });
    } finally { if (stream!==null) fs.closeSync(stream); }
    const winner = result.winner==='A' ? A : result.winner==='B' ? B : null;
    const replaySha256 = hash(fs.readFileSync(path.join(replayDir,result.replay)));
    const row = {...intent,winner,outcome:result.outcome,reason:result.reason,turns:result.mapTurns,
      faults:result.faults,replay:result.replay,replaySha256,heat};
    fs.writeFileSync(path.join(receipts,id+'.result.json'), encode(row), {flag:'wx'});
    fixture.games.push(row);
    if (['technical','unfinished'].includes(row.outcome)) break;
    if (winner && ++wins[winner]===required) { fixture.winner=winner; break; }
    publish();
  }
  fixture.status = fixture.winner ? 'complete' : 'technical_hold';
  publish();
}

function verifyCup(dir, state, teams) {
  assert(['complete','complete-verified'].includes(state.status));
  assert.deepEqual(state.teams,teams);
  assert.equal(state.seedCommitment,hash(state.drawSeed));
  assert.equal(state.engineSha256,engineSha256);
  assert.equal(state.configSha256,configSha256);
  const simulated = initial(teams,state);
  const expectedReceipts = [];
  const seeds = new Set();
  for (const [round,wave] of state.waves.entries()) {
    const now = simulated.waves[round];
    assert.equal(wave.id,now.id);
    assert.equal(wave.fixtures.length,now.fixtures.length);
    for (const [i,f] of wave.fixtures.entries()) {
      const plan = now.fixtures[i];
      assert.deepEqual([f.id,f.teams,f.bestOf,f.record],[plan.id,plan.teams,plan.bestOf,plan.record]);
      assert.equal(f.status,'complete');
      const wins = Object.fromEntries(f.teams.map(id=>[id,0]));
      let winner = null;
      for (const [j,row] of f.games.entries()) {
        assert.equal(winner,null,'game after series ended');
        const intent = gameIntent(state,wave,f,j);
        const base = path.join(dir,'receipts',intent.id);
        expectedReceipts.push(intent.id+'.intent.json',intent.id+'.result.json');
        assert(!seeds.has(intent.seed),'duplicate game seed');
        seeds.add(intent.seed);
        assert.deepEqual(read(base+'.intent.json'),intent);
        assert.deepEqual(read(base+'.result.json'),row);
        for (const [key,val] of Object.entries(intent)) assert.equal(row[key],val);
        assert(['win','loss','draw'].includes(row.outcome));
        assert.equal(row.replay,`sparring-${j}-blue.json.gz`);
        const raw = fs.readFileSync(path.join(dir,'replays',f.id,row.replay));
        assert.equal(hash(raw),row.replaySha256);
        const replay = JSON.parse(gunzipSync(raw));
        assert.equal(replay.format,'full-frames-v1');
        assert(replay.frames.length>1 && replay.result);
        assert.deepEqual(replay.frames.at(-1).result,replay.result);
        assert.equal(replay.frames.at(-1).mapTurn,row.turns);
        assert.equal(replay.result.reason,row.reason);
        const side = replay.result.winner;
        assert.equal(row.winner,side ? row[side] : null);
        assert.equal(row.outcome,side==='A'?'win':side==='B'?'loss':'draw');
        if (row.winner && ++wins[row.winner]===(f.bestOf+1)/2) winner=row.winner;
      }
      assert(winner);
      assert.equal(winner,f.winner);
      plan.winner = winner;
    }
    advance(simulated);
  }
  assert.equal(simulated.status,'complete');
  assert.equal(simulated.champion,state.champion);
  assert.deepEqual(simulated.records,state.records);
  assert.deepEqual(fs.readdirSync(path.join(dir,'receipts')).sort(),expectedReceipts.sort());
  return {id:state.id,state:'complete-verified',at:now(),games:seeds.size,
    series:state.waves.reduce((total,w)=>total+w.fixtures.length,0),seedCommitment:state.seedCommitment,engineSha256,configSha256};
}

async function run(dir, official, teams, auto, waveId) {
  return locked(path.join(dir,'runner.lock'), async()=>{
    const state = read(stateFile(dir));
    const entries = new Map(official.map(row=>[row.info.id,row]));
    assert.equal(state.status,'ready','杯赛当前无法开赛');
    assert.equal(state.engineSha256,engineSha256);
    assert.equal(state.configSha256,configSha256);
    assert.deepEqual(state.teams,teams);
    assert(auto ? state.mode==='sealed'&&!state.manualDraw : (state.mode!=='sealed'||state.manualDraw) && state.waves.at(-1).id===waveId,'轮次或模式已经改变');
    const current = state.waves.at(-1);
    assert(!current.pendingDraw && current.fixtures.length, '请先完成本轮抽签');
    if (state.manualDraw) {
      const publication = read(path.join(dir,'publication.json'));
      const shown = new Set(publication.draws?.[current.id]);
      assert(current.fixtures.every(f=>shown.has(f.id+':0')&&shown.has(f.id+':1')), '请先抽完本轮队伍');
    }
    fs.mkdirSync(path.join(dir,'receipts'),{recursive:true});
    const publish = () => save(stateFile(dir),state);
    do {
      const wave = state.waves.at(-1);
      const pending = [...wave.fixtures];
      let failed = false;
      state.status='running';
      publish();
      await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
        while (!failed && pending.length) {
          const fixture = pending.shift();
          try { await playSeries(dir,state,wave,fixture,entries,publish); }
          catch (error) { fixture.status='technical_hold'; state.message=String(error.message).slice(0,250); }
          if (!fixture.winner) failed=true;
        }
      }));
      if (failed) state.status='technical_hold';
      else {
        for (const fixture of wave.fixtures) {
          fixture.star = fixture.games.some(g=>g.heat>=6) || (fixture.bestOf>1 &&
            fixture.games.filter(g=>g.winner).length===fixture.bestOf);
        }
        advance(state, !state.manualDraw);
      }
      if (state.status==='complete') {
        try {
          save(path.join(dir,'verification.json'), verifyCup(dir,state,teams));
          state.status='complete-verified';
        } catch (error) {
          state.message=String(error.message).slice(0,250);
          state.status='verification_hold';
        }
      }
      publish();
    } while (auto && state.status==='ready');
    return state.status;
  });
}

async function batch(root, id, official, teams) {
  assert(safeId.test(id) && id.length<=53);
  fs.mkdirSync(root,{recursive:true});
  const receipt = path.join(root,`batch-${id}.json`);
  const cups = Array.from({length:5},(_,i)=>({id:`${id}-0${i+1}`,status:'queued'}));
  const launch = {id,createdAt:now(),mode:'sealed',cups,status:'running'};
  fs.writeFileSync(receipt,encode(launch),{flag:'wx'});
  for (const [i,cup] of cups.entries()) create(path.join(root,cup.id),teams,'sealed',`正式杯赛 ${i+1}`);
  const committed = cups.map(cup=>read(stateFile(path.join(root,cup.id))).seedCommitment);
  assert.equal(new Set(committed).size,5);
  for (const cup of cups) {
    cup.status='running';
    save(receipt,launch);
    try { cup.status=await run(path.join(root,cup.id),official,teams,true); }
    catch (error) { cup.status='technical_hold'; cup.error=String(error.message).slice(0,250); }
    save(receipt,launch);
  }
  launch.finishedAt=now();
  launch.status=cups.every(c=>c.status==='complete-verified') ? 'complete-verified' : 'requires-review';
  save(receipt,launch);
  return launch.status;
}

async function main([command,location,arg,name,drawMode]) {
  assert(location,'杯赛数据目录必填');
  const dir = path.resolve(location);
  if (command==='plan-draw') return planDraw(dir,arg);
  const official = demoEntries();
  const teams = seedsFromRatings(official);
  if (command==='prepare-reset') return prepareReset(dir,path.resolve(arg),teams);
  if (command==='create') return create(dir,teams,arg,name,drawMode==='manual').id;
  if (command==='batch') return batch(dir,arg,official,teams);
  if (command==='verify') return verifyCup(dir,read(stateFile(dir)),teams).state;
  assert(['wave','all'].includes(command),'未知杯赛操作');
  return run(dir,official,teams,command==='all',arg);
}

main(process.argv.slice(2)).then(console.log).catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
