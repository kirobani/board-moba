'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const {demoEntries} = require('../examples/squads.cjs');
const {game, engineSha256} = require('../referee/challenge.cjs');
const {basis: seedBasis, ratings} = require('./swiss-s16-ratings.json');
const workspace = path.resolve(__dirname, '../..');
const directory = process.argv[3] ? path.resolve(process.argv[3]) : path.join(workspace, 'outputs/moba-field-20261119/swiss-20261120');
const stateFile = path.join(directory, 'state.json');
const regionSlots = {OAI:2, GOO:2, ANTH:2, XAI:1, CNAI:8, ICK:1};
const regions = [['gpt-6.2','OAI'], ['google/','GOO'], ['claude-','ANTH'], ['grok-','XAI'], ['upstage/','ICK']];
const groups = [
  ['OAI1','ANTH1','GOO1','CNAI1'],
  ['CNAI2','GOO2','OAI2','ANTH2'],
  ['XAI1','CNAI3','CNAI4','CNAI5'],
  ['CNAI6','CNAI7','CNAI8','ICK1'],
];

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const pairKey = (a,b) => [a,b].sort().join('|');
const region = model => regions.find(([prefix]) => model.startsWith(prefix))?.[1] ?? 'CNAI';
function save(state) {
  const temp = stateFile + '.' + randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', {flag:'wx'});
  fs.renameSync(temp, stateFile);
}

function seedsFromRatings(official) {
  const entries = official.map(row => row.info);
  assert.deepEqual(Object.keys(ratings).sort(), entries.map(e=>e.model).sort(), 'rating snapshot roster');
  assert(Object.values(ratings).every(score=>score===null || Number.isFinite(score)), 'invalid rating');
  const score = item => ratings[item.model] ?? -Infinity;
  const out = {};
  for (const [tag, count] of Object.entries(regionSlots)) {
    const same = entries.filter(e => region(e.model) === tag).sort((a,b) => score(b)-score(a) || a.model.localeCompare(b.model));
    assert.equal(same.length, count, tag);
    for (const [index,item] of same.entries()) {
      const slot = tag+(index+1);
      const pool = groups.findIndex(names => names.includes(slot))+1;
      assert(pool);
      out[item.id] = {id:item.id, name:item.label, model:item.model, region:tag, slot, pool, rating:ratings[item.model], digest:item.digest};
    }
  }
  return out;
}

function matches(ids, eligible) {
  if (!ids.length) return [[]];
  const [a,...remaining] = ids;
  return remaining.flatMap((b,i) => {
    if (!eligible(a,b)) return [];
    return matches(remaining.filter((_,j) => i!==j),eligible).map(tail=>[[a,b],...tail]);
  });
}

function pick(list, state, context) {
  assert(list.length, '当轮无不重复交手的合法抽法');
  const index = parseInt(hash(state.drawSeed+'|'+context).slice(0,12),16)%list.length;
  return list[index];
}

function bracketPairs(state) {
  const ids = Object.keys(state.teams);
  const p = n => ids.filter(id => state.teams[id].pool===n);
  function draw(high, low, key) {
    const all = matches([...high,...low],(a,b)=>high.includes(a)&&low.includes(b)&&state.teams[a].region!==state.teams[b].region);
    return pick(all,state,key);
  }
  return [...draw(p(1),p(4),'round-1-p1-p4'), ...draw(p(2),p(3),'round-1-p2-p3')];
}

const record = (w,l) => w+'–'+l;
function addSwiss(state, number, pairs) {
  const wave = {id:'R'+number, title:'瑞士轮 · 第 '+number+' 轮',stage:'swiss',fixtures:[]};
  if (!pairs) {
    state.waves.push({...wave,pendingDraw:true});
    return;
  }
  if (state.format==='cup-swiss') {
    const order = pair => hash(`${state.drawSeed}|${wave.id}|${pairKey(...pair)}`);
    pairs = [...pairs].sort((a,b) => order(a).localeCompare(order(b)));
  }
  for (const [index,[a,b]] of pairs.entries()) {
    const {wins,losses} = state.records[a];
    assert.deepEqual(state.records[b], state.records[a], 'cross-record pairing');
    const bestOf = wins===2||losses===2 ? 3 : 1;
    wave.fixtures.push({id:wave.id+'-'+(index+1), bestOf, teams:[a,b], record:record(wins,losses),games:[],winner:null,status:'ready'});
  }
  state.waves.push(wave);
}

function setup(teams, drawSeed, competition = {}, plan = true) {
  const records = Object.fromEntries(Object.keys(teams).map(id => [id,{wins:0,losses:0}]));
  const state = {id:'s16-swiss-20261120',engineSha256, drawSeed, seedBasis, status:'ready', teams, records, waves:[], champion:null, ...competition};
  addSwiss(state,1,plan ? bracketPairs(state) : null);
  return state;
}

function unplayed(state) {
  const history = new Set(state.waves.filter(w=>w.stage==='swiss').flatMap(w=>w.fixtures.map(f=>pairKey(...f.teams))));
  return (a,b) => !history.has(pairKey(a,b));
}

function futureRoundFive(upper, lower, eligible) {
  const rounds = [...upper, ...lower];
  // The 2–1 losers and 1–2 winners are exactly the six teams eligible for Round 5.
  for (let mask=0; mask<2**rounds.length; mask++) {
    const teams = rounds.map(([a,b],i) => (mask>>i)&1 ? a : b);
    if (!matches(teams,eligible).length) return false;
  }
  return true;
}

function laterSwiss(state, number) {
  const active = Object.entries(state.records).filter(([,r]) => r.wins<3&&r.losses<3);
  const byRecord = new Map();
  for (const [id,{wins,losses}] of active) {
    const k = record(wins,losses);
    const list = byRecord.get(k) ?? [];
    list.push(id);
    byRecord.set(k,list);
  }
  const eligible = unplayed(state);
  if (number === 4) {
    const upper = matches(byRecord.get('2–1'),eligible), lower = matches(byRecord.get('1–2'),eligible);
    const safe = upper.flatMap(a=>lower.filter(b=>futureRoundFive(a,b,eligible)).map(b=>[...a,...b]));
    return pick(safe,state,'round-4-preserve-round-5');
  }
  return [...byRecord].sort(([a],[b])=>b.localeCompare(a)).flatMap(([k,ids]) =>
    pick(matches(ids,eligible),state,'round-'+number+'-'+k));
}

function addKnockout(state, id, title, pairs) {
  if (!pairs) {
    state.waves.push({id,title,stage:'knockout',fixtures:[],pendingDraw:true});
    return;
  }
  state.waves.push({id,title,stage:'knockout',fixtures:pairs.map((teams,index) =>
    ({id:id+'-'+(index+1),bestOf:5,teams,games:[], winner:null,status:'ready'}))});
}

function quarters(state) {
  const withRecord = l => Object.keys(state.records).filter(id=>state.records[id].wins===3&&state.records[id].losses===l);
  const clean = withRecord(0), mid = withRecord(1), last = withRecord(2);
  assert.deepEqual([clean.length, mid.length, last.length],[2,3,3]);
  const a = pick(last,state,'quarters-3-0-first');
  const b = pick(last.filter(x=>x!==a),state,'quarters-3-0-second');
  const rest = pick(matches([...mid,last.find(x=>x!==a&&x!==b)],()=>true),state,'quarters-mixed-four');
  return [[clean[0],a], rest[0], [clean[1],b], rest[1]];
}

function advance(state, plan = true) {
  const w = state.waves.at(-1);
  assert(w.fixtures.every(f=>f.teams.includes(f.winner)));
  if (w.stage==='swiss') {
    for (const f of w.fixtures) {
      state.records[f.winner].wins++;
      state.records[f.teams.find(t=>t!==f.winner)].losses++;
    }
    const round = Number(w.id.slice(1));
    if (round<5) addSwiss(state,round+1,plan ? laterSwiss(state,round+1) : null);
    else addKnockout(state,'QF','四分之一决赛',plan ? quarters(state) : null);
  } else if (w.id==='QF') {
    addKnockout(state,'SF','半决赛', plan ? [[w.fixtures[0].winner,w.fixtures[1].winner],[w.fixtures[2].winner,w.fixtures[3].winner]] : null);
  } else if (w.id==='SF') {
    addKnockout(state,'GF','决赛', plan ? [w.fixtures.map(f=>f.winner)] : null);
  } else {
    state.champion = w.fixtures[0].winner;
  }
  state.status = state.champion ? 'complete' : 'ready';
}

async function playWave(state, official, notify) {
  assert.equal(state.engineSha256, engineSha256);
  assert.equal(state.status,'ready');
  const entries = new Map(official.map(item=>[item.info.id,item]));
  for (const [id,t] of Object.entries(state.teams)) assert.equal(t.digest,entries.get(id)?.info.digest);
  state.status='running';
  notify();
  const wave=state.waves.at(-1);
  let cursor=0;
  let hostError=null;
  await Promise.all(Array.from({length:4},async () => {
    while (!hostError && cursor<wave.fixtures.length) {
      const f=wave.fixtures[cursor++];
      try {
        const [a,b]=f.teams, first=entries.get(a), second=entries.get(b), wins={[a]:0,[b]:0};
        const required=Math.floor(f.bestOf/2)+1;
        f.status='running';
        notify();
        while (f.games.length < f.bestOf + 4) {
          const index=f.games.length;
          const flip=(parseInt(hash(state.drawSeed+'|side|'+f.id).slice(0,2),16)+index)%2;
          const seed=hash(state.drawSeed+'|game|'+f.id+'|'+index).slice(0,32);
          const A=flip?b:a, B=flip?a:b;
          const replays=path.join(directory,'replays',f.id);
          fs.mkdirSync(replays,{recursive:true});
          const result=await game({A:flip?'sparring':'candidate',B:flip?'candidate':'sparring',pair:index,seed,opponent:'sparring',replay:true},
            {candidate:first.files,sparring:second.files},{candidate:first.info.roster,sparring:second.info.roster},replays);
          const winner = result.winner === 'A' ? A : result.winner === 'B' ? B : null;
          f.games.push({A,B,seed,winner,mapTurns:result.mapTurns,reason:result.reason,faults:result.faults,
            outcome:result.outcome,replay:result.replay});
          if (winner && ++wins[winner]>=required) {
            f.winner=winner;
            break;
          }
          if (result.outcome==='technical'||result.outcome==='unfinished') break;
          notify();
        }
        f.status=f.winner?'complete':'technical_hold';
        notify();
      } catch (error) {
        hostError=error;
        f.status='technical_hold';
      }
    }
  }));
  try {
    if (wave.fixtures.some(f=>!f.winner)) state.status='technical_hold';
    else advance(state);
  } catch (error) {
    state.status='technical_hold';
    state.message=error.message;
    hostError ??= error;
  }
  notify();
  if (hostError) throw hostError;
}

async function main(command) {
  const official=demoEntries();
  if (command==='verify') {
    const teams=seedsFromRatings(official);
    for (let trial=0;trial<512;trial++) {
      const state=setup(teams,'simulation-'+trial);
      const tested=new Set();
      while (!state.champion) {
        const w=state.waves.at(-1);
        for (const f of w.fixtures) {
          const [a,b]=f.teams;
          if (w.stage==='swiss') {
            assert(!tested.has(pairKey(a,b)));
            tested.add(pairKey(a,b));
            const r=state.records[a];
            assert.equal(f.bestOf,r.wins===2||r.losses===2?3:1);
          } else assert.equal(f.bestOf,5);
          f.winner=f.teams[parseInt(hash(trial+' '+f.id).slice(0,2),16)%2];
        }
        advance(state);
      }
      assert.deepEqual(state.waves.map(w=>w.fixtures.length),[8,8,8,6,3,4,2,1]);
    }
    console.log('Verified 512 draws through a completed single-elimination bracket.');
    return;
  }
  fs.mkdirSync(directory,{recursive:true});
  const lock=path.join(directory,'runner.lock');
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx'});
  try {
    if (command==='prepare') {
      if (!fs.existsSync(stateFile)) save(setup(seedsFromRatings(official),randomBytes(16).toString('hex')));
      console.log('开幕抽签已保存');
    } else if (command==='reseed') {
      const state=read(stateFile);
      const [wave]=state.waves;
      assert(state.status==='ready' && !state.champion && state.waves.length===1 && wave.id==='R1' &&
        wave.fixtures.length===8 && wave.fixtures.every(f=>f.status==='ready' && !f.winner && f.games.length===0) &&
        Object.values(state.records).every(r=>r.wins===0 && r.losses===0), '仅可重抽未开打的首轮');
      const teams=seedsFromRatings(official);
      assert.equal(state.engineSha256,engineSha256);
      assert.deepEqual(Object.keys(state.teams).sort(),Object.keys(teams).sort());
      for (const [id,team] of Object.entries(teams)) assert.equal(state.teams[id].digest,team.digest,id);
      save(setup(teams,state.drawSeed));
      console.log('已按公开模型评分重排种子并重抽首轮');
    } else if (command==='advance') {
      const state=read(stateFile);
      await playWave(state,official,()=>save(state));
      console.log(state.status);
    } else throw Error('Use prepare, reseed, advance or verify');
  } finally {fs.unlinkSync(lock);}
}

if (require.main===module) main(process.argv[2]).catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});

module.exports = {setup, seedsFromRatings, advance};
