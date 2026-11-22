'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {line, put, gate, frame} = require('./stream-worker.cjs');
const {engine:G, engineSha256, config, childPilot, rosterFor, squad} = require('../referee/challenge.cjs');
const sides = ['A', 'B'];

function controllers(job) {
  return Object.fromEntries(sides.map(side => {
    const entry = job[side];
    if (entry.kind === 'human') return [side, null];
    assert.equal(entry.kind, 'squad-s16');
    const sealed = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
    const files = squad(sealed.candidate);
    const roster = rosterFor(sealed.rosters, 'candidate');
    const computed = createHash('sha256').update(JSON.stringify([Object.entries(files).sort(), roster])).digest('hex');
    assert.equal(computed, entry.digest, 'Sealed sandbox squad differs from its formal submission');
    return [side, {files, roster}];
  }));
}

function publishFrame(job, state, frames) {
  const visible = Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('_')));
  visible.heroes = state.heroes.map(hero => ({...hero, ...G.stats(hero, state.config, state.mapTurn), maxHP:hero.maxHP}));
  frames.push(visible);
  frame(job, visible);
}

function humanOrders(job, state, actors) {
  const teams = actors.filter(team => job[team].kind === 'human');
  if (!teams.length) return {};
  const observations = Object.fromEntries(teams.map(team => {
    const obs = G.observe(state, team);
    obs.ruleset = 's16';
    for (const hero of obs.heroes) {
      if (hero.team === team) hero.coachEngageAvailable = G.engageCanCast(obs, hero, obs.decisionTurn, true);
    }
    return [team, obs];
  }));
  put(job.requestPath, {waiting:true, turn:state.turn + 1, teams, observations});
  const input = JSON.parse(line());
  if (input.stop) throw Error('Stopped by user');
  if (input.turn !== state.turn + 1 || teams.some(team => !Array.isArray(input.commands?.[team]?.orders))) {
    throw Error('Human turn mismatch');
  }
  return input.commands;
}

async function play(job) {
  assert.equal(job.budgetMs, 2000);
  const teams = controllers(job), pilots = {}, faults = [], frames = [];
  let state = G.makeState(job.seed, config);
  publishFrame(job, state, frames);
  const recordFault = (team, error) => faults.push({team, turn:state.turn, message:String(error.message).slice(0,200)});
  try {
    for (const team of sides) {
      const item = teams[team];
      if (!item) continue;
      try {
        pilots[team] = childPilot(item.files, item.roster.coreRole);
        await pilots[team].ready();
      } catch (error) { recordFault(team, error); }
    }
    while (!state.result && state.turn < 1000 && !faults.length) {
      gate(job);
      const active = state.phase === 'final_pending' ? [] : state.phase === 'final_battle' ? [state.battle.actor[0]] : sides;
      const commands = humanOrders(job, state, active);
      await Promise.all(active.filter(team => pilots[team]).map(async team => {
        try { commands[team] = await pilots[team].decide(G.observe(state,team)); }
        catch (error) { recordFault(team,error); }
      }));
      if (faults.length) break;
      state = G.step(state, commands);
      publishFrame(job, state, frames);
    }
  } finally {
    for (const pilot of Object.values(pilots)) pilot.close();
  }
  return {id:job.id, ruleset:'s16', status:faults.length ? 'technical_hold' : state.result ? 'completed' : 'unfinished',
    engineSha256, engineVersion:G.VERSION, decisionBudgetMs:job.budgetMs, config:state.config,
    result:faults.length ? null : state.result, mapTurns:state.mapTurn, turns:state.turn,
    battleActions:state.battle?.actions ?? 0, frames, faults};
}

const job = JSON.parse(line());
play(job).then(result => {
  put(job.requestPath, {waiting:false, done:true, faults:result.faults});
  fs.writeFileSync(1, JSON.stringify(result) + '\n');
}).catch(error => {
  fs.writeFileSync(2, String(error.message));
  process.exitCode = 2;
});
