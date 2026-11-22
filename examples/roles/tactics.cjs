'use strict';
const G = require('./engine.cjs');

const eq = (a,b) => G.key(a) === G.key(b);
const at = (h, p) => ({...h,p});
const action = (h, name, args = {}) => ({unit:h.id,action:name,...args});
const sameOrder = (a,b) => !!a && !!b && a.action === b.action &&
  a.target === b.target && a.lane === b.lane &&
  JSON.stringify(a.to) === JSON.stringify(b.to) && JSON.stringify(a.cells) === JSON.stringify(b.cells);
const cache = new WeakMap();
const paths = new Map();
const forSide = (objects, team, owner) => [
  ...objects.filter(object => owner(object) === team),
  ...objects.filter(object => owner(object) !== team),
];
const roleValue = {top:1,mid:1.24,adc:1.32,support:.92,jungle:1.08};

function data(s) {
  if (cache.has(s)) return cache.get(s);
  const live = s.heroes.filter(h => h.alive);
  const info = {
    turn:s.decisionTurn ?? s.turn + 1,
    friends:live.filter(h => h.team === s.you),
    foes:live.filter(h => h.team !== s.you),
    danger:new Map(),
  };
  cache.set(s,info);
  return info;
}

function path(team, from, to) {
  const key = team + G.key(from) + ':' + G.key(to);
  if (!paths.has(key)) paths.set(key,G.pathTo(team,from,to));
  return paths.get(key);
}

function damageFrom(s, enemy, target) {
  if (enemy.role === 'support') return 0;
  const inFight = G.sameEngagement(s,enemy,target);
  const base = G.canHeroAttack(enemy,target,s) ? enemy.damage : 0;
  const spell = enemy.role === 'mid' && enemy.spellReady <= s.decisionTurn &&
    (inFight || G.dist(enemy,target) <= 1);
  const reap = enemy.role === 'adc' && enemy.reapReady <= s.decisionTurn && G.canReap(s,enemy,target);
  return reap ? Math.floor(enemy.damage*s.config.reapMultiplier) : spell ? enemy.damage : base;
}

function incoming(s,h,p=h.p) {
  const q = data(s), key = h.id+':'+G.key(p);
  if (!q.danger.has(key)) q.danger.set(key,q.foes
    .filter(enemy => enemy.stunUntil < q.turn)
    .reduce((n,enemy) => n+damageFrom(s,enemy,at(h,p)),0));
  return q.danger.get(key);
}

function risk(s,h,p,safety) {
  const ratio = incoming(s,h,p) / Math.max(1,h.hp);
  return safety * (Math.min(1.75,ratio)*2.0 + (ratio >= 1 ? 3.4 : 0));
}

function combatValue(h,t,amount,aggressive) {
  const ratio = Math.min(1,amount / Math.max(1,t.hp));
  return ratio*3.8 + (amount >= t.hp ? 5.5*roleValue[t.role] : 0) +
    Math.min(1,amount / Math.max(1,t.maxHP))*9.4 + aggressive + (t.hp<t.maxHP*.35 ? .45 : 0);
}

function engageScore(s,h,p) {
  const {friends,foes} = data(s);
  const included = group => group.filter(unit => G.dist(unit,p)<=1);
  const allies = included(friends), enemies = included(foes);
  if (!allies.length || !enemies.length) return -Infinity;
  const force = group => group.reduce((n,u) => n+u.hp*.37+u.damage+u.heal*(u.role==='support'?.45:0),0);
  const slice = group => group.filter(x => x.role !== 'support').length;
  const hisHP = h.hp / h.maxHP;
  const advantage = force(allies)/Math.max(1,force(enemies));
  const killWindow = enemies.some(t => t.hp <= allies.filter(u=>u.id!==h.id).reduce((n,u)=>n+u.damage,0));
  if (advantage < 1.12 || (slice(allies)<1 && allies.length===1) || hisHP<.30) return -Infinity;
  return 4.0 + Math.min(4.3,(advantage-1)*2.2) + Math.max(0,allies.length-enemies.length)*.6 + (killWindow?1.65:0);
}

function candidates(s,h,preset) {
  const q = data(s);
  const allowed = new Set(h.allowedActions);
  const standingRisk = risk(s,h,h.p,preset.safety);
  const underAttack = incoming(s,h)>0;
  const options = [{order:action(h,'wait'),score:0,kind:'wait'}];
  const add = (order,score,kind) => {
    if (!Number.isFinite(score)) return;
    const prior = options.find(option => sameOrder(option.order,order));
    if (prior && prior.score >= score) return;
    if (prior) Object.assign(prior,{score,kind});
    else options.push({order,score,kind});
  };
  const go = (p,value,kind,whenThere=action(h,'wait')) => {
    const route = path(h.team,h.p,p);
    if (!route) return;
    if (route.length===1) add(whenThere,value-(underAttack ? 2.35+standingRisk*.61 : 0),kind);
    else if (allowed.has('move')) add(action(h,'move',{to:route[1]}),
      value-.65*(route.length-1)-risk(s,h,route[1],preset.safety),kind);
  };
  if (allowed.has('recall') && h.hp < h.maxHP*preset.reset && incoming(s,h)===0 &&
      !q.foes.some(t=>t.stunUntil<q.turn&&t.role==='support'&&t.utilityReady<=q.turn&&G.dist(t,h)<=1)) {
    add(action(h,'recall'),4.8+(1-h.hp/h.maxHP)*3.4,'reset');
  }

  const retaliation=underAttack?2.9:0;
  for (const t of q.foes) {
    if (allowed.has('attack')&&G.canHeroAttack(h,t,s)) {
      add(action(h,'attack',{target:t.id}),combatValue(h,t,h.damage,preset.combat)
        +retaliation-standingRisk*.23,'combat');
    }
    if (allowed.has('reap')&&h.reapTargets.includes(t.id)) {
      const damage=Math.floor(h.damage*s.config.reapMultiplier);
      add(action(h,'reap',{target:t.id}),combatValue(h,t,damage,preset.combat)
        +(damage>=t.hp?preset.reap:.08)+retaliation-standingRisk*.22,'combat');
    }
    if (allowed.has('control')&&t.stunUntil<q.turn+1&&G.engagementCanUtility(s,h,t,'control')) {
      const vulnerable=q.friends.some(f=>f.hp<damageFrom(s,t,f)*1.25 && G.dist(f,t)<=2);
      const followup=q.friends.some(f=>f.role!=='support'&&G.dist(f,t)<=2&&f.hp>f.maxHP*.4);
      add(action(h,'control',{target:t.id}),preset.peel*.5+(vulnerable?4.1:0)+(followup?2.0:0)
        +roleValue[t.role]*1.4-standingRisk*.26,'peel');
    }
  }
  if (allowed.has('spell')) {
    const spell = (selected,order) => {
      if (!selected.length) return;
      const wins = selected.map(t=>combatValue(h,t,h.damage,0)).sort((a,b)=>b-a);
      const score=wins[0]+wins.slice(1).reduce((n,v)=>n+v*.75,0)+preset.combat-.14;
      add(order,score+retaliation-standingRisk*.23,'combat');
    };
    for (const cells of h.spellTargets) {
      spell(q.foes.filter(t=>cells.some(p=>eq(p,t.p))),action(h,'spell',{cells}));
    }
    if (h.spellEngagementTargets.length) spell(q.foes.filter(t=>h.spellEngagementTargets.includes(t.id)),action(h,'spell'));
  }
  if (allowed.has('heal')) {
    for (const friend of q.friends) {
      if (friend.hp>=friend.maxHP||!G.engagementCanUtility(s,h,friend,'heal')) continue;
      const heal = Math.min(h.heal,friend.maxHP-friend.hp);
      const threat = incoming(s,friend);
      const saves = threat>=friend.hp && friend.hp+heal>threat && threat>0;
      const urgency = (1-friend.hp/friend.maxHP)*1.6+(threat>0?.9:0)+(saves?6.5:0);
      add(action(h,'heal',{target:friend.id}),preset.peel*(heal/friend.maxHP*6+urgency)*roleValue[friend.role]
        +(friend.id===h.id?standingRisk*.48:-standingRisk*.12),'peel');
    }
  }
  if (allowed.has('engage')) {
    for (const t of q.foes.filter(t=>G.engageCenterLegal(s,h,t.p))) {
      add(action(h,'engage',{to:t.p}),engageScore(s,h,t.p)+preset.engage,'engage');
    }
  }
  if (!allowed.has('move')) return options;

  const homeLane = G.roleLane(h.role);
  const fronts = s.fronts.filter(f=>f.team===h.team && (q.turn>s.config.laneLock||homeLane===f.lane));
  for (const front of fronts) {
    const home = front.lane===homeLane ? preset.lane : 0;
    const target = s.buildings.find(b=>b.id===front.target);
    const defenders = q.foes.filter(t=>G.dist(t,front.p)<=2);
    const allies = q.friends.filter(t=>t.id!==h.id&&G.dist(t,front.p)<=2);
    const higher = defenders.reduce((n,t)=>n+t.damage,0)>h.damage+allies.reduce((n,t)=>n+t.damage,0);
    const solo = allies.length===0 ? preset.split : -.24*allies.filter(t=>t.role!=='support').length;
    const pressure = target?.kind==='base'?3.7:target?.hp<=h.towerDamage*2?2.1:target?1.2:0;
    const rating = 4.3+home+preset.push+pressure+solo-(higher?1.15:0);
    go(front.p,rating,'push',action(h,'push',{lane:front.lane}));
    for (const p of front.cells.filter(p=>!eq(p,front.p))) go(p,3.0+home+solo,'farm');
  }
  const adc = q.friends.find(t=>t.role==='adc');
  if (h.role==='support'&&adc) {
    const adcLane = fronts.find(f=>f.lane==='bottom');
    if (!(adcLane&&eq(adc.p,adcLane.p)&&G.dist(h,adc)<=1)) {
      go(adc.p,4.2+preset.follow+(incoming(s,adc)>0?1.6:0),'peel');
    }
  }
  for (const camp of forSide(s.camps,h.team,camp=>camp.regionTeam)) {
    if (camp.kind==='normal' && (!camp.alive || h.role==='support')) continue;
    if (camp.kind==='ancient' && !camp.alive && !(Number.isFinite(camp.spawnAt)&&camp.spawnAt-q.turn<=4)) continue;
    const allies = q.friends.filter(t=>t.id!==h.id&&G.dist(t,camp.p)<=2);
    const foes = q.foes.filter(t=>G.dist(t,camp.p)<=2);
    if(camp.kind==='normal'){
      const invade = camp.regionTeam!==h.team ? preset.invade : 0;
      go(camp.p,3.5+preset.farm+invade-(foes.length>allies.length+1?2.8:0),'farm',
        action(h,'capture',{target:camp.id}));
    }else{
      const nearAlly = allies.length>0 || h.role==='jungle';
      const value=4.1+preset.objective+(nearAlly?2.3:-1.8)+(camp.hp===1?1.6:0)
        -Math.max(0,foes.length-allies.length-1)*1.55;
      go(camp.p,value,'objective',camp.alive&&nearAlly?action(h,'capture',{target:camp.id}):action(h,'wait'));
    }
  }
  if (preset.roam>0) {
    for (const t of q.foes) {
      const helpers=q.friends.filter(f=>f.id!==h.id&&G.dist(f,t)<=2&&f.role!=='support');
      if (!helpers.length || t.hp>t.maxHP*.75) continue;
      for (const p of G.neighbors(h.team,t.p)) {
        const fake=at(h,p);
        if (h.role!=='mid'&&!G.canHeroAttack(fake,t,s)&&!G.canReap(s,fake,t)) continue;
        go(p,3.0+preset.roam+helpers.length*.7+(1-t.hp/t.maxHP)*3,'combat');
      }
    }
  }
  if (allowed.has('teleport')) {
    for (const b of G.teleportTargets(s,h)) for (const f of fronts) {
      const walk = path(h.team,h.p,f.p)?.length;
      const after = path(h.team,b.p,f.p)?.length;
      if (!walk||!after||walk-after<3) continue;
      add(action(h,'teleport',{to:b.p}),4.1+preset.push+Math.min(2.5,(walk-after)*.42)
        +(homeLane===f.lane?1:0)-after*.4-risk(s,h,b.p,preset.safety),'push');
    }
  }
  if (h.hp<h.maxHP*.65) {
    go(G.FOUNTAIN[h.team],(1-h.hp/h.maxHP)*7.7,'reset');
    for (const p of G.neighbors(h.team,h.p)) {
      const improvement=standingRisk-risk(s,h,p,preset.safety);
      if (improvement>1) add(action(h,'move',{to:p}),improvement+1.6,'reset');
    }
  }
  return options;
}

function final(s,h,p) {
  const {foes,friends}=data(s);
  const a=new Set(s.finalDecision.legalActions);
  const values=[{order:action(h,'wait'),score:0}];
  if (a.has('spell')) {
    const strikes=foes.map(t=>combatValue(h,t,h.damage,0)).sort((x,y)=>y-x);
    const all=strikes[0]+strikes.slice(1).reduce((n,v)=>n+v*.77,0);
    values.push({order:action(h,'spell'),score:all});
  }
  for (const t of foes) {
    for (const name of ['attack','reap']) {
      if (!a.has(name)) continue;
      const power=name==='reap'?Math.floor(h.damage*s.config.reapMultiplier):h.role==='support'?h.heal:h.damage;
      values.push({order:action(h,name,{target:t.id}),score:combatValue(h,t,power,0)
        +(name==='reap'&&power>=t.hp?.32:0)});
    }
    if (a.has('control')&&!s.battle.skip[t.id]) {
      const imminent=t.damage*(t.role==='mid'?1.5:1);
      const legalAttack=t.role!=='support'||foes.length===1;
      values.push({order:action(h,'control',{target:t.id}),score:(legalAttack?2.75+imminent/Math.max(1,h.maxHP)*5:1.1)});
    }
  }
  if (a.has('heal')) for (const t of friends.filter(t=>t.hp<t.maxHP)) {
    const hp=Math.min(h.heal,t.maxHP-t.hp);
    const saves=foes.some(f=>f.damage>=t.hp&&f.damage<t.hp+hp);
    values.push({order:action(h,'heal',{target:t.id}),score:(hp/t.maxHP*7+(saves?3.7:0))*roleValue[t.role]*p.peel});
  }
  return values.sort((x,y)=>y.score-x.score)[0].order;
}

const defaults={lane:0,push:0,split:0,combat:0,farm:0,invade:0,objective:0,roam:0,
  peel:1,follow:0,engage:0,reap:0,safety:1,reset:.31};
const standardRole={
  top:{lane:2.2,push:1.5,combat:1.2},mid:{lane:2,combat:1.6,roam:1.2},
  jungle:{farm:3.25,invade:.8,objective:2.5,roam:1.5},
  adc:{lane:2.5,push:1.35,reap:1.55,safety:1.1},support:{lane:1.2,peel:1.25,follow:.8},
};
function forecast(s) {
  const q=data(s);
  if(q.forecast)return q.forecast;
  q.forecast=Object.fromEntries([s.you,G.enemy(s.you)].map(team=>{
    const side=team===s.you?s:{...s,you:team};
    return [team,data(side).friends.map(h=>candidates(side,h,{...defaults,...standardRole[h.role]})
      .sort((a,b)=>b.score-a.score)[0].order)];
  }));
  return q.forecast;
}
function changeOrder(orders,order){
  return [...orders.filter(o=>o.unit!==order.unit),order];
}
function outcome(s,n,focus=null){
  if(n.result)return n.result.winner===s.you?99:n.result.winner===null?0:-99;
  let score=0;
  const heroes = new Map(n.heroes.map(hero=>[hero.id,hero]));
  const buildings = new Map(n.buildings.map(building=>[building.id,building]));
  for (const h of forSide(s.heroes,s.you,hero=>hero.team)) {
    const a=heroes.get(h.id),sign=h.team===s.you?1:-1, weight=focus===h.id?1.65:1;
    if(!h.alive)continue;
    const life=a.hp/a.maxHP-h.hp/h.maxHP;
    score+=sign*weight*(life*(h.team===s.you?7.5:5.2)+(a.alive?0:-6)+(a.gold-h.gold)/31);
  }
  for (const b of forSide(s.buildings,s.you,building=>building.team)) {
    const a=buildings.get(b.id);
    score+=(b.team===s.you?-1:1)*((b.hp-a.hp)*(b.kind==='base'?.62:.32)+(b.hp>0&&a.hp<=0?2.5:0));
  }
  return score;
}
function compare(s,own,focus=null,coach=null){
  const other=G.enemy(s.you);
  const orders={[s.you]:{orders:own,coach},[other]:{orders:forecast(s)[other]}};
  return outcome(s,G.simulate(s,orders,'squad-public-'+s.turn,{mirrorRandomness:s.you==='B'}),focus);
}
function makeRole(role, overrides) {
  return function decide(s) {
    const h=s.heroes.find(h=>h.id===s.you+'_'+role);
    if (!h?.alive || s.phase==='final_battle'&&s.finalDecision.actor!==h.id) return null;
    const preset={...defaults,...(typeof overrides==='function'?overrides(s,h):overrides)};
    if (s.phase==='final_battle') return final(s,h,preset);
    if (s.phase!=='map') return null;
    const pool=candidates(s,h,preset).sort((a,b)=>b.score-a.score);
    if (pool.length<2||(!incoming(s,h)&&!data(s).foes.some(t=>G.dist(h,t)<=1)))return pool[0].order;
    const virtual=forecast(s)[s.you];
    return pool.slice(0,3).map(p=>({order:p.order,
      score:p.score*.58+compare(s,changeOrder(virtual,p.order),h.id)}))
      .sort((a,b)=>b.score-a.score)[0].order;
  };
}

function makeCoach(overrides,priority) {
  return function decide(s,proposals) {
    if (s.phase!=='map') return null;
    const q=data(s), selected=Object.fromEntries(proposals.map(order=>[order.unit,order]));
    const candidatesToTest=[];
    for (const h of q.friends) {
      const preset={...defaults,...overrides[h.role]};
      const pool=candidates(s,h,preset);
      const current=pool.find(x=>sameOrder(x.order,selected[h.id]))?.score??0;
      if (G.engageCanCast(s,h,q.turn,true) && !proposals.some(o=>o.action==='engage')) {
        for (const t of q.foes.filter(t=>G.engageCenterLegal(s,h,t.p))) {
          pool.push({order:action(h,'coach_engage',{to:t.p}),score:engageScore(s,h,t.p)-.35,kind:'engage'});
        }
      }
      for (const option of pool) {
        if (sameOrder(option.order,selected[h.id]) || option.kind==='wait') continue;
        const gain=option.score-current+(priority[option.kind]||0);
        if (gain>priority.threshold&&G.coachOrderLegal(s,s.you,option.order,q.turn))candidatesToTest.push({...option,gain});
      }
    }
    if(!candidatesToTest.length)return null;
    const base=compare(s,proposals);
    const best=candidatesToTest.sort((a,b)=>b.gain-a.gain).slice(0,4).map(option=>({
      ...option, net:compare(s,proposals,null,option.order)-base+option.gain*.16,
    })).sort((a,b)=>b.net-a.net)[0];
    return best.net>.2?best.order:null;
  };
}

module.exports={makeRole,makeCoach};
