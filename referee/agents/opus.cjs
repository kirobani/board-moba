// Board-MOBA agent "opus" (hex-moba-rules-20261028-v2.1).
// Sources: the self policy is adapted from the public baseline policies/resource_v2.cjs (Sol V15 search core,
// itself adapted from public hex-moba-contest policies). The three public baselines (policies/balanced_v2.cjs,
// policies/resource_v2.cjs, policies/siege_v2.cjs) are embedded verbatim ONLY as candidate opponent-behaviour
// models that are identified online from public events; see STRATEGY.txt.
'use strict';
const __G=require('./engine.cjs');
function makeShadow0(){const module={exports:{}};const exports=module.exports;const require=function(n){if(n==='./engine.cjs')return __G;throw new Error('Only ./engine.cjs');};
// Attribution: adapted from public hex-moba-contest policies (Sol V15 search core); new rules, skills, final solver and macro changes by this task.
'use strict';
const Q={"macro":"new","start":41,"future":3.2,"risk":1.15,"rollout":4,"roleMoney":false,"speculate":false},P={"travel":3,"structureCost":0.22,"crowd":8,"finish":95,"income":2,"moveRisk":0.9,"campRisk":8,"squad":3,"split":false,"counter":false,"carryLate":true,"jungleFarm":true,"resource":1,"notice":3,"resourceSquad":3,"resourceRatio":0.85,"resourcePatience":5,"resourceAvoid":9,"idleLimit":4,"recall":0.3,"pushRisk":1,"engageRatio":1.05,"id":"balanced_v2"};
'use strict';
// Sol V15 entrant v3. Reuses public policies/sol_ref.cjs (frozen-sol-v7).
// Changes: resource staffing, cooperative push/capture, expected tied rewards, proactive defense.
const G=require('./engine.cjs');
const PLAN={"mode":"split","rotate":40,"jungle":"farm","primary":"bottom","dynamicLane":false,"routeHP":0.4,"routeDistance":4,"routeThreat":0.02,"campRisk":6,"invade":0,"anticipate":3,"ancientRisk":2,"ancientHelp":[],"helpRange":4,"helpThreat":1,"rotateOpened":true,"reactCluster":[],"defend":true,"defendHP":18,"gold":1.0,"hp":1.0,"death":1.0,"position":1.2,"tower":3.5,"base":1.5,"ancient":1.0,"income":1.0,"passes":2};
const relativeID=(team,id)=>team==='A'?id:id.replace(/^[AB]_/,m=>m==='A_'?'B_':'A_');
const localNeighbors=(team,p)=>G.neighbors('A',team==='A'?p:p.map(v=>-v)).map(q=>team==='A'?q:q.map(v=>-v));
const K=p=>p.join(','), eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const cells=G.CELLS, ix=new Map(cells.map((p,i)=>[K(p),i]));
const adj=cells.map(p=>G.neighbors('A',p).map(q=>ix.get(K(q))));
const terrain=cells.map(p=>G.isLane(p));
const dd=cells.map((p,i)=>{const d=Array(cells.length).fill(99),q=[i];d[i]=0;for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(d[j]===99){d[j]=d[q[n]]+1;q.push(j);}return d;});
const distance=(a,b)=>dd[ix.get(K(a.p||a))][ix.get(K(b.p||b))];
const canHit=(a,b)=>G.dist(a,b)<=1&&(terrain[ix.get(K(a.p||a))]||!terrain[ix.get(K(b.p||b))]);
const order=(h,action,extra)=>({unit:h.id,action,...extra});
const valueRole={top:1,mid:1.35,adc:1.5,support:1,jungle:1.12};

// Fixed-order final arena, explicit adversarial prefix and several continuation policies.
/* Final solver and tactics are defined below. */
let history={turn:0,units:{},escort:null};
const O=(h,action,more={})=>({unit:h.id,action,...more});
function refresh(s){s.decisionTurn=s.turn+1;s.fronts=G.fronts(s);for(const h of s.heroes)Object.assign(h,G.stats(h,s.config));return s;}
function track(s){
 if(s.decisionTurn<=history.turn)history={turn:0,units:{},escort:null};
 for(const h of s.heroes.filter(h=>h.team!==s.you)){
  const m=history.units[h.id]||{lane:G.roleLane(h.role),last:'move',push:0,attack:0,capture:0,engage:0};
  for(const k of ['push','attack','capture','engage'])m[k]*=.96;
  for(const e of s.events||[]){
   let a=null;
   if(e.kind==='push_contest'&&(e.sources?.[h.team]||[]).includes(h.id)){a='push';m.lane=e.lane;}
   if(e.kind==='ancient_progress'&&e.sources.includes(h.id))a='capture';
   if(e.source===h.id||e.unit===h.id){
    if(e.kind==='hit')a=e.attackType==='capture'?'capture':'attack';
    if(['aoe','engage_aoe','spell','reap'].includes(e.kind))a='attack';
    if(['move','teleport','recall','heal','control'].includes(e.kind))a=e.kind;
    if(e.kind==='engage_cast')a='engage';
   }
   if(a){m.last=a;if(m[a]!==undefined)m[a]++;}
  }
  const f=s.fronts.filter(f=>f.team===h.team).sort((a,b)=>distance(h,a.p)-distance(h,b.p));
  if(s.decisionTurn>40&&m.last==='move'&&distance(h,f[0].p)<2)m.lane=f[0].lane;
  m.stationary=m.p&&eq(m.p,h.p)?(m.stationary||0)+1:0;if(m.stationary>=2&&!(s.events||[]).some(e=>(e.unit===h.id||e.source===h.id)&&['move','teleport','recall','hit','heal','control','engage_cast'].includes(e.kind)))m.last='wait';m.oldP=m.p;m.p=h.p.slice();history.units[h.id]=m;
 }
 history.turn=s.decisionTurn;
}
function danger(s,h,p,r=s.turn+1){return v2Incoming(s,h,p,r);}
function travel(s,h,p){
 if(eq(h.p,p))return O(h,'wait');
 const ns=localNeighbors(h.team,h.p);ns.sort((a,b)=>distance(a,p)-distance(b,p)||danger(s,h,a)-danger(s,h,b)||K(h.team==='A'?a:a.map(v=>-v)).localeCompare(K(h.team==='A'?b:b.map(v=>-v))));
 return ns.length?O(h,'move',{to:ns[0]}):O(h,'wait');
}
// New-version tactics. Shared by the three documented baseline families.
function v2CombatOptions(s,h,foes,predicted=[]){
 const r=s.turn+1,a=G.engageAllowedActions(s,h,r),out=[];if(Q.speculate===false)predicted=[];
 if(a.includes('attack'))for(const t of foes)if(G.canHeroAttack(h,t,s)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canHeroAttack(h,{...t,p:o.to},s))))out.push(O(h,'attack',{target:t.id}));
 if(a.includes('reap'))for(const t of foes)if(G.canReap(s,h,t)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canReap(s,h,{...t,p:o.to}))))out.push(O(h,'reap',{target:t.id}));
 if(a.includes('spell'))for(const cells of G.spellTargets(s,h))if(foes.some(t=>cells.some(p=>eq(p,t.p)))||predicted.some(os=>os.some(o=>o.unit[0]!==h.team&&o.action==='move'&&cells.some(p=>eq(p,o.to)))))out.push(O(h,'spell',{cells}));
 return out;
}
function v2Incoming(s,h,p,r=s.turn+1){
 let sum=0;
 for(const t of s.heroes.filter(t=>t.alive&&t.team!==h.team&&t.role!=='support'&&t.stunUntil<r)){
  const victim={...h,p},basic=G.canHeroAttack(t,victim,s)?t.damage:0;
  const reap=t.role==='adc'&&t.reapReady<=r&&G.canReap(s,t,victim)?Math.floor(t.damage*s.config.reapMultiplier):0;
  const spell=t.role==='mid'&&t.spellReady<=r&&G.spellTargets(s,t).some(cells=>cells.some(q=>eq(q,p)))?t.damage:0;
  sum+=Math.max(basic,reap,spell);
 }
 return sum;
}
function combat(s,h,mode=0){
 const r=s.turn+1,all=s.heroes.filter(x=>x.alive&&x.team===h.team),foes=s.heroes.filter(x=>x.alive&&x.team!==h.team),wait=O(h,'wait'),allowed=G.engageAllowedActions(s,h,r);
 if(!h.alive||h.stunUntil>=r)return wait;
 if(h.engageRecoveryUntil>=r){if(allowed.includes('recall')&&h.hp<h.maxHP*.6&&!G.threatened(s,h))return O(h,'recall');return wait;}
 const threat=t=>t.role==='support'?t.heal*1.4:t.damage*(t.role==='mid'?1.4:t.role==='adc'?1.18:1);
 const harm=(t,power)=>Math.min(power,t.hp)*(.5+threat(t)/Math.max(100,t.maxHP))+(t.hp<=power?280+threat(t)*1.5+t.gold*.04:0);
 let best=wait,bv=0;
 if(h.role==='support'){
  for(const t of all)if(G.engagementCanUtility(s,h,t,'heal')){const n=Math.min(h.heal,t.maxHP-t.hp),danger=v2Incoming(s,t,t.p,r),v=n*(.8+(t.role==='mid'?.35:t.role==='adc'?.3:0))+(t.hp<=danger&&t.hp+n>danger?200+threat(t):0);if(v>bv){bv=v;best=O(h,'heal',{target:t.id});}}
  if(allowed.includes('control'))for(const t of foes)if(t.stunUntil<r+1&&G.engagementCanUtility(s,h,t,'control')){const v=threat(t)*.9;if(v>bv){bv=v;best=O(h,'control',{target:t.id});}}
  return bv>5?best:wait;
 }
 for(const o of v2CombatOptions(s,h,foes)){
  let v=0;
  if(o.action==='spell'){const targets=foes.filter(t=>o.cells.some(p=>eq(p,t.p)));v=targets.reduce((n,t)=>n+harm(t,h.damage),0)-h.damage*.12;}
  else{const t=foes.find(t=>t.id===o.target),power=o.action==='reap'?Math.floor(h.damage*s.config.reapMultiplier):h.damage;v=harm(t,power)-(o.action==='reap'&&t.hp>power?h.damage*.08:0);if(mode===1)v+=power/(1+t.hp/Math.max(1,power));}
  if(v>bv){bv=v;best=o;}
 }
 return best;
}

// Final combat uses the actual new engine, not the old forced-mid-wait approximation.
function arena(s){
 const d=s.finalDecision;if(!d||d.team!==s.you)return{orders:[]};const actor=s.heroes.find(h=>h.id===d.actor);
 if(d.forcedWait)return{orders:[O(actor,'wait')]};
 const team=s.you,opp=G.enemy(team),base={phase:'final_battle',turn:s.turn,mapTurn:s.mapTurn,version:s.version,config:s.config,heroes:G.clone(s.heroes),battle:G.clone(s.battle),teams:G.clone(s.teams),events:[],orders:{A:[],B:[]},result:null};
 function options(n){
  const dd=G.finalDecision(n),h=n.heroes.find(x=>x.id===dd.actor),friends=n.heroes.filter(x=>x.alive&&x.team===h.team),foes=n.heroes.filter(x=>x.alive&&x.team!==h.team),out=[];
  if(dd.forcedWait)return[O(h,'wait')];
  for(const a of dd.legalActions){if(a==='spell')out.push(O(h,'spell'));else if(a==='attack'||a==='reap'||a==='control'){for(const t of foes)if(a!=='control'||!n.battle.skip[t.id])out.push(O(h,a,{target:t.id}));}else if(a==='heal'){for(const t of friends)if(t.hp<t.maxHP)out.push(O(h,'heal',{target:t.id}));}}
  return out.length?out:[O(h,'wait')];
 }
 function value(n,side){
  if(n.result)return n.result.winner===side?1e8:-1e8;
  let v=0;
  for(const h of n.heroes){const sign=h.team===side?1:-1,p=h.role==='support'?h.heal*1.35:h.damage*(h.role==='mid'?1.5:h.role==='adc'?1.12:1),w=150+p*.8+h.gold*.035;
   if(h.alive){v+=sign*(w*(.55+h.hp/h.maxHP*.45)+Math.sqrt(h.hp)*.5);if(n.battle.skip[h.id])v-=sign*p*.35;}}
  return v;
 }
 function step(n,o){return G.stepFinalBattle(n,{[o.unit[0]]:{orders:[o]}});}
 function ranked(n,limit){const side=n.battle.actor[0];return options(n).map(o=>{const child=step(n,o);return{o,n:child,v:value(child,side)};}).sort((a,b)=>b.v-a.v||JSON.stringify(a.o).localeCompare(JSON.stringify(b.o))).slice(0,limit);}
 const roots=ranked(base,Math.min(7,options(base).length));let best=roots[0].o,bv=-Infinity;
 for(const candidate of roots){let n=candidate.n;for(let k=0;k<22&&!n.result;k++)n=ranked(n,1)[0].n;const v=value(n,team)*.85+candidate.v*.15;if(v>bv){bv=v;best=candidate.o;}}
 return{orders:[best]};
}

function originalAssignments(s,team){
 const r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),fs=s.fronts.filter(f=>f.team===team),g={},byRole=Object.fromEntries(me.map(h=>[h.role,h])),opened=G.openedLanes(s,team);
 const front=l=>fs.find(f=>f.lane===l),risk=(h,p)=>danger(s,h,p)/Math.max(200,h.maxHP);
 function route(h){return fs.filter(f=>!opened.includes(f.lane)).sort((a,b)=>(distance(h,a.p)*5+risk(h,a.p)*8+s.buildings.filter(b=>b.team!==team&&b.lane===a.lane).reduce((v,b)=>v+b.hp,0)*.2)-(distance(h,b.p)*5+risk(h,b.p)*8+s.buildings.filter(t=>t.team!==team&&t.lane===b.lane).reduce((v,b)=>v+b.hp,0)*.2))[0]?.lane;}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>40&&opened.includes(lane)&&opened.length<1&&h.role!=='mid')lane=route(h)||lane;g[h.id]={kind:'lane',lane,p:front(lane).p};}
 const j=byRole.jungle;
 let ancient=null;
 if(j){
  const opts=s.camps.filter(c=>c.kind==='ancient'&&(c.alive||c.spawnAt<=r+distance(j,c)+3)).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*2})).sort((a,b)=>a.v-b.v);
  ancient=opts[0]?.c;
  if(ancient)g[j.id]={kind:'ancient',p:ancient.p,id:ancient.id};
  else {
   const cs=s.camps.filter(c=>c.kind==='normal'&&(c.alive||c.spawnAt<=r+distance(j,c))).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*4})).sort((a,b)=>a.v-b.v||relativeID(team,a.c.id).localeCompare(relativeID(team,b.c.id)));
   if(cs[0])g[j.id]={kind:'camp',p:cs[0].c.p,id:cs[0].c.id};
  }
 }
 const sup=byRole.support;
 if(sup&&r>40){
  const options=me.filter(h=>h.role!=='support'&&h.role!=='jungle').map(h=>({h,v:danger(s,h,h.p)/Math.max(1,h.maxHP)*2+(1-h.hp/h.maxHP)*.5+(h.role==='mid'?.15:0)-distance(sup,h)*.07+(history.escort===h.role?.12:0)})).sort((a,b)=>b.v-a.v);
  const escort=options[0]?.h;
  if(escort){history.escort=escort.role;g[sup.id]={kind:'escort',p:escort.p,unit:escort.id,lane:g[escort.id]?.lane};}
 }
 if(ancient&&r>40){
  const remaining=ancient.alive?ancient.hp:4;
  const eta=Math.max(0,(ancient.spawnAt||r)-r)+remaining;
  const relevant=foes.filter(h=>distance(h,ancient)<=Math.min(6,eta+2));
  const enemyCount=relevant.reduce((n,h)=>n+(h.role==='jungle'?2:1),0);
  const helpers=me.filter(h=>!['jungle','adc'].includes(h.role)&&distance(h,ancient)<=6&&h.hp>h.maxHP*.45).sort((a,b)=>{
   const cost=h=>distance(h,ancient)+(h.role==='support'?-1.6:h.role==='mid'?1.8:0)+(1-h.hp/h.maxHP)*3;
   return cost(a)-cost(b);
  });
  const need=Math.max(0,Math.min(2,enemyCount-1));
  for(const h of helpers.slice(0,need))g[h.id]={kind:'ancient',p:ancient.p,id:ancient.id};
 }
 const base=s.buildings.find(b=>b.id===team+'_base'),openAgainst=G.openedLanes(s,G.enemy(team));
 if(openAgainst.length){
  const lanes=fs.filter(f=>openAgainst.includes(f.lane)).map(f=>({f,ef:s.fronts.find(e=>e.team!==team&&e.lane===f.lane),attackers:foes.filter(h=>distance(h,base)<=3&&G.PATHS[f.lane].some(p=>eq(p,h.p)))})).sort((a,b)=>b.attackers.length-a.attackers.length);
  const bad=lanes.find(x=>x.attackers.length&&distance(x.ef.p,base)<=2);
  if(bad){
   const cap=Math.max(1,bad.attackers.reduce((n,h)=>n+G.towerDamage(h,s.config),0));
   const urgency=base.hp/(cap*Math.max(1,bad.attackers.length));
   const defenders=me.filter(h=>h.role!=='adc').sort((a,b)=>{
    const cost=h=>distance(h,bad.f.p)*5-(h.role==='mid'?12:h.role==='support'?8:0)-h.hp/h.maxHP*3;
    return cost(a)-cost(b);
   });
   const needed=Math.min(defenders.length,urgency<10?3:2);
   for(const h of defenders.slice(0,needed))g[h.id]={kind:'defend',lane:bad.f.lane,p:bad.f.p};
  }
 }

 return g;
}

function qForecast(s,h,p){let damage=0;for(const e of s.heroes.filter(e=>e.alive&&e.team!==h.team&&e.role!=='support'&&e.stunUntil<s.decisionTurn+1)){if(G.canHeroAttack(e,{...h,p},s))damage+=e.damage;else if(G.neighbors(e.team,e.p).some(q=>G.canHeroAttack({...e,p:q},{...h,p},s)))damage+=e.damage*.4;}return damage;}
function qRecoveryPath(s,h,target){const nodes=G.CELLS,distances=new Map([[G.key(h.p),0]]),previous=new Map(),open=[h.p],closed=new Set();while(open.length){open.sort((a,b)=>(distances.get(G.key(a))||0)-(distances.get(G.key(b))||0));const p=open.shift(),k=G.key(p);if(closed.has(k))continue;closed.add(k);if(eq(p,target)){const out=[p];while(previous.has(G.key(out[0])))out.unshift(previous.get(G.key(out[0])));return out;}for(const q of G.neighbors(h.team,p)){const current=qIncoming(s,h,q,true),future=qForecast(s,h,q),cost=distances.get(k)+1+current/Math.max(1,h.hp)*8+future/Math.max(1,h.maxHP)*3,kk=G.key(q);if(cost<(distances.get(kk)??Infinity)){distances.set(kk,cost);previous.set(kk,p);open.push(q);}}}return null;}
function qRecoveryGoal(s,h){const choices=s.fronts.filter(f=>f.team===h.team&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane)).flatMap(f=>f.cells.map(p=>{const path=qRecoveryPath(s,h,p),danger=path?.[1]?qIncoming(s,h,path[1],true):0;return{p,lane:f.lane,path,danger,value:qIncome(s,h,p)*10/Math.max(1,path?.length||99)-qForecast(s,h,p)/Math.max(1,h.maxHP)*30-danger/Math.max(1,h.hp)*30};})).filter(x=>x.path&&x.danger<h.hp*.7).sort((a,b)=>b.value-a.value);return choices[0];}
function assignments(s,team){
 if(team!==s.you)return originalAssignments(s,team);
 const candidate=qMacro(s),native=originalAssignments(s,team),goals=s.decisionTurn<Q.start||Q.macro==='native'?native:candidate;
 qMemory.recovery||={};
 for(const h of s.heroes.filter(h=>h.alive&&h.team===team)){
  const m=qMemory.units[h.id],r=s.decisionTurn;let recovery=qMemory.recovery[h.id];
  if(recovery&&(r>recovery.until||qIncome(s,h,h.p)>0)){delete qMemory.recovery[h.id];recovery=null;}
  if(!recovery&&m?.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&r>s.config.laneLock&&!G.engagementOf(s,h)){const best=qRecoveryGoal(s,h);if(best){recovery={p:best.p,lane:best.lane,until:r+10};qMemory.recovery[h.id]=recovery;}}
  if(recovery)goals[h.id]={kind:'recover-economy',lane:recovery.lane,p:recovery.p};
  if(goals[h.id]?.lane&&!['ancient','camp','escort','recover-economy'].includes(goals[h.id].kind))goals[h.id].kind='lane';
 }
 return goals;
}
function predict(s,team,mode=0){
 const r=s.turn+1,hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team);
 return hs.map(h=>{
  const m=history.units[h.id],locked=G.engagementOf(s,h)||h.engageRecoveryUntil>=r;
  const co=combat(s,h,mode);if(h.stunUntil>=r||locked)return co;
  if(h.hp<h.maxHP*.28&&!G.threatened(s,h))return O(h,'recall');
  let lane=r<=40?G.roleLane(h.role):m?.lane||G.roleLane(h.role);lane=lane||'mid';
  const f=s.fronts.find(f=>f.team===team&&f.lane===lane);
  if(mode===1&&eq(h.p,f.p)&&m?.push>m?.attack*.65&&co.action!=='heal')return O(h,'push',{lane});
  if(co.action!=='wait')return co;
  if(h.role==='jungle'){
   const cs=s.camps.filter(c=>c.alive||c.spawnAt<=r+distance(h,c)+1).map(c=>({c,v:distance(h,c)+(c.kind==='ancient'?-5:0)+Math.max(0,(c.spawnAt||r)-r-distance(h,c))+danger(s,h,c.p)/Math.max(1,h.maxHP)*3})).sort((a,b)=>a.v-b.v);
   if(cs.length)return eq(h.p,cs[0].c.p)?cs[0].c.alive?O(h,'capture',{target:cs[0].c.id}):O(h,'wait'):travel(s,h,cs[0].c.p);
  }
  if(eq(h.p,f.p))return O(h,'push',{lane});return travel(s,h,f.p);
 });
}

function motionPrediction(s,team){
 const r=s.turn+1,defaultOrders=predict(s,team,0);
 return defaultOrders.map(o=>{
  const h=s.heroes.find(h=>h.id===o.unit),m=history.units[h.id];
  if(!m||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h)||o.action==='heal')return o;if(m.last==='wait'&&m.stationary>=2&&combat(s,h).action==='wait')return O(h,'wait');
  // A move during attack cooldown is weak evidence for retreat when the attack has just recovered.
  if(['attack','spell','reap'].includes(o.action))return o;
  const camp=s.camps.find(c=>c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'));
  if(camp&&(h.role==='jungle'||m.last==='capture'))return O(h,'capture',{target:camp.id});
  if(m.last==='move'&&m.oldP&&G.dist(m.oldP,m.p)===1){
   const next=[h.p[0]+m.p[0]-m.oldP[0],h.p[1]+m.p[1]-m.oldP[1]],f=s.fronts.find(f=>f.team===team&&f.lane===(m.lane||G.roleLane(h.role)||'mid'));
   if(G.valid(next)&&!eq(h.p,f.p)&&(!s.camps.some(c=>eq(c.p,h.p)&&c.alive)||h.role==='support')){
    if(distance(next,f.p)<distance(h,f.p)||danger(s,h,next)<danger(s,h,h.p))return O(h,'move',{to:next});
   }
  }
  if(h.hp<h.maxHP*.55&&danger(s,h,h.p)>h.hp*.55){
   const choices=localNeighbors(team,h.p).map(p=>({p,v:danger(s,h,p)+distance(p,G.FOUNTAIN[team])*h.maxHP*.025})).sort((a,b)=>a.v-b.v);
   if(choices.length&&danger(s,h,choices[0].p)<danger(s,h,h.p)*.55)return O(h,'move',{to:choices[0].p});
  }
  return o;
 });
}

// A generic best response hypothesis, using only legal public-state outcomes.
function responsePrediction(s,team,ours){
 const r=s.turn+1,gs=assignments(s,team),hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),old=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const active=h=>G.engageAllowedActions(s,h,r);
 const options=h=>{
  const a=active(h),out=[O(h,'wait')];
  if(a.includes('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(a.includes('teleport'))for(const b of G.teleportTargets(s,h,r))out.push(O(h,'teleport',{to:b.p}));
  if(a.includes('recall')&&!G.threatened(s,h)&&h.hp<h.maxHP*.85)out.push(O(h,'recall'));
  if(a.includes('push'))for(const f of s.fronts)if(f.team===team&&eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  if(a.includes('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'))out.push(O(h,'capture',{target:c.id}));
  out.push(...v2CombatOptions(s,h,foes,[ours]));
  if(a.includes('heal'))for(const t of hs)if(t.hp<t.maxHP&&G.dist(h,t)<=2||t.hp<t.maxHP&&G.sameEngagement(s,h,t))out.push(O(h,'heal',{target:t.id}));
  if(a.includes('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  return out;
 };
 let os=predict(s,team,0);
 function value(n){
  if(n.result)return n.result.winner===team?1e7:n.result.winner?-1e7:0;
  const nf=G.fronts(n);let v=0;
  for(const h of n.heroes){
   const o=old[h.id],sg=h.team===team?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sg*(h.gold-o.gold)*w*1.25;
   if(!h.alive){if(o.alive)v-=sg*(240+Math.min(r,170)+h.gold*.04)*w;continue;}
   v+=sg*h.hp/h.maxHP*(130+h.maxHP*.045)*w;
   if(h.stunUntil>=r+1)v-=sg*20*w;
   if(h.attackReady>r+1)v-=sg*5*w;
   if(h.team===team){const g=gs[h.id];let p=g.kind==='lane'||g.kind==='defend'?G.pushPosition(n,team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;
    v-=Math.max(0,distance(h,p)-(g.kind==='escort'?1:0))*(g.kind==='defend'?60:g.kind==='ancient'?27:g.kind==='camp'?19:23);
    v-=Math.max(0,danger(n,h,h.p,r+1)*1.15-h.hp)/h.maxHP*300;
   }
  }
  for(const b of n.buildings){const o=s.buildings.find(x=>x.id===b.id);v+=(b.team===team?-1.2:1)*(o.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);}
  for(const e of n.events){if(e.kind==='invalid'&&e.unit[0]===team)v-=30;if(e.kind==='ancient_progress'&&e.damage&&n.camps.find(c=>c.id===e.target).alive)v+=(e.counts[team]>e.counts[G.enemy(team)]?1:e.counts[team]<e.counts[G.enemy(team)]?-1:0)*100;}
  return v;
 }
 for(let i=0;i<hs.length;i++){
  let best=os[i],bv=-Infinity;
  for(const a of options(hs[i])){os[i]=a;const n=G.step(s,{[team]:{orders:os},[G.enemy(team)]:{orders:ours}}),v=value(n);if(v>bv+.0001){bv=v;best=a;}}
  os[i]=best;
 }
 return os;
}


// Local benchmark policy. Only public observations and self-chosen simulation seeds.
const qEq=(a,b)=>G.key(a.p||a)===G.key(b.p||b),qD=(a,b)=>G.dist(a,b),qOrder=(h,action,extra={})=>({unit:h.id,action,...extra});
let qMemory={turn:0,units:{},avoid:{},targets:{}};
const roleWeight={top:1,mid:1.35,adc:1.55,support:.9,jungle:1.15};
function qPower(h){return h.role==='support'?h.heal*.85:h.damage*.6;}
function qIncome(s,h,p,all=s.heroes){let total=0;for(const f of s.fronts.filter(f=>f.team===h.team&&f.cells.some(x=>qEq(x,p))&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane))){const members=all.filter(x=>x.alive&&x.team===h.team&&(x.id===h.id||f.cells.some(p=>qEq(x,p)))&&(s.decisionTurn>s.config.laneLock||G.roleLane(x.role)===f.lane)),den=Math.max(1,members.reduce((v,x)=>v+(x.role==='support'?.25:1),0));let n=s.config.laneGold*(h.role==='support'?.25:1)/den;if(h.role==='adc')n+=s.config.adcLaneFlat;if(h.role==='support'&&members.some(x=>x.role==='adc'))n*=1+s.config.supportWithAdcLaneBonus;total+=n;}return total;}
function qIncoming(s,h,p,readyOnly=false){return v2Incoming(s,h,p,s.decisionTurn);}
function qWalk(s,h,target){if(qEq(h,target))return qOrder(h,'wait');const route=G.pathTo(h.team,h.p,target);if(!route||route.length<2)return qOrder(h,'wait');const shortest=route.length-1,choices=G.neighbors(h.team,h.p).map(p=>({p,path:G.pathTo(h.team,p,target),risk:qIncoming(s,h,p,true)})).filter(x=>x.path&&x.path.length-1<=shortest);choices.sort((a,b)=>(a.path.length*23+Math.min(90,a.risk/Math.max(1,h.maxHP)*P.moveRisk*100))-(b.path.length*23+Math.min(90,b.risk/Math.max(1,h.maxHP)*P.moveRisk*100))||G.key(a.p).localeCompare(G.key(b.p)));return qOrder(h,'move',{to:choices[0]?.p||route[1]});}
function qMacro(s){
 const r=s.decisionTurn,team=s.you,enemy=G.enemy(team),me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),byRole=Object.fromEntries(me.map(h=>[h.role,h])),fronts=s.fronts.filter(f=>f.team===team),goals={},opened=G.openedLanes(s,team),base=s.buildings.find(b=>b.id===team+'_base');
 if(!me.length)return{};
 if(r<=qMemory.turn)qMemory={turn:0,units:{},avoid:{},targets:{}};
 for(const h of me){const m=qMemory.units[h.id]||{p:h.p,gold:h.gold,hp:h.hp,idle:0,loop:[],best:99,lastProgress:r};const productive=(s.events||[]).some(e=>(e.source===h.id&&((e.damage||e.amount||0)>0))||(e.awards||[]).some(a=>a.id===h.id&&a.amount>0)||(e.kind==='push_contest'&&(e.sources?.[team]||[]).includes(h.id)));m.idle=qEq(h.p,m.p)&&h.gold<=m.gold+1e-7&&!productive?m.idle+1:0;m.loop.push(G.key(h.p));if(m.loop.length>8)m.loop.shift();m.p=[...h.p];m.gold=h.gold;m.hp=h.hp;qMemory.units[h.id]=m;}
 qMemory.turn=r;
 const front=l=>fronts.find(f=>f.lane===l),laneCost=(h,l)=>{const f=front(l),bs=s.buildings.filter(b=>b.team!==team&&b.lane===l&&b.hp>0),enemyCount=foes.filter(e=>qD(e,f.p)<=1).length;return qD(h,f.p)*P.travel+bs.reduce((n,b)=>n+b.hp,0)*P.structureCost+enemyCount*P.crowd+(opened.includes(l)?-P.finish:0);};
 function farming(h,lane){const f=front(lane),cells=f.cells.map(p=>({p,v:qIncome(s,h,p)*P.income-qIncoming(s,h,p)/Math.max(1,h.maxHP)*16-qD(h,p)*2+(qEq(p,f.p)?2:0)})).sort((a,b)=>b.v-a.v);return{kind:'lane',lane,p:cells[0].p};}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>s.config.laneLock&&opened.includes(lane)&&opened.length<1)lane=[...G.LANES].sort((a,b)=>laneCost(h,a)-laneCost(h,b))[0];goals[h.id]=farming(h,lane);}
 const j=byRole.jungle;
 if(j){const options=s.camps.filter(c=>c.kind==='normal').map(c=>{const travel=qD(j,c),wait=c.alive?0:Math.max(0,(c.spawnAt||r)-r-travel),risk=qIncoming(s,j,c.p)/Math.max(1,j.maxHP);return{c,v:48/(travel+wait+1)-risk*P.campRisk+(c.regionTeam===team?1:0)};}).filter(x=>x.c.alive||x.c.spawnAt<=r+qD(j,x.c)+3).sort((a,b)=>b.v-a.v);if(options[0])goals[j.id]={kind:'camp',p:options[0].c.p,id:options[0].c.id};}
 if(r>s.config.laneLock){
  const clustered=G.LANES.map(l=>({lane:l,n:foes.filter(h=>qD(h,front(l).p)<=2).length})).sort((a,b)=>b.n-a.n),available=[...G.LANES].sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b));
  let primary=available[0];if(P.counter&&clustered[0].n>=3)primary=available.find(l=>l!==clustered[0].lane)||primary;
  if(P.squad>=3){const roles=P.carryLate&&r<85?['top','mid','jungle','support']:['top','mid','support','adc','jungle'];let count=0;for(const role of roles){const h=byRole[role];if(!h)continue;if(role==='jungle'&&P.jungleFarm&&r<100)continue;if(count++>=P.squad)break;goals[h.id]={kind:'push',lane:primary,p:front(primary).p};}}
  if(P.split){for(const h of me.filter(h=>h.role!=='support'&&h.role!=='jungle')){const l=G.roleLane(h.role);const best=opened.includes(l)?available.find(l=>!opened.includes(l))||available[0]:l;goals[h.id]=farming(h,best);}}
 }
 if(r>s.config.laneLock&&opened.length){const lane=opened.slice().sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b))[0],n=P.split?3:4;const group=me.slice().sort((a,b)=>qD(a,front(lane).p)-qD(b,front(lane).p)||b.gold-a.gold).slice(0,n);for(const h of group)goals[h.id]={kind:'push',lane,p:front(lane).p};}
 // Resource assignments are short commitments with observable progress and explicit fallback.
 if(j){const candidates=s.camps.filter(a=>a.kind==='ancient'&&(a.alive||Number.isFinite(a.spawnAt)&&a.spawnAt!==null&&a.spawnAt<=r+qD(j,a)+P.notice)&&(qMemory.avoid[a.id]||0)<=r).map(a=>{const travel=qD(j,a),wait=a.alive?0:Math.max(0,a.spawnAt-r-travel),hp=a.maxHP||4,pool=a.goldPool||750;return{a,v:pool*P.resource/(travel+wait+hp+2)-Math.max(0,qIncoming(s,j,a.p)/Math.max(1,j.maxHP)-.5)*50};}).sort((a,b)=>b.v-a.v);
  const a=candidates[0]?.a;if(a){const until=a.alive?0:Math.max(0,a.spawnAt-r),near=foes.filter(h=>qD(h,a)<=Math.min(4,until+(a.maxHP||4)+1)),threat=near.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),roles=me.filter(h=>h.id!==j.id&&(!P.carryLate||h.role!=='adc')).sort((a1,b1)=>(qD(a1,a)+(a1.role==='support'?-.8:0))-(qD(b1,a)+(b1.role==='support'?-.8:0))),staff=[j];
   const needed=near.length?Math.min(P.resourceSquad,Math.max(2,near.length)):1;for(const h of roles){if(staff.length>=needed)break;if(qD(h,a)<=Math.min(7,until+(a.maxHP||4)+2)&&h.hp>=h.maxHP*.4)staff.push(h);}
   const own=staff.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),key=staff.map(h=>h.id).sort().join(',')+'@'+(a.announcement?.cycle||0),target=qMemory.targets[a.id]||{key,best:99,last:r},distance=staff.reduce((n,h)=>n+qD(h,a),0),progress=(s.events||[]).some(e=>e.target===a.id&&e.kind==='ancient_progress'&&e.damage>0)||staff.some(h=>(s.events||[]).some(e=>e.source===h.id&&e.damage>0));
   if(key!==target.key||distance<target.best||progress){target.key=key;target.best=distance;target.last=r;}qMemory.targets[a.id]=target;
   if(r-target.last>P.resourcePatience){qMemory.avoid[a.id]=r+P.resourceAvoid;delete qMemory.targets[a.id];}
   else if(threat===0||own>=threat*P.resourceRatio||near.length===1&&staff.length>=2){for(const h of staff)goals[h.id]={kind:'ancient',id:a.id,p:a.p,group:staff.map(h=>h.id)};}
  }
 }
 if(byRole.support&&goals[byRole.support.id].kind==='lane'){const sup=byRole.support,carry=byRole.adc||byRole.mid||byRole.top;if(carry)goals[sup.id]={kind:'escort',unit:carry.id,p:goals[carry.id]?.p||carry.p,lane:goals[carry.id]?.lane};}
 // Only pull a mass defense toward an actual open-base push; avoid phantom fountain camping.
 const openAgainst=G.openedLanes(s,enemy),lastDamage=(s.events||[]).some(e=>e.kind==='push_damage'&&e.target===base.id&&e.damage>0),attackLanes=fronts.filter(f=>openAgainst.includes(f.lane)&&qD(f.frontP,base)<=1).map(f=>({f,n:foes.filter(h=>qEq(h.p,s.fronts.find(g=>g.team===enemy&&g.lane===f.lane).p)).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
 if(attackLanes[0]&&(lastDamage||base.hp<45||attackLanes[0].n>=3)){const {f,n}=attackLanes[0],defenders=[...me].sort((a,b)=>qD(a,f.p)-qD(b,f.p)||b.gold-a.gold).slice(0,Math.min(me.length,n+1));for(const h of defenders)goals[h.id]={kind:'defend',lane:f.lane,p:f.p};}
 // A task with no movement/income/combat progress cannot hold a hero forever.
 for(const h of me){const m=qMemory.units[h.id],g=goals[h.id];if(m.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&!G.engagementOf(s,h)&&g.kind!=='defend'){
   if(h.role==='jungle'&&r<=s.config.laneLock){const c=s.camps.filter(c=>c.kind==='normal'&&c.alive).sort((a,b)=>qD(h,a)-qD(h,b))[0];if(c)goals[h.id]={kind:'camp',id:c.id,p:c.p};}
   else{const options=fronts.filter(f=>r>s.config.laneLock||G.roleLane(h.role)===f.lane).flatMap(f=>f.cells.map(p=>({f,p,v:qIncome(s,h,p)*8/(qD(h,p)+1)-qIncoming(s,h,p)/Math.max(1,h.maxHP)*8}))).sort((a,b)=>b.v-a.v);if(options[0])goals[h.id]={kind:'recover-economy',lane:options[0].f.lane,p:options[0].p};}
  }}
 return goals;
}


function qFountainSally(s,me,foes,orders,r){
 // The fountain has a single exit. Waiting for a path with less than70% incoming
 // damage can be permanent when a siege pins every route. Choose a coordinated
 // break-out, not indefinite safety; a real base-income objective follows it.
 const stuck=me.filter(h=>eq(h.p,G.FOUNTAIN[h.team])&&qIncome(s,h,h.p)===0&&(qMemory.units[h.id]?.idle||0)>=6&&h.stunUntil<r&&h.engageRecoveryUntil<r&&!G.engagementOf(s,h));
 if(!stuck.length)return;
 const team=s.you,home=G.HOME[team],exits=G.neighbors(team,G.FOUNTAIN[team]);if(!exits.length)return;
 const exit=exits.slice().sort((a,b)=>G.dist(a,home)-G.dist(b,home))[0];
 for(let i=0;i<me.length;i++){
  const h=me[i];if(!eq(h.p,G.FOUNTAIN[team])||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h))continue;
  const target=foes.find(t=>t.id===orders[i].target),attack=['attack','reap','spell'].includes(orders[i].action)&&(orders[i].action==='spell'?orders[i].cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(orders[i].action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)));
  if(attack)continue;
  // Every available ally takes the same timing, including the healer. This is a
  // strategic commitment after six dry turns, not an extra engine command.
  orders[i]=O(h,'move',{to:exit.slice()});
  const goal=qRecoveryGoal(s,h)||s.fronts.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>({p,lane:f.lane,value:qIncome(s,h,p)/(G.dist(p,exit)+1)}))).sort((a,b)=>b.value-a.value)[0];
  if(goal)qMemory.recovery[h.id]={p:goal.p,lane:goal.lane,until:r+12};
 }
}

function macro(s){
 track(s);
 const team=s.you,enemy=G.enemy(team),r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),goals=assignments(s,team),fs=s.fronts.filter(f=>f.team===team),preds=[predict(s,enemy,0),predict(s,enemy,1),motionPrediction(s,enemy)],oldByID=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const provisional=me.map(h=>{const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;if(g.kind==='camp'||g.kind==='ancient'){const c=s.camps.find(c=>c.id===g.id);if(c?.alive&&eq(c.p,h.p))return O(h,'capture',{target:c.id});}if(g.lane&&eq(G.pushPosition(s,team,g.lane),h.p))return O(h,'push',{lane:g.lane});return travel(s,h,g.p);});
 const savedEscort=history.escort;preds.push(responsePrediction(s,enemy,provisional));history.escort=savedEscort;
 const goalP=(h,n=s)=>{const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'};if(g.kind==='lane')return G.pushPosition(n,team,g.lane);if(g.kind==='escort'){const t=n.heroes.find(x=>x.id===g.unit);if(t?.alive)return t.p;}return g.p;};
 let simCount=0;
 function value(n,orders){
  if(n.result)return n.result.winner===team?1e7:n.result.winner===enemy?-1e7:0;
  let v=0;const alive=n.heroes.filter(h=>h.alive),nf=G.fronts(n);
  for(const h of n.heroes){
   const old=oldByID[h.id],us=h.team===team,sign=us?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sign*(h.gold-old.gold)*(Q.roleMoney?w:1)*1.25;
   if(!h.alive){if(old.alive)v-=sign*(220+Math.min(170,r)+h.gold*.035)*w*Math.min(1,Math.max(1,s.config.maxTurns+1-r)/16);continue;}
   const fraction=h.hp/h.maxHP*Math.min(1,Math.max(0,s.config.maxTurns-r)/12);
   v+=sign*fraction*(110+h.maxHP*.045)*w;
   if(h.stunUntil>=n.turn+1)v-=sign*18*w;
   if(h.role==='mid'&&h.spellReady>n.turn+1)v-=sign*h.damage*.018*w;if(h.role==='adc'&&h.reapReady>n.turn+1)v-=sign*h.damage*.008*w;
   if(us){
    const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'},p=goalP(h,n),d=distance(h,p),coef=g.kind==='defend'?65:g.kind==='ancient'?30:g.kind==='camp'?19:g.kind==='escort'?12:23;
    v-=Math.max(0,d-(g.kind==='escort'?1:0))*coef;
    const nextDanger=danger(n,h,h.p,n.turn+1),support=alive.find(t=>t.role==='support'&&t.team===team&&G.engagementCanUtility(n,t,h,'heal'));
    const net=Math.max(0,nextDanger-(support&&support.stunUntil<n.turn+1?support.heal*.6:0));
    v-=net*.025*w*Math.min(1,1100/h.maxHP)*Q.risk+Math.max(0,net*1.25-h.hp)/Math.max(1,h.maxHP)*250*w;
   }
   const preferred=G.roleLane(h.role),eligible=nf.filter(f=>f.team===h.team&&f.cells.some(p=>eq(p,h.p))&&(n.turn+1>40||f.lane===preferred));
   for(const f of eligible){const members=alive.filter(a=>a.team===h.team&&f.cells.some(p=>eq(p,a.p))&&(n.turn+1>40||G.roleLane(a.role)===f.lane)),den=Math.max(1,members.reduce((v,a)=>v+(a.role==='support'?.25:1),0));let income=12*(h.role==='support'?.25:1)/den+(h.role==='adc'?s.config.adcLaneFlat:0);if(h.role==='support'&&members.some(a=>a.role==='adc'))income*=1.5;v+=sign*income*w*1.8;}
   if(us&&n.turn+1>s.config.laneLock){const bestFuture=Math.max(0,...nf.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>qIncome({...n,fronts:nf,decisionTurn:n.turn+1},h,p)/(G.dist(h,p)+1))));v+=bestFuture*Q.future;}
  }
  for(const b of n.buildings){const old=s.buildings.find(x=>x.id===b.id),sign=b.team===team?-1.2:1;v+=sign*(old.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);if(old.hp>0&&b.hp<=0)v+=sign*50;}
  for(const e of n.events){
   if(e.kind==='invalid'&&e.unit[0]===team)v-=30;
   if(e.kind==='ancient_progress'&&e.damage){const c=n.camps.find(c=>c.id===e.target);if(c.alive)v+=(e.counts[team]>e.counts[enemy]?1:e.counts[team]<e.counts[enemy]?-1:0)*120;}
  }
  return v;
 }
 function sim(orders,ps){simCount++;return G.simulate(s,{[team]:{orders},[enemy]:{orders:ps}},'public-simulation-'+r+'-'+JSON.stringify(ps));}
 const scoreCache=new Map(),predictionKeys=preds.map(ps=>JSON.stringify(ps));
 function score(orders){
  const key=JSON.stringify(orders);if(scoreCache.has(key))return scoreCache.get(key);
  const cases=new Map(),values=preds.map((ps,i)=>{const k=predictionKeys[i];if(!cases.has(k))cases.set(k,value(sim(orders,ps),orders));return cases.get(k);});
  const base=.65*(values[0]+values[1])/2+.35*Math.min(values[0],values[1]);const old=.8*base+.2*values[2];const v=.65*old+.25*values[3]+.1*Math.min(old,values[3]);scoreCache.set(key,v);return v;
 }
 const opts=me.map(h=>{
  const allowed=G.engageAllowedActions(s,h,r),out=[O(h,'wait')],has=a=>allowed.includes(a);
  if(has('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(has('teleport'))for(const t of G.teleportTargets(s,h,r))if(!eq(h.p,t.p))out.push(O(h,'teleport',{to:t.p.slice()}));
  if(has('recall')&&h.hp<h.maxHP*.85&&!G.threatened(s,h))out.push(O(h,'recall'));
  out.push(...v2CombatOptions(s,h,foes,preds));
  if(has('heal'))for(const a of me)if(a.hp<a.maxHP&&G.dist(a,h)<=2||a.hp<a.maxHP&&G.sameEngagement(s,h,a))out.push(O(h,'heal',{target:a.id}));
  if(has('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  if(has('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(c.kind==='ancient'||h.role!=='support'))out.push(O(h,'capture',{target:c.id}));
  if(has('push'))for(const f of fs)if(eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  return out;
 });
 let orders=me.map((h,i)=>{
  const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;
  if(opts[i].length===1)return opts[i][0];
  if(g.kind==='lane'){const push=opts[i].find(o=>o.action==='push'&&o.lane===g.lane);if(push)return push;}
  if(g.kind==='ancient'||g.kind==='camp'){const cap=opts[i].find(o=>o.action==='capture'&&o.target===g.id);if(cap)return cap;if(eq(h.p,g.p))return O(h,'wait');}
  return travel(s,h,goalP(h));
 });
 let best=score(orders);
 // Joint actions cross count thresholds that single-coordinate search cannot cross.
 for(const f of fs){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='push'&&o.lane===f.lane));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length);mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'push',{lane:f.lane});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 for(const c of s.camps.filter(c=>c.kind==='ancient'&&c.alive)){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='capture'&&o.target===c.id));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length);mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'capture',{target:c.id});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 const sequence=me.map((h,i)=>i).sort((a,b)=>['support','adc','mid','top','jungle'].indexOf(me[a].role)-['support','adc','mid','top','jungle'].indexOf(me[b].role));
 for(let pass=0;pass<2;pass++){let changed=false;for(const i of sequence){let chosen=orders[i];for(const o of opts[i]){const trial=orders.slice();trial[i]=o;const v=score(trial);if(v>best+.0001){chosen=o;best=v;}}if(chosen!==orders[i])changed=true;orders[i]=chosen;}if(!changed)break;}
 // Compare engaging with continuing the chosen macro orders, using actual simultaneous rules.
 const ji=me.findIndex(h=>h.role==='jungle');
 if(ji>=0&&G.engageCanCast(s,me[ji],r)){
  const centers=foes.filter(h=>G.dist(h,me[ji])<=1).map(h=>h.p).filter((p,i,a)=>a.findIndex(q=>eq(p,q))===i);
  const combatValue=n=>n.heroes.reduce((v,h)=>{const sign=h.team===team?1:-1,w=(150+h.gold*.05+(h.role==='mid'?h.damage*1.5:h.role==='support'?h.heal:h.damage*.6));return v+sign*(h.alive?w*(1+h.hp/h.maxHP):0);},0);
  function rollout(first){let n=first;for(let k=0;k<5&&n.phase==='map'&&!n.result;k++){refresh(n);const commands={A:{orders:[]},B:{orders:[]}};for(const h of n.heroes.filter(h=>h.alive)){let o=combat(n,h);if(!G.engagementOf(n,h)&&o.action==='wait'){const g=h.team===team?goals[h.id]:null;o=g?travel(n,h,g.kind==='lane'?G.pushPosition(n,team,g.lane):g.p):predict(n,h.team,0).find(o=>o.unit===h.id)||o;}commands[h.team].orders.push(o);}n=G.step(n,commands);}return combatValue(n);}
  const baseline=centers.length?rollout(sim(orders,preds[0])):0;let bv=baseline+45,bo=null;
  for(const p of centers){const preview=G.previewEngage(s,me[ji],p);if(!preview)continue;const trial=me.map((h,i)=>i===ji?O(h,'engage',{to:p.slice()}):G.engagementOf(preview,preview.heroes.find(x=>x.id===h.id))?combat(preview,preview.heroes.find(x=>x.id===h.id)):orders[i]);const n=sim(trial,preds[0]),v=rollout(n);if(v>bv){bv=v;bo=trial;}}
  if(bo)orders=bo;
 }
 if(r>40&&me.filter(h=>qMemory.units[h.id]?.idle>=2&&qIncome(s,h,h.p)===0).length>=2){
  const actionFor=(n,h)=>{const co=combat(n,h);if(co.action!=='wait')return co;const g=goals[h.id];if(!g)return O(h,'wait');if(g.kind==='camp'||g.kind==='ancient'){const c=n.camps.find(c=>c.id===g.id);if(c?.alive&&eq(h.p,c.p))return O(h,'capture',{target:c.id});if(!c?.alive){const fs=G.fronts(n).filter(f=>f.team===h.team).sort((a,b)=>G.dist(h,a.p)-G.dist(h,b.p));return eq(h.p,fs[0].p)?O(h,'push',{lane:fs[0].lane}):travel(n,h,fs[0].p);}}const p=g.kind==='lane'?G.pushPosition(n,h.team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;return g.lane&&eq(h.p,G.pushPosition(n,h.team,g.lane))?O(h,'push',{lane:g.lane}):travel(n,h,p);};
  const planned=me.map(h=>actionFor(s,h));
  function rolloutScore(first,sample){let n=G.simulate(s,{[team]:{orders:first},[enemy]:{orders:preds[sample]}},'macro-commit-'+r+'-'+sample);for(let k=0;k<Q.rollout&&!n.result&&n.phase==='map';k++){refresh(n);const commands={};commands[team]={orders:n.heroes.filter(h=>h.alive&&h.team===team).map(h=>actionFor(n,h))};commands[enemy]={orders:predict(n,enemy,sample)};n=G.step(n,commands);}return value(n,first);}
  let a=0,b=0;for(let sample=0;sample<2;sample++){a+=rolloutScore(orders,sample);b+=rolloutScore(planned,sample);}if(b>a+10)orders=planned;
 }
 for(let i=0;i<me.length;i++){const h=me[i],recovery=qMemory.recovery?.[h.id];if(!recovery||qIncome(s,h,h.p)>0||G.engagementOf(s,h)||h.stunUntil>=r||h.engageRecoveryUntil>=r)continue;const o=orders[i],target=foes.find(t=>t.id===o.target),useful=['attack','reap','spell'].includes(o.action)&&(o.action==='spell'?o.cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(o.action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)))||o.action==='heal'&&me.some(a=>a.id===o.target&&a.hp<a.maxHP-.001)||o.action==='control'&&target&&G.engagementCanUtility(s,h,target,'control');if(useful)continue;const route=qRecoveryPath(s,h,recovery.p);if(route?.length>1&&qIncoming(s,h,route[1],true)<h.hp*.7)orders[i]=O(h,'move',{to:route[1]});}
 qFountainSally(s,me,foes,orders,r);
 return{orders};
}
module.exports.decide=function(s){if(s.phase==='final_battle')return arena(s);if(s.phase!=='map'||s.result)return{orders:[]};return macro(s);};


const __decide=module.exports.decide;module.exports.decide=function(obs){for(const c of obs.camps)if(c.kind==='ancient'&&!c.alive&&c.spawnAt===null)c.spawnAt=Number.MAX_SAFE_INTEGER;return __decide(obs);};

;return module.exports;}
function makeShadow1(){const module={exports:{}};const exports=module.exports;const require=function(n){if(n==='./engine.cjs')return __G;throw new Error('Only ./engine.cjs');};
// Attribution: adapted from public hex-moba-contest policies (Sol V15 search core); new rules, skills, final solver and macro changes by this task.
'use strict';
const Q={"macro":"new","start":41,"future":4,"risk":1.05,"rollout":6,"roleMoney":false,"speculate":false},P={"travel":3,"structureCost":0.22,"crowd":8,"finish":95,"income":2,"moveRisk":0.7,"campRisk":8,"squad":2,"split":false,"counter":false,"carryLate":true,"jungleFarm":true,"resource":1.65,"notice":5,"resourceSquad":4,"resourceRatio":0.85,"resourcePatience":5,"resourceAvoid":9,"idleLimit":4,"recall":0.3,"pushRisk":1,"engageRatio":1.05,"id":"resource_v2"};
'use strict';
// Sol V15 entrant v3. Reuses public policies/sol_ref.cjs (frozen-sol-v7).
// Changes: resource staffing, cooperative push/capture, expected tied rewards, proactive defense.
const G=require('./engine.cjs');
const PLAN={"mode":"split","rotate":40,"jungle":"farm","primary":"bottom","dynamicLane":false,"routeHP":0.4,"routeDistance":4,"routeThreat":0.02,"campRisk":6,"invade":0,"anticipate":3,"ancientRisk":2,"ancientHelp":[],"helpRange":4,"helpThreat":1,"rotateOpened":true,"reactCluster":[],"defend":true,"defendHP":18,"gold":1.0,"hp":1.0,"death":1.0,"position":1.2,"tower":3.5,"base":1.5,"ancient":1.0,"income":1.0,"passes":2};
const relativeID=(team,id)=>team==='A'?id:id.replace(/^[AB]_/,m=>m==='A_'?'B_':'A_');
const localNeighbors=(team,p)=>G.neighbors('A',team==='A'?p:p.map(v=>-v)).map(q=>team==='A'?q:q.map(v=>-v));
const K=p=>p.join(','), eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const cells=G.CELLS, ix=new Map(cells.map((p,i)=>[K(p),i]));
const adj=cells.map(p=>G.neighbors('A',p).map(q=>ix.get(K(q))));
const terrain=cells.map(p=>G.isLane(p));
const dd=cells.map((p,i)=>{const d=Array(cells.length).fill(99),q=[i];d[i]=0;for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(d[j]===99){d[j]=d[q[n]]+1;q.push(j);}return d;});
const distance=(a,b)=>dd[ix.get(K(a.p||a))][ix.get(K(b.p||b))];
const canHit=(a,b)=>G.dist(a,b)<=1&&(terrain[ix.get(K(a.p||a))]||!terrain[ix.get(K(b.p||b))]);
const order=(h,action,extra)=>({unit:h.id,action,...extra});
const valueRole={top:1,mid:1.35,adc:1.5,support:1,jungle:1.12};

// Fixed-order final arena, explicit adversarial prefix and several continuation policies.
/* Final solver and tactics are defined below. */
let history={turn:0,units:{},escort:null};
const O=(h,action,more={})=>({unit:h.id,action,...more});
function refresh(s){s.decisionTurn=s.turn+1;s.fronts=G.fronts(s);for(const h of s.heroes)Object.assign(h,G.stats(h,s.config));return s;}
function track(s){
 if(s.decisionTurn<=history.turn)history={turn:0,units:{},escort:null};
 for(const h of s.heroes.filter(h=>h.team!==s.you)){
  const m=history.units[h.id]||{lane:G.roleLane(h.role),last:'move',push:0,attack:0,capture:0,engage:0};
  for(const k of ['push','attack','capture','engage'])m[k]*=.96;
  for(const e of s.events||[]){
   let a=null;
   if(e.kind==='push_contest'&&(e.sources?.[h.team]||[]).includes(h.id)){a='push';m.lane=e.lane;}
   if(e.kind==='ancient_progress'&&e.sources.includes(h.id))a='capture';
   if(e.source===h.id||e.unit===h.id){
    if(e.kind==='hit')a=e.attackType==='capture'?'capture':'attack';
    if(['aoe','engage_aoe','spell','reap'].includes(e.kind))a='attack';
    if(['move','teleport','recall','heal','control'].includes(e.kind))a=e.kind;
    if(e.kind==='engage_cast')a='engage';
   }
   if(a){m.last=a;if(m[a]!==undefined)m[a]++;}
  }
  const f=s.fronts.filter(f=>f.team===h.team).sort((a,b)=>distance(h,a.p)-distance(h,b.p));
  if(s.decisionTurn>40&&m.last==='move'&&distance(h,f[0].p)<2)m.lane=f[0].lane;
  m.stationary=m.p&&eq(m.p,h.p)?(m.stationary||0)+1:0;if(m.stationary>=2&&!(s.events||[]).some(e=>(e.unit===h.id||e.source===h.id)&&['move','teleport','recall','hit','heal','control','engage_cast'].includes(e.kind)))m.last='wait';m.oldP=m.p;m.p=h.p.slice();history.units[h.id]=m;
 }
 history.turn=s.decisionTurn;
}
function danger(s,h,p,r=s.turn+1){return v2Incoming(s,h,p,r);}
function travel(s,h,p){
 if(eq(h.p,p))return O(h,'wait');
 const ns=localNeighbors(h.team,h.p);ns.sort((a,b)=>distance(a,p)-distance(b,p)||danger(s,h,a)-danger(s,h,b)||K(h.team==='A'?a:a.map(v=>-v)).localeCompare(K(h.team==='A'?b:b.map(v=>-v))));
 return ns.length?O(h,'move',{to:ns[0]}):O(h,'wait');
}
// New-version tactics. Shared by the three documented baseline families.
function v2CombatOptions(s,h,foes,predicted=[]){
 const r=s.turn+1,a=G.engageAllowedActions(s,h,r),out=[];if(Q.speculate===false)predicted=[];
 if(a.includes('attack'))for(const t of foes)if(G.canHeroAttack(h,t,s)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canHeroAttack(h,{...t,p:o.to},s))))out.push(O(h,'attack',{target:t.id}));
 if(a.includes('reap'))for(const t of foes)if(G.canReap(s,h,t)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canReap(s,h,{...t,p:o.to}))))out.push(O(h,'reap',{target:t.id}));
 if(a.includes('spell'))for(const cells of G.spellTargets(s,h))if(foes.some(t=>cells.some(p=>eq(p,t.p)))||predicted.some(os=>os.some(o=>o.unit[0]!==h.team&&o.action==='move'&&cells.some(p=>eq(p,o.to)))))out.push(O(h,'spell',{cells}));
 return out;
}
function v2Incoming(s,h,p,r=s.turn+1){
 let sum=0;
 for(const t of s.heroes.filter(t=>t.alive&&t.team!==h.team&&t.role!=='support'&&t.stunUntil<r)){
  const victim={...h,p},basic=G.canHeroAttack(t,victim,s)?t.damage:0;
  const reap=t.role==='adc'&&t.reapReady<=r&&G.canReap(s,t,victim)?Math.floor(t.damage*s.config.reapMultiplier):0;
  const spell=t.role==='mid'&&t.spellReady<=r&&G.spellTargets(s,t).some(cells=>cells.some(q=>eq(q,p)))?t.damage:0;
  sum+=Math.max(basic,reap,spell);
 }
 return sum;
}
function combat(s,h,mode=0){
 const r=s.turn+1,all=s.heroes.filter(x=>x.alive&&x.team===h.team),foes=s.heroes.filter(x=>x.alive&&x.team!==h.team),wait=O(h,'wait'),allowed=G.engageAllowedActions(s,h,r);
 if(!h.alive||h.stunUntil>=r)return wait;
 if(h.engageRecoveryUntil>=r){if(allowed.includes('recall')&&h.hp<h.maxHP*.6&&!G.threatened(s,h))return O(h,'recall');return wait;}
 const threat=t=>t.role==='support'?t.heal*1.4:t.damage*(t.role==='mid'?1.4:t.role==='adc'?1.18:1);
 const harm=(t,power)=>Math.min(power,t.hp)*(.5+threat(t)/Math.max(100,t.maxHP))+(t.hp<=power?280+threat(t)*1.5+t.gold*.04:0);
 let best=wait,bv=0;
 if(h.role==='support'){
  for(const t of all)if(G.engagementCanUtility(s,h,t,'heal')){const n=Math.min(h.heal,t.maxHP-t.hp),danger=v2Incoming(s,t,t.p,r),v=n*(.8+(t.role==='mid'?.35:t.role==='adc'?.3:0))+(t.hp<=danger&&t.hp+n>danger?200+threat(t):0);if(v>bv){bv=v;best=O(h,'heal',{target:t.id});}}
  if(allowed.includes('control'))for(const t of foes)if(t.stunUntil<r+1&&G.engagementCanUtility(s,h,t,'control')){const v=threat(t)*.9;if(v>bv){bv=v;best=O(h,'control',{target:t.id});}}
  return bv>5?best:wait;
 }
 for(const o of v2CombatOptions(s,h,foes)){
  let v=0;
  if(o.action==='spell'){const targets=foes.filter(t=>o.cells.some(p=>eq(p,t.p)));v=targets.reduce((n,t)=>n+harm(t,h.damage),0)-h.damage*.12;}
  else{const t=foes.find(t=>t.id===o.target),power=o.action==='reap'?Math.floor(h.damage*s.config.reapMultiplier):h.damage;v=harm(t,power)-(o.action==='reap'&&t.hp>power?h.damage*.08:0);if(mode===1)v+=power/(1+t.hp/Math.max(1,power));}
  if(v>bv){bv=v;best=o;}
 }
 return best;
}

// Final combat uses the actual new engine, not the old forced-mid-wait approximation.
function arena(s){
 const d=s.finalDecision;if(!d||d.team!==s.you)return{orders:[]};const actor=s.heroes.find(h=>h.id===d.actor);
 if(d.forcedWait)return{orders:[O(actor,'wait')]};
 const team=s.you,opp=G.enemy(team),base={phase:'final_battle',turn:s.turn,mapTurn:s.mapTurn,version:s.version,config:s.config,heroes:G.clone(s.heroes),battle:G.clone(s.battle),teams:G.clone(s.teams),events:[],orders:{A:[],B:[]},result:null};
 function options(n){
  const dd=G.finalDecision(n),h=n.heroes.find(x=>x.id===dd.actor),friends=n.heroes.filter(x=>x.alive&&x.team===h.team),foes=n.heroes.filter(x=>x.alive&&x.team!==h.team),out=[];
  if(dd.forcedWait)return[O(h,'wait')];
  for(const a of dd.legalActions){if(a==='spell')out.push(O(h,'spell'));else if(a==='attack'||a==='reap'||a==='control'){for(const t of foes)if(a!=='control'||!n.battle.skip[t.id])out.push(O(h,a,{target:t.id}));}else if(a==='heal'){for(const t of friends)if(t.hp<t.maxHP)out.push(O(h,'heal',{target:t.id}));}}
  return out.length?out:[O(h,'wait')];
 }
 function value(n,side){
  if(n.result)return n.result.winner===side?1e8:-1e8;
  let v=0;
  for(const h of n.heroes){const sign=h.team===side?1:-1,p=h.role==='support'?h.heal*1.35:h.damage*(h.role==='mid'?1.5:h.role==='adc'?1.12:1),w=150+p*.8+h.gold*.035;
   if(h.alive){v+=sign*(w*(.55+h.hp/h.maxHP*.45)+Math.sqrt(h.hp)*.5);if(n.battle.skip[h.id])v-=sign*p*.35;}}
  return v;
 }
 function step(n,o){return G.stepFinalBattle(n,{[o.unit[0]]:{orders:[o]}});}
 function ranked(n,limit){const side=n.battle.actor[0];return options(n).map(o=>{const child=step(n,o);return{o,n:child,v:value(child,side)};}).sort((a,b)=>b.v-a.v||JSON.stringify(a.o).localeCompare(JSON.stringify(b.o))).slice(0,limit);}
 const roots=ranked(base,Math.min(7,options(base).length));let best=roots[0].o,bv=-Infinity;
 for(const candidate of roots){let n=candidate.n;for(let k=0;k<22&&!n.result;k++)n=ranked(n,1)[0].n;const v=value(n,team)*.85+candidate.v*.15;if(v>bv){bv=v;best=candidate.o;}}
 return{orders:[best]};
}

function originalAssignments(s,team){
 const r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),fs=s.fronts.filter(f=>f.team===team),g={},byRole=Object.fromEntries(me.map(h=>[h.role,h])),opened=G.openedLanes(s,team);
 const front=l=>fs.find(f=>f.lane===l),risk=(h,p)=>danger(s,h,p)/Math.max(200,h.maxHP);
 function route(h){return fs.filter(f=>!opened.includes(f.lane)).sort((a,b)=>(distance(h,a.p)*5+risk(h,a.p)*8+s.buildings.filter(b=>b.team!==team&&b.lane===a.lane).reduce((v,b)=>v+b.hp,0)*.2)-(distance(h,b.p)*5+risk(h,b.p)*8+s.buildings.filter(t=>t.team!==team&&t.lane===b.lane).reduce((v,b)=>v+b.hp,0)*.2))[0]?.lane;}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>40&&opened.includes(lane)&&opened.length<1&&h.role!=='mid')lane=route(h)||lane;g[h.id]={kind:'lane',lane,p:front(lane).p};}
 const j=byRole.jungle;
 let ancient=null;
 if(j){
  const opts=s.camps.filter(c=>c.kind==='ancient'&&(c.alive||c.spawnAt<=r+distance(j,c)+3)).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*2})).sort((a,b)=>a.v-b.v);
  ancient=opts[0]?.c;
  if(ancient)g[j.id]={kind:'ancient',p:ancient.p,id:ancient.id};
  else {
   const cs=s.camps.filter(c=>c.kind==='normal'&&(c.alive||c.spawnAt<=r+distance(j,c))).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*4})).sort((a,b)=>a.v-b.v||relativeID(team,a.c.id).localeCompare(relativeID(team,b.c.id)));
   if(cs[0])g[j.id]={kind:'camp',p:cs[0].c.p,id:cs[0].c.id};
  }
 }
 const sup=byRole.support;
 if(sup&&r>40){
  const options=me.filter(h=>h.role!=='support'&&h.role!=='jungle').map(h=>({h,v:danger(s,h,h.p)/Math.max(1,h.maxHP)*2+(1-h.hp/h.maxHP)*.5+(h.role==='mid'?.15:0)-distance(sup,h)*.07+(history.escort===h.role?.12:0)})).sort((a,b)=>b.v-a.v);
  const escort=options[0]?.h;
  if(escort){history.escort=escort.role;g[sup.id]={kind:'escort',p:escort.p,unit:escort.id,lane:g[escort.id]?.lane};}
 }
 if(ancient&&r>40){
  const remaining=ancient.alive?ancient.hp:4;
  const eta=Math.max(0,(ancient.spawnAt||r)-r)+remaining;
  const relevant=foes.filter(h=>distance(h,ancient)<=Math.min(6,eta+2));
  const enemyCount=relevant.reduce((n,h)=>n+(h.role==='jungle'?2:1),0);
  const helpers=me.filter(h=>!['jungle','adc'].includes(h.role)&&distance(h,ancient)<=6&&h.hp>h.maxHP*.45).sort((a,b)=>{
   const cost=h=>distance(h,ancient)+(h.role==='support'?-1.6:h.role==='mid'?1.8:0)+(1-h.hp/h.maxHP)*3;
   return cost(a)-cost(b);
  });
  const need=Math.max(0,Math.min(2,enemyCount-1));
  for(const h of helpers.slice(0,need))g[h.id]={kind:'ancient',p:ancient.p,id:ancient.id};
 }
 const base=s.buildings.find(b=>b.id===team+'_base'),openAgainst=G.openedLanes(s,G.enemy(team));
 if(openAgainst.length){
  const lanes=fs.filter(f=>openAgainst.includes(f.lane)).map(f=>({f,ef:s.fronts.find(e=>e.team!==team&&e.lane===f.lane),attackers:foes.filter(h=>distance(h,base)<=3&&G.PATHS[f.lane].some(p=>eq(p,h.p)))})).sort((a,b)=>b.attackers.length-a.attackers.length);
  const bad=lanes.find(x=>x.attackers.length&&distance(x.ef.p,base)<=2);
  if(bad){
   const cap=Math.max(1,bad.attackers.reduce((n,h)=>n+G.towerDamage(h,s.config),0));
   const urgency=base.hp/(cap*Math.max(1,bad.attackers.length));
   const defenders=me.filter(h=>h.role!=='adc').sort((a,b)=>{
    const cost=h=>distance(h,bad.f.p)*5-(h.role==='mid'?12:h.role==='support'?8:0)-h.hp/h.maxHP*3;
    return cost(a)-cost(b);
   });
   const needed=Math.min(defenders.length,urgency<10?3:2);
   for(const h of defenders.slice(0,needed))g[h.id]={kind:'defend',lane:bad.f.lane,p:bad.f.p};
  }
 }

 return g;
}

function qForecast(s,h,p){let damage=0;for(const e of s.heroes.filter(e=>e.alive&&e.team!==h.team&&e.role!=='support'&&e.stunUntil<s.decisionTurn+1)){if(G.canHeroAttack(e,{...h,p},s))damage+=e.damage;else if(G.neighbors(e.team,e.p).some(q=>G.canHeroAttack({...e,p:q},{...h,p},s)))damage+=e.damage*.4;}return damage;}
function qRecoveryPath(s,h,target){const nodes=G.CELLS,distances=new Map([[G.key(h.p),0]]),previous=new Map(),open=[h.p],closed=new Set();while(open.length){open.sort((a,b)=>(distances.get(G.key(a))||0)-(distances.get(G.key(b))||0));const p=open.shift(),k=G.key(p);if(closed.has(k))continue;closed.add(k);if(eq(p,target)){const out=[p];while(previous.has(G.key(out[0])))out.unshift(previous.get(G.key(out[0])));return out;}for(const q of G.neighbors(h.team,p)){const current=qIncoming(s,h,q,true),future=qForecast(s,h,q),cost=distances.get(k)+1+current/Math.max(1,h.hp)*8+future/Math.max(1,h.maxHP)*3,kk=G.key(q);if(cost<(distances.get(kk)??Infinity)){distances.set(kk,cost);previous.set(kk,p);open.push(q);}}}return null;}
function qRecoveryGoal(s,h){const choices=s.fronts.filter(f=>f.team===h.team&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane)).flatMap(f=>f.cells.map(p=>{const path=qRecoveryPath(s,h,p),danger=path?.[1]?qIncoming(s,h,path[1],true):0;return{p,lane:f.lane,path,danger,value:qIncome(s,h,p)*10/Math.max(1,path?.length||99)-qForecast(s,h,p)/Math.max(1,h.maxHP)*30-danger/Math.max(1,h.hp)*30};})).filter(x=>x.path&&x.danger<h.hp*.7).sort((a,b)=>b.value-a.value);return choices[0];}
function assignments(s,team){
 if(team!==s.you)return originalAssignments(s,team);
 const candidate=qMacro(s),native=originalAssignments(s,team),goals=s.decisionTurn<Q.start||Q.macro==='native'?native:candidate;
 qMemory.recovery||={};
 for(const h of s.heroes.filter(h=>h.alive&&h.team===team)){
  const m=qMemory.units[h.id],r=s.decisionTurn;let recovery=qMemory.recovery[h.id];
  if(recovery&&(r>recovery.until||qIncome(s,h,h.p)>0)){delete qMemory.recovery[h.id];recovery=null;}
  if(!recovery&&m?.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&r>s.config.laneLock&&!G.engagementOf(s,h)){const best=qRecoveryGoal(s,h);if(best){recovery={p:best.p,lane:best.lane,until:r+10};qMemory.recovery[h.id]=recovery;}}
  if(recovery)goals[h.id]={kind:'recover-economy',lane:recovery.lane,p:recovery.p};
  if(goals[h.id]?.lane&&!['ancient','camp','escort','recover-economy'].includes(goals[h.id].kind))goals[h.id].kind='lane';
 }
 return goals;
}
function predict(s,team,mode=0){
 const r=s.turn+1,hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team);
 return hs.map(h=>{
  const m=history.units[h.id],locked=G.engagementOf(s,h)||h.engageRecoveryUntil>=r;
  const co=combat(s,h,mode);if(h.stunUntil>=r||locked)return co;
  if(h.hp<h.maxHP*.28&&!G.threatened(s,h))return O(h,'recall');
  let lane=r<=40?G.roleLane(h.role):m?.lane||G.roleLane(h.role);lane=lane||'mid';
  const f=s.fronts.find(f=>f.team===team&&f.lane===lane);
  if(mode===1&&eq(h.p,f.p)&&m?.push>m?.attack*.65&&co.action!=='heal')return O(h,'push',{lane});
  if(co.action!=='wait')return co;
  if(h.role==='jungle'){
   const cs=s.camps.filter(c=>c.alive||c.spawnAt<=r+distance(h,c)+1).map(c=>({c,v:distance(h,c)+(c.kind==='ancient'?-5:0)+Math.max(0,(c.spawnAt||r)-r-distance(h,c))+danger(s,h,c.p)/Math.max(1,h.maxHP)*3})).sort((a,b)=>a.v-b.v);
   if(cs.length)return eq(h.p,cs[0].c.p)?cs[0].c.alive?O(h,'capture',{target:cs[0].c.id}):O(h,'wait'):travel(s,h,cs[0].c.p);
  }
  if(eq(h.p,f.p))return O(h,'push',{lane});return travel(s,h,f.p);
 });
}

function motionPrediction(s,team){
 const r=s.turn+1,defaultOrders=predict(s,team,0);
 return defaultOrders.map(o=>{
  const h=s.heroes.find(h=>h.id===o.unit),m=history.units[h.id];
  if(!m||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h)||o.action==='heal')return o;if(m.last==='wait'&&m.stationary>=2&&combat(s,h).action==='wait')return O(h,'wait');
  // A move during attack cooldown is weak evidence for retreat when the attack has just recovered.
  if(['attack','spell','reap'].includes(o.action))return o;
  const camp=s.camps.find(c=>c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'));
  if(camp&&(h.role==='jungle'||m.last==='capture'))return O(h,'capture',{target:camp.id});
  if(m.last==='move'&&m.oldP&&G.dist(m.oldP,m.p)===1){
   const next=[h.p[0]+m.p[0]-m.oldP[0],h.p[1]+m.p[1]-m.oldP[1]],f=s.fronts.find(f=>f.team===team&&f.lane===(m.lane||G.roleLane(h.role)||'mid'));
   if(G.valid(next)&&!eq(h.p,f.p)&&(!s.camps.some(c=>eq(c.p,h.p)&&c.alive)||h.role==='support')){
    if(distance(next,f.p)<distance(h,f.p)||danger(s,h,next)<danger(s,h,h.p))return O(h,'move',{to:next});
   }
  }
  if(h.hp<h.maxHP*.55&&danger(s,h,h.p)>h.hp*.55){
   const choices=localNeighbors(team,h.p).map(p=>({p,v:danger(s,h,p)+distance(p,G.FOUNTAIN[team])*h.maxHP*.025})).sort((a,b)=>a.v-b.v);
   if(choices.length&&danger(s,h,choices[0].p)<danger(s,h,h.p)*.55)return O(h,'move',{to:choices[0].p});
  }
  return o;
 });
}

// A generic best response hypothesis, using only legal public-state outcomes.
function responsePrediction(s,team,ours){
 const r=s.turn+1,gs=assignments(s,team),hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),old=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const active=h=>G.engageAllowedActions(s,h,r);
 const options=h=>{
  const a=active(h),out=[O(h,'wait')];
  if(a.includes('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(a.includes('teleport'))for(const b of G.teleportTargets(s,h,r))out.push(O(h,'teleport',{to:b.p}));
  if(a.includes('recall')&&!G.threatened(s,h)&&h.hp<h.maxHP*.85)out.push(O(h,'recall'));
  if(a.includes('push'))for(const f of s.fronts)if(f.team===team&&eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  if(a.includes('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'))out.push(O(h,'capture',{target:c.id}));
  out.push(...v2CombatOptions(s,h,foes,[ours]));
  if(a.includes('heal'))for(const t of hs)if(t.hp<t.maxHP&&G.dist(h,t)<=2||t.hp<t.maxHP&&G.sameEngagement(s,h,t))out.push(O(h,'heal',{target:t.id}));
  if(a.includes('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  return out;
 };
 let os=predict(s,team,0);
 function value(n){
  if(n.result)return n.result.winner===team?1e7:n.result.winner?-1e7:0;
  const nf=G.fronts(n);let v=0;
  for(const h of n.heroes){
   const o=old[h.id],sg=h.team===team?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sg*(h.gold-o.gold)*w*1.25;
   if(!h.alive){if(o.alive)v-=sg*(240+Math.min(r,170)+h.gold*.04)*w;continue;}
   v+=sg*h.hp/h.maxHP*(130+h.maxHP*.045)*w;
   if(h.stunUntil>=r+1)v-=sg*20*w;
   if(h.attackReady>r+1)v-=sg*5*w;
   if(h.team===team){const g=gs[h.id];let p=g.kind==='lane'||g.kind==='defend'?G.pushPosition(n,team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;
    v-=Math.max(0,distance(h,p)-(g.kind==='escort'?1:0))*(g.kind==='defend'?60:g.kind==='ancient'?27:g.kind==='camp'?19:23);
    v-=Math.max(0,danger(n,h,h.p,r+1)*1.15-h.hp)/h.maxHP*300;
   }
  }
  for(const b of n.buildings){const o=s.buildings.find(x=>x.id===b.id);v+=(b.team===team?-1.2:1)*(o.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);}
  for(const e of n.events){if(e.kind==='invalid'&&e.unit[0]===team)v-=30;if(e.kind==='ancient_progress'&&e.damage&&n.camps.find(c=>c.id===e.target).alive)v+=(e.counts[team]>e.counts[G.enemy(team)]?1:e.counts[team]<e.counts[G.enemy(team)]?-1:0)*100;}
  return v;
 }
 for(let i=0;i<hs.length;i++){
  let best=os[i],bv=-Infinity;
  for(const a of options(hs[i])){os[i]=a;const n=G.step(s,{[team]:{orders:os},[G.enemy(team)]:{orders:ours}}),v=value(n);if(v>bv+.0001){bv=v;best=a;}}
  os[i]=best;
 }
 return os;
}


// Local benchmark policy. Only public observations and self-chosen simulation seeds.
const qEq=(a,b)=>G.key(a.p||a)===G.key(b.p||b),qD=(a,b)=>G.dist(a,b),qOrder=(h,action,extra={})=>({unit:h.id,action,...extra});
let qMemory={turn:0,units:{},avoid:{},targets:{}};
const roleWeight={top:1,mid:1.35,adc:1.55,support:.9,jungle:1.15};
function qPower(h){return h.role==='support'?h.heal*.85:h.damage*.6;}
function qIncome(s,h,p,all=s.heroes){let total=0;for(const f of s.fronts.filter(f=>f.team===h.team&&f.cells.some(x=>qEq(x,p))&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane))){const members=all.filter(x=>x.alive&&x.team===h.team&&(x.id===h.id||f.cells.some(p=>qEq(x,p)))&&(s.decisionTurn>s.config.laneLock||G.roleLane(x.role)===f.lane)),den=Math.max(1,members.reduce((v,x)=>v+(x.role==='support'?.25:1),0));let n=s.config.laneGold*(h.role==='support'?.25:1)/den;if(h.role==='adc')n+=s.config.adcLaneFlat;if(h.role==='support'&&members.some(x=>x.role==='adc'))n*=1+s.config.supportWithAdcLaneBonus;total+=n;}return total;}
function qIncoming(s,h,p,readyOnly=false){return v2Incoming(s,h,p,s.decisionTurn);}
function qWalk(s,h,target){if(qEq(h,target))return qOrder(h,'wait');const route=G.pathTo(h.team,h.p,target);if(!route||route.length<2)return qOrder(h,'wait');const shortest=route.length-1,choices=G.neighbors(h.team,h.p).map(p=>({p,path:G.pathTo(h.team,p,target),risk:qIncoming(s,h,p,true)})).filter(x=>x.path&&x.path.length-1<=shortest);choices.sort((a,b)=>(a.path.length*23+Math.min(90,a.risk/Math.max(1,h.maxHP)*P.moveRisk*100))-(b.path.length*23+Math.min(90,b.risk/Math.max(1,h.maxHP)*P.moveRisk*100))||G.key(a.p).localeCompare(G.key(b.p)));return qOrder(h,'move',{to:choices[0]?.p||route[1]});}
function qMacro(s){
 const r=s.decisionTurn,team=s.you,enemy=G.enemy(team),me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),byRole=Object.fromEntries(me.map(h=>[h.role,h])),fronts=s.fronts.filter(f=>f.team===team),goals={},opened=G.openedLanes(s,team),base=s.buildings.find(b=>b.id===team+'_base');
 if(!me.length)return{};
 if(r<=qMemory.turn)qMemory={turn:0,units:{},avoid:{},targets:{}};
 for(const h of me){const m=qMemory.units[h.id]||{p:h.p,gold:h.gold,hp:h.hp,idle:0,loop:[],best:99,lastProgress:r};const productive=(s.events||[]).some(e=>(e.source===h.id&&((e.damage||e.amount||0)>0))||(e.awards||[]).some(a=>a.id===h.id&&a.amount>0)||(e.kind==='push_contest'&&(e.sources?.[team]||[]).includes(h.id)));m.idle=qEq(h.p,m.p)&&h.gold<=m.gold+1e-7&&!productive?m.idle+1:0;m.loop.push(G.key(h.p));if(m.loop.length>8)m.loop.shift();m.p=[...h.p];m.gold=h.gold;m.hp=h.hp;qMemory.units[h.id]=m;}
 qMemory.turn=r;
 const front=l=>fronts.find(f=>f.lane===l),laneCost=(h,l)=>{const f=front(l),bs=s.buildings.filter(b=>b.team!==team&&b.lane===l&&b.hp>0),enemyCount=foes.filter(e=>qD(e,f.p)<=1).length;return qD(h,f.p)*P.travel+bs.reduce((n,b)=>n+b.hp,0)*P.structureCost+enemyCount*P.crowd+(opened.includes(l)?-P.finish:0);};
 function farming(h,lane){const f=front(lane),cells=f.cells.map(p=>({p,v:qIncome(s,h,p)*P.income-qIncoming(s,h,p)/Math.max(1,h.maxHP)*16-qD(h,p)*2+(qEq(p,f.p)?2:0)})).sort((a,b)=>b.v-a.v);return{kind:'lane',lane,p:cells[0].p};}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>s.config.laneLock&&opened.includes(lane)&&opened.length<1)lane=[...G.LANES].sort((a,b)=>laneCost(h,a)-laneCost(h,b))[0];goals[h.id]=farming(h,lane);}
 const j=byRole.jungle;
 if(j){const options=s.camps.filter(c=>c.kind==='normal').map(c=>{const travel=qD(j,c),wait=c.alive?0:Math.max(0,(c.spawnAt||r)-r-travel),risk=qIncoming(s,j,c.p)/Math.max(1,j.maxHP);return{c,v:48/(travel+wait+1)-risk*P.campRisk+(c.regionTeam===team?1:0)};}).filter(x=>x.c.alive||x.c.spawnAt<=r+qD(j,x.c)+3).sort((a,b)=>b.v-a.v);if(options[0])goals[j.id]={kind:'camp',p:options[0].c.p,id:options[0].c.id};}
 if(r>s.config.laneLock){
  const clustered=G.LANES.map(l=>({lane:l,n:foes.filter(h=>qD(h,front(l).p)<=2).length})).sort((a,b)=>b.n-a.n),available=[...G.LANES].sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b));
  let primary=available[0];if(P.counter&&clustered[0].n>=3)primary=available.find(l=>l!==clustered[0].lane)||primary;
  if(P.squad>=3){const roles=P.carryLate&&r<85?['top','mid','jungle','support']:['top','mid','support','adc','jungle'];let count=0;for(const role of roles){const h=byRole[role];if(!h)continue;if(role==='jungle'&&P.jungleFarm&&r<100)continue;if(count++>=P.squad)break;goals[h.id]={kind:'push',lane:primary,p:front(primary).p};}}
  if(P.split){for(const h of me.filter(h=>h.role!=='support'&&h.role!=='jungle')){const l=G.roleLane(h.role);const best=opened.includes(l)?available.find(l=>!opened.includes(l))||available[0]:l;goals[h.id]=farming(h,best);}}
 }
 if(r>s.config.laneLock&&opened.length){const lane=opened.slice().sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b))[0],n=P.split?3:4;const group=me.slice().sort((a,b)=>qD(a,front(lane).p)-qD(b,front(lane).p)||b.gold-a.gold).slice(0,n);for(const h of group)goals[h.id]={kind:'push',lane,p:front(lane).p};}
 // Resource assignments are short commitments with observable progress and explicit fallback.
 if(j){const candidates=s.camps.filter(a=>a.kind==='ancient'&&(a.alive||Number.isFinite(a.spawnAt)&&a.spawnAt!==null&&a.spawnAt<=r+qD(j,a)+P.notice)&&(qMemory.avoid[a.id]||0)<=r).map(a=>{const travel=qD(j,a),wait=a.alive?0:Math.max(0,a.spawnAt-r-travel),hp=a.maxHP||4,pool=a.goldPool||750;return{a,v:pool*P.resource/(travel+wait+hp+2)-Math.max(0,qIncoming(s,j,a.p)/Math.max(1,j.maxHP)-.5)*50};}).sort((a,b)=>b.v-a.v);
  const a=candidates[0]?.a;if(a){const until=a.alive?0:Math.max(0,a.spawnAt-r),near=foes.filter(h=>qD(h,a)<=Math.min(4,until+(a.maxHP||4)+1)),threat=near.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),roles=me.filter(h=>h.id!==j.id&&(!P.carryLate||h.role!=='adc')).sort((a1,b1)=>(qD(a1,a)+(a1.role==='support'?-.8:0))-(qD(b1,a)+(b1.role==='support'?-.8:0))),staff=[j];
   const needed=near.length?Math.min(P.resourceSquad,Math.max(2,near.length)):1;for(const h of roles){if(staff.length>=needed)break;if(qD(h,a)<=Math.min(7,until+(a.maxHP||4)+2)&&h.hp>=h.maxHP*.4)staff.push(h);}
   const own=staff.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),key=staff.map(h=>h.id).sort().join(',')+'@'+(a.announcement?.cycle||0),target=qMemory.targets[a.id]||{key,best:99,last:r},distance=staff.reduce((n,h)=>n+qD(h,a),0),progress=(s.events||[]).some(e=>e.target===a.id&&e.kind==='ancient_progress'&&e.damage>0)||staff.some(h=>(s.events||[]).some(e=>e.source===h.id&&e.damage>0));
   if(key!==target.key||distance<target.best||progress){target.key=key;target.best=distance;target.last=r;}qMemory.targets[a.id]=target;
   if(r-target.last>P.resourcePatience){qMemory.avoid[a.id]=r+P.resourceAvoid;delete qMemory.targets[a.id];}
   else if(threat===0||own>=threat*P.resourceRatio||near.length===1&&staff.length>=2){for(const h of staff)goals[h.id]={kind:'ancient',id:a.id,p:a.p,group:staff.map(h=>h.id)};}
  }
 }
 if(byRole.support&&goals[byRole.support.id].kind==='lane'){const sup=byRole.support,carry=byRole.adc||byRole.mid||byRole.top;if(carry)goals[sup.id]={kind:'escort',unit:carry.id,p:goals[carry.id]?.p||carry.p,lane:goals[carry.id]?.lane};}
 // Only pull a mass defense toward an actual open-base push; avoid phantom fountain camping.
 const openAgainst=G.openedLanes(s,enemy),lastDamage=(s.events||[]).some(e=>e.kind==='push_damage'&&e.target===base.id&&e.damage>0),attackLanes=fronts.filter(f=>openAgainst.includes(f.lane)&&qD(f.frontP,base)<=1).map(f=>({f,n:foes.filter(h=>qEq(h.p,s.fronts.find(g=>g.team===enemy&&g.lane===f.lane).p)).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
 if(attackLanes[0]&&(lastDamage||base.hp<45||attackLanes[0].n>=3)){const {f,n}=attackLanes[0],defenders=[...me].sort((a,b)=>qD(a,f.p)-qD(b,f.p)||b.gold-a.gold).slice(0,Math.min(me.length,n+1));for(const h of defenders)goals[h.id]={kind:'defend',lane:f.lane,p:f.p};}
 // A task with no movement/income/combat progress cannot hold a hero forever.
 for(const h of me){const m=qMemory.units[h.id],g=goals[h.id];if(m.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&!G.engagementOf(s,h)&&g.kind!=='defend'){
   if(h.role==='jungle'&&r<=s.config.laneLock){const c=s.camps.filter(c=>c.kind==='normal'&&c.alive).sort((a,b)=>qD(h,a)-qD(h,b))[0];if(c)goals[h.id]={kind:'camp',id:c.id,p:c.p};}
   else{const options=fronts.filter(f=>r>s.config.laneLock||G.roleLane(h.role)===f.lane).flatMap(f=>f.cells.map(p=>({f,p,v:qIncome(s,h,p)*8/(qD(h,p)+1)-qIncoming(s,h,p)/Math.max(1,h.maxHP)*8}))).sort((a,b)=>b.v-a.v);if(options[0])goals[h.id]={kind:'recover-economy',lane:options[0].f.lane,p:options[0].p};}
  }}
 return goals;
}


function qFountainSally(s,me,foes,orders,r){
 // The fountain has a single exit. Waiting for a path with less than70% incoming
 // damage can be permanent when a siege pins every route. Choose a coordinated
 // break-out, not indefinite safety; a real base-income objective follows it.
 const stuck=me.filter(h=>eq(h.p,G.FOUNTAIN[h.team])&&qIncome(s,h,h.p)===0&&(qMemory.units[h.id]?.idle||0)>=6&&h.stunUntil<r&&h.engageRecoveryUntil<r&&!G.engagementOf(s,h));
 if(!stuck.length)return;
 const team=s.you,home=G.HOME[team],exits=G.neighbors(team,G.FOUNTAIN[team]);if(!exits.length)return;
 const exit=exits.slice().sort((a,b)=>G.dist(a,home)-G.dist(b,home))[0];
 for(let i=0;i<me.length;i++){
  const h=me[i];if(!eq(h.p,G.FOUNTAIN[team])||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h))continue;
  const target=foes.find(t=>t.id===orders[i].target),attack=['attack','reap','spell'].includes(orders[i].action)&&(orders[i].action==='spell'?orders[i].cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(orders[i].action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)));
  if(attack)continue;
  // Every available ally takes the same timing, including the healer. This is a
  // strategic commitment after six dry turns, not an extra engine command.
  orders[i]=O(h,'move',{to:exit.slice()});
  const goal=qRecoveryGoal(s,h)||s.fronts.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>({p,lane:f.lane,value:qIncome(s,h,p)/(G.dist(p,exit)+1)}))).sort((a,b)=>b.value-a.value)[0];
  if(goal)qMemory.recovery[h.id]={p:goal.p,lane:goal.lane,until:r+12};
 }
}

function macro(s){
 track(s);
 const team=s.you,enemy=G.enemy(team),r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),goals=assignments(s,team),fs=s.fronts.filter(f=>f.team===team),preds=[predict(s,enemy,0),predict(s,enemy,1),motionPrediction(s,enemy)],oldByID=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const provisional=me.map(h=>{const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;if(g.kind==='camp'||g.kind==='ancient'){const c=s.camps.find(c=>c.id===g.id);if(c?.alive&&eq(c.p,h.p))return O(h,'capture',{target:c.id});}if(g.lane&&eq(G.pushPosition(s,team,g.lane),h.p))return O(h,'push',{lane:g.lane});return travel(s,h,g.p);});
 const savedEscort=history.escort;preds.push(responsePrediction(s,enemy,provisional));history.escort=savedEscort;
 const goalP=(h,n=s)=>{const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'};if(g.kind==='lane')return G.pushPosition(n,team,g.lane);if(g.kind==='escort'){const t=n.heroes.find(x=>x.id===g.unit);if(t?.alive)return t.p;}return g.p;};
 let simCount=0;
 function value(n,orders){
  if(n.result)return n.result.winner===team?1e7:n.result.winner===enemy?-1e7:0;
  let v=0;const alive=n.heroes.filter(h=>h.alive),nf=G.fronts(n);
  for(const h of n.heroes){
   const old=oldByID[h.id],us=h.team===team,sign=us?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sign*(h.gold-old.gold)*(Q.roleMoney?w:1)*1.25;
   if(!h.alive){if(old.alive)v-=sign*(220+Math.min(170,r)+h.gold*.035)*w*Math.min(1,Math.max(1,s.config.maxTurns+1-r)/16);continue;}
   const fraction=h.hp/h.maxHP*Math.min(1,Math.max(0,s.config.maxTurns-r)/12);
   v+=sign*fraction*(110+h.maxHP*.045)*w;
   if(h.stunUntil>=n.turn+1)v-=sign*18*w;
   if(h.role==='mid'&&h.spellReady>n.turn+1)v-=sign*h.damage*.018*w;if(h.role==='adc'&&h.reapReady>n.turn+1)v-=sign*h.damage*.008*w;
   if(us){
    const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'},p=goalP(h,n),d=distance(h,p),coef=g.kind==='defend'?65:g.kind==='ancient'?30:g.kind==='camp'?19:g.kind==='escort'?12:23;
    v-=Math.max(0,d-(g.kind==='escort'?1:0))*coef;
    const nextDanger=danger(n,h,h.p,n.turn+1),support=alive.find(t=>t.role==='support'&&t.team===team&&G.engagementCanUtility(n,t,h,'heal'));
    const net=Math.max(0,nextDanger-(support&&support.stunUntil<n.turn+1?support.heal*.6:0));
    v-=net*.025*w*Math.min(1,1100/h.maxHP)*Q.risk+Math.max(0,net*1.25-h.hp)/Math.max(1,h.maxHP)*250*w;
   }
   const preferred=G.roleLane(h.role),eligible=nf.filter(f=>f.team===h.team&&f.cells.some(p=>eq(p,h.p))&&(n.turn+1>40||f.lane===preferred));
   for(const f of eligible){const members=alive.filter(a=>a.team===h.team&&f.cells.some(p=>eq(p,a.p))&&(n.turn+1>40||G.roleLane(a.role)===f.lane)),den=Math.max(1,members.reduce((v,a)=>v+(a.role==='support'?.25:1),0));let income=12*(h.role==='support'?.25:1)/den+(h.role==='adc'?s.config.adcLaneFlat:0);if(h.role==='support'&&members.some(a=>a.role==='adc'))income*=1.5;v+=sign*income*w*1.8;}
   if(us&&n.turn+1>s.config.laneLock){const bestFuture=Math.max(0,...nf.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>qIncome({...n,fronts:nf,decisionTurn:n.turn+1},h,p)/(G.dist(h,p)+1))));v+=bestFuture*Q.future;}
  }
  for(const b of n.buildings){const old=s.buildings.find(x=>x.id===b.id),sign=b.team===team?-1.2:1;v+=sign*(old.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);if(old.hp>0&&b.hp<=0)v+=sign*50;}
  for(const e of n.events){
   if(e.kind==='invalid'&&e.unit[0]===team)v-=30;
   if(e.kind==='ancient_progress'&&e.damage){const c=n.camps.find(c=>c.id===e.target);if(c.alive)v+=(e.counts[team]>e.counts[enemy]?1:e.counts[team]<e.counts[enemy]?-1:0)*120;}
  }
  return v;
 }
 function sim(orders,ps){simCount++;return G.simulate(s,{[team]:{orders},[enemy]:{orders:ps}},'public-simulation-'+r+'-'+JSON.stringify(ps));}
 const scoreCache=new Map(),predictionKeys=preds.map(ps=>JSON.stringify(ps));
 function score(orders){
  const key=JSON.stringify(orders);if(scoreCache.has(key))return scoreCache.get(key);
  const cases=new Map(),values=preds.map((ps,i)=>{const k=predictionKeys[i];if(!cases.has(k))cases.set(k,value(sim(orders,ps),orders));return cases.get(k);});
  const base=.65*(values[0]+values[1])/2+.35*Math.min(values[0],values[1]);const old=.8*base+.2*values[2];const v=.65*old+.25*values[3]+.1*Math.min(old,values[3]);scoreCache.set(key,v);return v;
 }
 const opts=me.map(h=>{
  const allowed=G.engageAllowedActions(s,h,r),out=[O(h,'wait')],has=a=>allowed.includes(a);
  if(has('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(has('teleport'))for(const t of G.teleportTargets(s,h,r))if(!eq(h.p,t.p))out.push(O(h,'teleport',{to:t.p.slice()}));
  if(has('recall')&&h.hp<h.maxHP*.85&&!G.threatened(s,h))out.push(O(h,'recall'));
  out.push(...v2CombatOptions(s,h,foes,preds));
  if(has('heal'))for(const a of me)if(a.hp<a.maxHP&&G.dist(a,h)<=2||a.hp<a.maxHP&&G.sameEngagement(s,h,a))out.push(O(h,'heal',{target:a.id}));
  if(has('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  if(has('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(c.kind==='ancient'||h.role!=='support'))out.push(O(h,'capture',{target:c.id}));
  if(has('push'))for(const f of fs)if(eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  return out;
 });
 let orders=me.map((h,i)=>{
  const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;
  if(opts[i].length===1)return opts[i][0];
  if(g.kind==='lane'){const push=opts[i].find(o=>o.action==='push'&&o.lane===g.lane);if(push)return push;}
  if(g.kind==='ancient'||g.kind==='camp'){const cap=opts[i].find(o=>o.action==='capture'&&o.target===g.id);if(cap)return cap;if(eq(h.p,g.p))return O(h,'wait');}
  return travel(s,h,goalP(h));
 });
 let best=score(orders);
 // Joint actions cross count thresholds that single-coordinate search cannot cross.
 for(const f of fs){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='push'&&o.lane===f.lane));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length);mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'push',{lane:f.lane});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 for(const c of s.camps.filter(c=>c.kind==='ancient'&&c.alive)){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='capture'&&o.target===c.id));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length);mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'capture',{target:c.id});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 const sequence=me.map((h,i)=>i).sort((a,b)=>['support','adc','mid','top','jungle'].indexOf(me[a].role)-['support','adc','mid','top','jungle'].indexOf(me[b].role));
 for(let pass=0;pass<2;pass++){let changed=false;for(const i of sequence){let chosen=orders[i];for(const o of opts[i]){const trial=orders.slice();trial[i]=o;const v=score(trial);if(v>best+.0001){chosen=o;best=v;}}if(chosen!==orders[i])changed=true;orders[i]=chosen;}if(!changed)break;}
 // Compare engaging with continuing the chosen macro orders, using actual simultaneous rules.
 const ji=me.findIndex(h=>h.role==='jungle');
 if(ji>=0&&G.engageCanCast(s,me[ji],r)){
  const centers=foes.filter(h=>G.dist(h,me[ji])<=1).map(h=>h.p).filter((p,i,a)=>a.findIndex(q=>eq(p,q))===i);
  const combatValue=n=>n.heroes.reduce((v,h)=>{const sign=h.team===team?1:-1,w=(150+h.gold*.05+(h.role==='mid'?h.damage*1.5:h.role==='support'?h.heal:h.damage*.6));return v+sign*(h.alive?w*(1+h.hp/h.maxHP):0);},0);
  function rollout(first){let n=first;for(let k=0;k<5&&n.phase==='map'&&!n.result;k++){refresh(n);const commands={A:{orders:[]},B:{orders:[]}};for(const h of n.heroes.filter(h=>h.alive)){let o=combat(n,h);if(!G.engagementOf(n,h)&&o.action==='wait'){const g=h.team===team?goals[h.id]:null;o=g?travel(n,h,g.kind==='lane'?G.pushPosition(n,team,g.lane):g.p):predict(n,h.team,0).find(o=>o.unit===h.id)||o;}commands[h.team].orders.push(o);}n=G.step(n,commands);}return combatValue(n);}
  const baseline=centers.length?rollout(sim(orders,preds[0])):0;let bv=baseline+45,bo=null;
  for(const p of centers){const preview=G.previewEngage(s,me[ji],p);if(!preview)continue;const trial=me.map((h,i)=>i===ji?O(h,'engage',{to:p.slice()}):G.engagementOf(preview,preview.heroes.find(x=>x.id===h.id))?combat(preview,preview.heroes.find(x=>x.id===h.id)):orders[i]);const n=sim(trial,preds[0]),v=rollout(n);if(v>bv){bv=v;bo=trial;}}
  if(bo)orders=bo;
 }
 if(r>40&&me.filter(h=>qMemory.units[h.id]?.idle>=2&&qIncome(s,h,h.p)===0).length>=2){
  const actionFor=(n,h)=>{const co=combat(n,h);if(co.action!=='wait')return co;const g=goals[h.id];if(!g)return O(h,'wait');if(g.kind==='camp'||g.kind==='ancient'){const c=n.camps.find(c=>c.id===g.id);if(c?.alive&&eq(h.p,c.p))return O(h,'capture',{target:c.id});if(!c?.alive){const fs=G.fronts(n).filter(f=>f.team===h.team).sort((a,b)=>G.dist(h,a.p)-G.dist(h,b.p));return eq(h.p,fs[0].p)?O(h,'push',{lane:fs[0].lane}):travel(n,h,fs[0].p);}}const p=g.kind==='lane'?G.pushPosition(n,h.team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;return g.lane&&eq(h.p,G.pushPosition(n,h.team,g.lane))?O(h,'push',{lane:g.lane}):travel(n,h,p);};
  const planned=me.map(h=>actionFor(s,h));
  function rolloutScore(first,sample){let n=G.simulate(s,{[team]:{orders:first},[enemy]:{orders:preds[sample]}},'macro-commit-'+r+'-'+sample);for(let k=0;k<Q.rollout&&!n.result&&n.phase==='map';k++){refresh(n);const commands={};commands[team]={orders:n.heroes.filter(h=>h.alive&&h.team===team).map(h=>actionFor(n,h))};commands[enemy]={orders:predict(n,enemy,sample)};n=G.step(n,commands);}return value(n,first);}
  let a=0,b=0;for(let sample=0;sample<2;sample++){a+=rolloutScore(orders,sample);b+=rolloutScore(planned,sample);}if(b>a+10)orders=planned;
 }
 for(let i=0;i<me.length;i++){const h=me[i],recovery=qMemory.recovery?.[h.id];if(!recovery||qIncome(s,h,h.p)>0||G.engagementOf(s,h)||h.stunUntil>=r||h.engageRecoveryUntil>=r)continue;const o=orders[i],target=foes.find(t=>t.id===o.target),useful=['attack','reap','spell'].includes(o.action)&&(o.action==='spell'?o.cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(o.action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)))||o.action==='heal'&&me.some(a=>a.id===o.target&&a.hp<a.maxHP-.001)||o.action==='control'&&target&&G.engagementCanUtility(s,h,target,'control');if(useful)continue;const route=qRecoveryPath(s,h,recovery.p);if(route?.length>1&&qIncoming(s,h,route[1],true)<h.hp*.7)orders[i]=O(h,'move',{to:route[1]});}
 qFountainSally(s,me,foes,orders,r);
 return{orders};
}
module.exports.decide=function(s){if(s.phase==='final_battle')return arena(s);if(s.phase!=='map'||s.result)return{orders:[]};return macro(s);};


const __decide=module.exports.decide;module.exports.decide=function(obs){for(const c of obs.camps)if(c.kind==='ancient'&&!c.alive&&c.spawnAt===null)c.spawnAt=Number.MAX_SAFE_INTEGER;return __decide(obs);};

;return module.exports;}
function makeShadow2(){const module={exports:{}};const exports=module.exports;const require=function(n){if(n==='./engine.cjs')return __G;throw new Error('Only ./engine.cjs');};
// Attribution: adapted from public hex-moba-contest policies (Sol V15 search core); new rules, skills, final solver and macro changes by this task.
'use strict';
const Q={"macro":"new","start":70,"future":4,"risk":0.9,"rollout":5,"roleMoney":true},P={"travel":3,"structureCost":0.22,"crowd":8,"finish":50,"income":2,"moveRisk":0.7,"campRisk":8,"squad":2,"split":true,"counter":false,"carryLate":true,"jungleFarm":true,"resource":0.8,"notice":3,"resourceSquad":2,"resourceRatio":0.85,"resourcePatience":5,"resourceAvoid":9,"idleLimit":4,"recall":0.3,"pushRisk":1,"engageRatio":1.05,"id":"split_search"};
'use strict';
// Sol V15 entrant v3. Reuses public policies/sol_ref.cjs (frozen-sol-v7).
// Changes: resource staffing, cooperative push/capture, expected tied rewards, proactive defense.
const G=require('./engine.cjs');
const PLAN={"mode":"split","rotate":40,"jungle":"farm","primary":"bottom","dynamicLane":false,"routeHP":0.4,"routeDistance":4,"routeThreat":0.02,"campRisk":6,"invade":0,"anticipate":3,"ancientRisk":2,"ancientHelp":[],"helpRange":4,"helpThreat":1,"rotateOpened":true,"reactCluster":[],"defend":true,"defendHP":18,"gold":1.0,"hp":1.0,"death":1.0,"position":1.2,"tower":3.5,"base":1.5,"ancient":1.0,"income":1.0,"passes":2};
const relativeID=(team,id)=>team==='A'?id:id.replace(/^[AB]_/,m=>m==='A_'?'B_':'A_');
const localNeighbors=(team,p)=>G.neighbors('A',team==='A'?p:p.map(v=>-v)).map(q=>team==='A'?q:q.map(v=>-v));
const K=p=>p.join(','), eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const cells=G.CELLS, ix=new Map(cells.map((p,i)=>[K(p),i]));
const adj=cells.map(p=>G.neighbors('A',p).map(q=>ix.get(K(q))));
const terrain=cells.map(p=>G.isLane(p));
const dd=cells.map((p,i)=>{const d=Array(cells.length).fill(99),q=[i];d[i]=0;for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(d[j]===99){d[j]=d[q[n]]+1;q.push(j);}return d;});
const distance=(a,b)=>dd[ix.get(K(a.p||a))][ix.get(K(b.p||b))];
const canHit=(a,b)=>G.dist(a,b)<=1&&(terrain[ix.get(K(a.p||a))]||!terrain[ix.get(K(b.p||b))]);
const order=(h,action,extra)=>({unit:h.id,action,...extra});
const valueRole={top:1,mid:1.35,adc:1.5,support:1,jungle:1.12};

// Fixed-order final arena, explicit adversarial prefix and several continuation policies.
/* Final solver and tactics are defined below. */
let history={turn:0,units:{},escort:null};
const O=(h,action,more={})=>({unit:h.id,action,...more});
function refresh(s){s.decisionTurn=s.turn+1;s.fronts=G.fronts(s);for(const h of s.heroes)Object.assign(h,G.stats(h,s.config));return s;}
function track(s){
 if(s.decisionTurn<=history.turn)history={turn:0,units:{},escort:null};
 for(const h of s.heroes.filter(h=>h.team!==s.you)){
  const m=history.units[h.id]||{lane:G.roleLane(h.role),last:'move',push:0,attack:0,capture:0,engage:0};
  for(const k of ['push','attack','capture','engage'])m[k]*=.96;
  for(const e of s.events||[]){
   let a=null;
   if(e.kind==='push_contest'&&(e.sources?.[h.team]||[]).includes(h.id)){a='push';m.lane=e.lane;}
   if(e.kind==='ancient_progress'&&e.sources.includes(h.id))a='capture';
   if(e.source===h.id||e.unit===h.id){
    if(e.kind==='hit')a=e.attackType==='capture'?'capture':'attack';
    if(['aoe','engage_aoe','spell','reap'].includes(e.kind))a='attack';
    if(['move','teleport','recall','heal','control'].includes(e.kind))a=e.kind;
    if(e.kind==='engage_cast')a='engage';
   }
   if(a){m.last=a;if(m[a]!==undefined)m[a]++;}
  }
  const f=s.fronts.filter(f=>f.team===h.team).sort((a,b)=>distance(h,a.p)-distance(h,b.p));
  if(s.decisionTurn>40&&m.last==='move'&&distance(h,f[0].p)<2)m.lane=f[0].lane;
  m.stationary=m.p&&eq(m.p,h.p)?(m.stationary||0)+1:0;if(m.stationary>=2&&!(s.events||[]).some(e=>(e.unit===h.id||e.source===h.id)&&['move','teleport','recall','hit','heal','control','engage_cast'].includes(e.kind)))m.last='wait';m.oldP=m.p;m.p=h.p.slice();history.units[h.id]=m;
 }
 history.turn=s.decisionTurn;
}
function danger(s,h,p,r=s.turn+1){return v2Incoming(s,h,p,r);}
function travel(s,h,p){
 if(eq(h.p,p))return O(h,'wait');
 const ns=localNeighbors(h.team,h.p);ns.sort((a,b)=>distance(a,p)-distance(b,p)||danger(s,h,a)-danger(s,h,b)||K(h.team==='A'?a:a.map(v=>-v)).localeCompare(K(h.team==='A'?b:b.map(v=>-v))));
 return ns.length?O(h,'move',{to:ns[0]}):O(h,'wait');
}
// New-version tactics. Shared by the three documented baseline families.
function v2CombatOptions(s,h,foes,predicted=[]){
 const r=s.turn+1,a=G.engageAllowedActions(s,h,r),out=[];if(Q.speculate===false)predicted=[];
 if(a.includes('attack'))for(const t of foes)if(G.canHeroAttack(h,t,s)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canHeroAttack(h,{...t,p:o.to},s))))out.push(O(h,'attack',{target:t.id}));
 if(a.includes('reap'))for(const t of foes)if(G.canReap(s,h,t)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canReap(s,h,{...t,p:o.to}))))out.push(O(h,'reap',{target:t.id}));
 if(a.includes('spell'))for(const cells of G.spellTargets(s,h))if(foes.some(t=>cells.some(p=>eq(p,t.p)))||predicted.some(os=>os.some(o=>o.unit[0]!==h.team&&o.action==='move'&&cells.some(p=>eq(p,o.to)))))out.push(O(h,'spell',{cells}));
 return out;
}
function v2Incoming(s,h,p,r=s.turn+1){
 let sum=0;
 for(const t of s.heroes.filter(t=>t.alive&&t.team!==h.team&&t.role!=='support'&&t.stunUntil<r)){
  const victim={...h,p},basic=G.canHeroAttack(t,victim,s)?t.damage:0;
  const reap=t.role==='adc'&&t.reapReady<=r&&G.canReap(s,t,victim)?Math.floor(t.damage*s.config.reapMultiplier):0;
  const spell=t.role==='mid'&&t.spellReady<=r&&G.spellTargets(s,t).some(cells=>cells.some(q=>eq(q,p)))?t.damage:0;
  sum+=Math.max(basic,reap,spell);
 }
 return sum;
}
function combat(s,h,mode=0){
 const r=s.turn+1,all=s.heroes.filter(x=>x.alive&&x.team===h.team),foes=s.heroes.filter(x=>x.alive&&x.team!==h.team),wait=O(h,'wait'),allowed=G.engageAllowedActions(s,h,r);
 if(!h.alive||h.stunUntil>=r)return wait;
 if(h.engageRecoveryUntil>=r){if(allowed.includes('recall')&&h.hp<h.maxHP*.6&&!G.threatened(s,h))return O(h,'recall');return wait;}
 const threat=t=>t.role==='support'?t.heal*1.4:t.damage*(t.role==='mid'?1.4:t.role==='adc'?1.18:1);
 const harm=(t,power)=>Math.min(power,t.hp)*(.5+threat(t)/Math.max(100,t.maxHP))+(t.hp<=power?280+threat(t)*1.5+t.gold*.04:0);
 let best=wait,bv=0;
 if(h.role==='support'){
  for(const t of all)if(G.engagementCanUtility(s,h,t,'heal')){const n=Math.min(h.heal,t.maxHP-t.hp),danger=v2Incoming(s,t,t.p,r),v=n*(.8+(t.role==='mid'?.35:t.role==='adc'?.3:0))+(t.hp<=danger&&t.hp+n>danger?200+threat(t):0);if(v>bv){bv=v;best=O(h,'heal',{target:t.id});}}
  if(allowed.includes('control'))for(const t of foes)if(t.stunUntil<r+1&&G.engagementCanUtility(s,h,t,'control')){const v=threat(t)*.9;if(v>bv){bv=v;best=O(h,'control',{target:t.id});}}
  return bv>5?best:wait;
 }
 for(const o of v2CombatOptions(s,h,foes)){
  let v=0;
  if(o.action==='spell'){const targets=foes.filter(t=>o.cells.some(p=>eq(p,t.p)));v=targets.reduce((n,t)=>n+harm(t,h.damage),0)-h.damage*.12;}
  else{const t=foes.find(t=>t.id===o.target),power=o.action==='reap'?Math.floor(h.damage*s.config.reapMultiplier):h.damage;v=harm(t,power)-(o.action==='reap'&&t.hp>power?h.damage*.08:0);if(mode===1)v+=power/(1+t.hp/Math.max(1,power));}
  if(v>bv){bv=v;best=o;}
 }
 return best;
}

// Final combat uses the actual new engine, not the old forced-mid-wait approximation.
function arena(s){
 const d=s.finalDecision;if(!d||d.team!==s.you)return{orders:[]};const actor=s.heroes.find(h=>h.id===d.actor);
 if(d.forcedWait)return{orders:[O(actor,'wait')]};
 const team=s.you,opp=G.enemy(team),base={phase:'final_battle',turn:s.turn,mapTurn:s.mapTurn,version:s.version,config:s.config,heroes:G.clone(s.heroes),battle:G.clone(s.battle),teams:G.clone(s.teams),events:[],orders:{A:[],B:[]},result:null};
 function options(n){
  const dd=G.finalDecision(n),h=n.heroes.find(x=>x.id===dd.actor),friends=n.heroes.filter(x=>x.alive&&x.team===h.team),foes=n.heroes.filter(x=>x.alive&&x.team!==h.team),out=[];
  if(dd.forcedWait)return[O(h,'wait')];
  for(const a of dd.legalActions){if(a==='spell')out.push(O(h,'spell'));else if(a==='attack'||a==='reap'||a==='control'){for(const t of foes)if(a!=='control'||!n.battle.skip[t.id])out.push(O(h,a,{target:t.id}));}else if(a==='heal'){for(const t of friends)if(t.hp<t.maxHP)out.push(O(h,'heal',{target:t.id}));}}
  return out.length?out:[O(h,'wait')];
 }
 function value(n,side){
  if(n.result)return n.result.winner===side?1e8:-1e8;
  let v=0;
  for(const h of n.heroes){const sign=h.team===side?1:-1,p=h.role==='support'?h.heal*1.35:h.damage*(h.role==='mid'?1.5:h.role==='adc'?1.12:1),w=150+p*.8+h.gold*.035;
   if(h.alive){v+=sign*(w*(.55+h.hp/h.maxHP*.45)+Math.sqrt(h.hp)*.5);if(n.battle.skip[h.id])v-=sign*p*.35;}}
  return v;
 }
 function step(n,o){return G.stepFinalBattle(n,{[o.unit[0]]:{orders:[o]}});}
 function ranked(n,limit){const side=n.battle.actor[0];return options(n).map(o=>{const child=step(n,o);return{o,n:child,v:value(child,side)};}).sort((a,b)=>b.v-a.v||JSON.stringify(a.o).localeCompare(JSON.stringify(b.o))).slice(0,limit);}
 const roots=ranked(base,Math.min(7,options(base).length));let best=roots[0].o,bv=-Infinity;
 for(const candidate of roots){let n=candidate.n;for(let k=0;k<22&&!n.result;k++)n=ranked(n,1)[0].n;const v=value(n,team)*.85+candidate.v*.15;if(v>bv){bv=v;best=candidate.o;}}
 return{orders:[best]};
}

function originalAssignments(s,team){
 const r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),fs=s.fronts.filter(f=>f.team===team),g={},byRole=Object.fromEntries(me.map(h=>[h.role,h])),opened=G.openedLanes(s,team);
 const front=l=>fs.find(f=>f.lane===l),risk=(h,p)=>danger(s,h,p)/Math.max(200,h.maxHP);
 function route(h){return fs.filter(f=>!opened.includes(f.lane)).sort((a,b)=>(distance(h,a.p)*5+risk(h,a.p)*8+s.buildings.filter(b=>b.team!==team&&b.lane===a.lane).reduce((v,b)=>v+b.hp,0)*.2)-(distance(h,b.p)*5+risk(h,b.p)*8+s.buildings.filter(t=>t.team!==team&&t.lane===b.lane).reduce((v,b)=>v+b.hp,0)*.2))[0]?.lane;}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>40&&opened.includes(lane)&&opened.length<2&&h.role!=='mid')lane=route(h)||lane;g[h.id]={kind:'lane',lane,p:front(lane).p};}
 const j=byRole.jungle;
 let ancient=null;
 if(j){
  const opts=s.camps.filter(c=>c.kind==='ancient'&&(c.alive||c.spawnAt<=r+distance(j,c)+3)).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*2})).sort((a,b)=>a.v-b.v);
  ancient=opts[0]?.c;
  if(ancient)g[j.id]={kind:'ancient',p:ancient.p,id:ancient.id};
  else {
   const cs=s.camps.filter(c=>c.kind==='normal'&&(c.alive||c.spawnAt<=r+distance(j,c))).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*4})).sort((a,b)=>a.v-b.v||relativeID(team,a.c.id).localeCompare(relativeID(team,b.c.id)));
   if(cs[0])g[j.id]={kind:'camp',p:cs[0].c.p,id:cs[0].c.id};
  }
 }
 const sup=byRole.support;
 if(sup&&r>40){
  const options=me.filter(h=>h.role!=='support'&&h.role!=='jungle').map(h=>({h,v:danger(s,h,h.p)/Math.max(1,h.maxHP)*2+(1-h.hp/h.maxHP)*.5+(h.role==='mid'?.15:0)-distance(sup,h)*.07+(history.escort===h.role?.12:0)})).sort((a,b)=>b.v-a.v);
  const escort=options[0]?.h;
  if(escort){history.escort=escort.role;g[sup.id]={kind:'escort',p:escort.p,unit:escort.id,lane:g[escort.id]?.lane};}
 }
 if(ancient&&r>40){
  const remaining=ancient.alive?ancient.hp:4;
  const eta=Math.max(0,(ancient.spawnAt||r)-r)+remaining;
  const relevant=foes.filter(h=>distance(h,ancient)<=Math.min(6,eta+2));
  const enemyCount=relevant.reduce((n,h)=>n+(h.role==='jungle'?2:1),0);
  const helpers=me.filter(h=>!['jungle','adc'].includes(h.role)&&distance(h,ancient)<=6&&h.hp>h.maxHP*.45).sort((a,b)=>{
   const cost=h=>distance(h,ancient)+(h.role==='support'?-1.6:h.role==='mid'?1.8:0)+(1-h.hp/h.maxHP)*3;
   return cost(a)-cost(b);
  });
  const need=Math.max(0,Math.min(2,enemyCount-1));
  for(const h of helpers.slice(0,need))g[h.id]={kind:'ancient',p:ancient.p,id:ancient.id};
 }
 const base=s.buildings.find(b=>b.id===team+'_base'),openAgainst=G.openedLanes(s,G.enemy(team));
 if(openAgainst.length){
  const lanes=fs.filter(f=>openAgainst.includes(f.lane)).map(f=>({f,ef:s.fronts.find(e=>e.team!==team&&e.lane===f.lane),attackers:foes.filter(h=>distance(h,base)<=3&&G.PATHS[f.lane].some(p=>eq(p,h.p)))})).sort((a,b)=>b.attackers.length-a.attackers.length);
  const bad=lanes.find(x=>x.attackers.length&&distance(x.ef.p,base)<=2);
  if(bad){
   const cap=openAgainst.length===1?1:openAgainst.length===2?3:5;
   const urgency=base.hp/(cap*Math.max(1,bad.attackers.length));
   const defenders=me.filter(h=>h.role!=='adc').sort((a,b)=>{
    const cost=h=>distance(h,bad.f.p)*5-(h.role==='mid'?12:h.role==='support'?8:0)-h.hp/h.maxHP*3;
    return cost(a)-cost(b);
   });
   const needed=Math.min(defenders.length,urgency<10?3:2);
   for(const h of defenders.slice(0,needed))g[h.id]={kind:'defend',lane:bad.f.lane,p:bad.f.p};
  }
 }

 return g;
}

function qForecast(s,h,p){let damage=0;for(const e of s.heroes.filter(e=>e.alive&&e.team!==h.team&&e.role!=='support'&&e.stunUntil<s.decisionTurn+1)){if(G.canHeroAttack(e,{...h,p},s))damage+=e.damage;else if(G.neighbors(e.team,e.p).some(q=>G.canHeroAttack({...e,p:q},{...h,p},s)))damage+=e.damage*.4;}return damage;}
function qRecoveryPath(s,h,target){const nodes=G.CELLS,distances=new Map([[G.key(h.p),0]]),previous=new Map(),open=[h.p],closed=new Set();while(open.length){open.sort((a,b)=>(distances.get(G.key(a))||0)-(distances.get(G.key(b))||0));const p=open.shift(),k=G.key(p);if(closed.has(k))continue;closed.add(k);if(eq(p,target)){const out=[p];while(previous.has(G.key(out[0])))out.unshift(previous.get(G.key(out[0])));return out;}for(const q of G.neighbors(h.team,p)){const current=qIncoming(s,h,q,true),future=qForecast(s,h,q),cost=distances.get(k)+1+current/Math.max(1,h.hp)*8+future/Math.max(1,h.maxHP)*3,kk=G.key(q);if(cost<(distances.get(kk)??Infinity)){distances.set(kk,cost);previous.set(kk,p);open.push(q);}}}return null;}
function qRecoveryGoal(s,h){const choices=s.fronts.filter(f=>f.team===h.team&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane)).flatMap(f=>f.cells.map(p=>{const path=qRecoveryPath(s,h,p),danger=path?.[1]?qIncoming(s,h,path[1],true):0;return{p,lane:f.lane,path,danger,value:qIncome(s,h,p)*10/Math.max(1,path?.length||99)-qForecast(s,h,p)/Math.max(1,h.maxHP)*30-danger/Math.max(1,h.hp)*30};})).filter(x=>x.path&&x.danger<h.hp*.7).sort((a,b)=>b.value-a.value);return choices[0];}
function assignments(s,team){
 if(team!==s.you)return originalAssignments(s,team);
 const candidate=qMacro(s),native=originalAssignments(s,team),goals=s.decisionTurn<Q.start||Q.macro==='native'?native:candidate;
 qMemory.recovery||={};
 for(const h of s.heroes.filter(h=>h.alive&&h.team===team)){
  const m=qMemory.units[h.id],r=s.decisionTurn;let recovery=qMemory.recovery[h.id];
  if(recovery&&(r>recovery.until||qIncome(s,h,h.p)>0)){delete qMemory.recovery[h.id];recovery=null;}
  if(!recovery&&m?.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&r>s.config.laneLock&&!G.engagementOf(s,h)){const best=qRecoveryGoal(s,h);if(best){recovery={p:best.p,lane:best.lane,until:r+10};qMemory.recovery[h.id]=recovery;}}
  if(recovery)goals[h.id]={kind:'recover-economy',lane:recovery.lane,p:recovery.p};
  if(goals[h.id]?.lane&&!['ancient','camp','escort','recover-economy'].includes(goals[h.id].kind))goals[h.id].kind='lane';
 }
 return goals;
}
function predict(s,team,mode=0){
 const r=s.turn+1,hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team);
 return hs.map(h=>{
  const m=history.units[h.id],locked=G.engagementOf(s,h)||h.engageRecoveryUntil>=r;
  const co=combat(s,h,mode);if(h.stunUntil>=r||locked)return co;
  if(h.hp<h.maxHP*.28&&!G.threatened(s,h))return O(h,'recall');
  let lane=r<=40?G.roleLane(h.role):m?.lane||G.roleLane(h.role);lane=lane||'mid';
  const f=s.fronts.find(f=>f.team===team&&f.lane===lane);
  if(mode===1&&eq(h.p,f.p)&&m?.push>m?.attack*.65&&co.action!=='heal')return O(h,'push',{lane});
  if(co.action!=='wait')return co;
  if(h.role==='jungle'){
   const cs=s.camps.filter(c=>c.alive||c.spawnAt<=r+distance(h,c)+1).map(c=>({c,v:distance(h,c)+(c.kind==='ancient'?-5:0)+Math.max(0,(c.spawnAt||r)-r-distance(h,c))+danger(s,h,c.p)/Math.max(1,h.maxHP)*3})).sort((a,b)=>a.v-b.v);
   if(cs.length)return eq(h.p,cs[0].c.p)?cs[0].c.alive?O(h,'capture',{target:cs[0].c.id}):O(h,'wait'):travel(s,h,cs[0].c.p);
  }
  if(eq(h.p,f.p))return O(h,'push',{lane});return travel(s,h,f.p);
 });
}

function motionPrediction(s,team){
 const r=s.turn+1,defaultOrders=predict(s,team,0);
 return defaultOrders.map(o=>{
  const h=s.heroes.find(h=>h.id===o.unit),m=history.units[h.id];
  if(!m||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h)||o.action==='heal')return o;if(m.last==='wait'&&m.stationary>=2&&combat(s,h).action==='wait')return O(h,'wait');
  // A move during attack cooldown is weak evidence for retreat when the attack has just recovered.
  if(['attack','spell','reap'].includes(o.action))return o;
  const camp=s.camps.find(c=>c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'));
  if(camp&&(h.role==='jungle'||m.last==='capture'))return O(h,'capture',{target:camp.id});
  if(m.last==='move'&&m.oldP&&G.dist(m.oldP,m.p)===1){
   const next=[h.p[0]+m.p[0]-m.oldP[0],h.p[1]+m.p[1]-m.oldP[1]],f=s.fronts.find(f=>f.team===team&&f.lane===(m.lane||G.roleLane(h.role)||'mid'));
   if(G.valid(next)&&!eq(h.p,f.p)&&(!s.camps.some(c=>eq(c.p,h.p)&&c.alive)||h.role==='support')){
    if(distance(next,f.p)<distance(h,f.p)||danger(s,h,next)<danger(s,h,h.p))return O(h,'move',{to:next});
   }
  }
  if(h.hp<h.maxHP*.55&&danger(s,h,h.p)>h.hp*.55){
   const choices=localNeighbors(team,h.p).map(p=>({p,v:danger(s,h,p)+distance(p,G.FOUNTAIN[team])*h.maxHP*.025})).sort((a,b)=>a.v-b.v);
   if(choices.length&&danger(s,h,choices[0].p)<danger(s,h,h.p)*.55)return O(h,'move',{to:choices[0].p});
  }
  return o;
 });
}

// A generic best response hypothesis, using only legal public-state outcomes.
function responsePrediction(s,team,ours){
 const r=s.turn+1,gs=assignments(s,team),hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),old=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const active=h=>G.engageAllowedActions(s,h,r);
 const options=h=>{
  const a=active(h),out=[O(h,'wait')];
  if(a.includes('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(a.includes('teleport'))for(const b of G.teleportTargets(s,h,r))out.push(O(h,'teleport',{to:b.p}));
  if(a.includes('recall')&&!G.threatened(s,h)&&h.hp<h.maxHP*.85)out.push(O(h,'recall'));
  if(a.includes('push'))for(const f of s.fronts)if(f.team===team&&eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  if(a.includes('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'))out.push(O(h,'capture',{target:c.id}));
  out.push(...v2CombatOptions(s,h,foes,[ours]));
  if(a.includes('heal'))for(const t of hs)if(t.hp<t.maxHP&&G.dist(h,t)<=2||t.hp<t.maxHP&&G.sameEngagement(s,h,t))out.push(O(h,'heal',{target:t.id}));
  if(a.includes('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  return out;
 };
 let os=predict(s,team,0);
 function value(n){
  if(n.result)return n.result.winner===team?1e7:n.result.winner?-1e7:0;
  const nf=G.fronts(n);let v=0;
  for(const h of n.heroes){
   const o=old[h.id],sg=h.team===team?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sg*(h.gold-o.gold)*w*1.25;
   if(!h.alive){if(o.alive)v-=sg*(240+Math.min(r,170)+h.gold*.04)*w;continue;}
   v+=sg*h.hp/h.maxHP*(130+h.maxHP*.045)*w;
   if(h.stunUntil>=r+1)v-=sg*20*w;
   if(h.attackReady>r+1)v-=sg*5*w;
   if(h.team===team){const g=gs[h.id];let p=g.kind==='lane'||g.kind==='defend'?G.pushPosition(n,team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;
    v-=Math.max(0,distance(h,p)-(g.kind==='escort'?1:0))*(g.kind==='defend'?60:g.kind==='ancient'?27:g.kind==='camp'?19:23);
    v-=Math.max(0,danger(n,h,h.p,r+1)*1.15-h.hp)/h.maxHP*300;
   }
  }
  for(const b of n.buildings){const o=s.buildings.find(x=>x.id===b.id);v+=(b.team===team?-1.2:1)*(o.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);}
  for(const e of n.events){if(e.kind==='invalid'&&e.unit[0]===team)v-=30;if(e.kind==='ancient_progress'&&e.damage&&n.camps.find(c=>c.id===e.target).alive)v+=(e.counts[team]>e.counts[G.enemy(team)]?1:e.counts[team]<e.counts[G.enemy(team)]?-1:0)*100;}
  return v;
 }
 for(let i=0;i<hs.length;i++){
  let best=os[i],bv=-Infinity;
  for(const a of options(hs[i])){os[i]=a;const n=G.step(s,{[team]:{orders:os},[G.enemy(team)]:{orders:ours}}),v=value(n);if(v>bv+.0001){bv=v;best=a;}}
  os[i]=best;
 }
 return os;
}


// Local benchmark policy. Only public observations and self-chosen simulation seeds.
const qEq=(a,b)=>G.key(a.p||a)===G.key(b.p||b),qD=(a,b)=>G.dist(a,b),qOrder=(h,action,extra={})=>({unit:h.id,action,...extra});
let qMemory={turn:0,units:{},avoid:{},targets:{}};
const roleWeight={top:1,mid:1.35,adc:1.55,support:.9,jungle:1.15};
function qPower(h){return h.role==='support'?h.heal*.85:h.damage*.6;}
function qIncome(s,h,p,all=s.heroes){let total=0;for(const f of s.fronts.filter(f=>f.team===h.team&&f.cells.some(x=>qEq(x,p))&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane))){const members=all.filter(x=>x.alive&&x.team===h.team&&(x.id===h.id||f.cells.some(p=>qEq(x,p)))&&(s.decisionTurn>s.config.laneLock||G.roleLane(x.role)===f.lane)),den=Math.max(1,members.reduce((v,x)=>v+(x.role==='support'?.25:1),0));let n=s.config.laneGold*(h.role==='support'?.25:1)/den;if(h.role==='adc')n+=s.config.adcLaneFlat;if(h.role==='support'&&members.some(x=>x.role==='adc'))n*=1+s.config.supportWithAdcLaneBonus;total+=n;}return total;}
function qIncoming(s,h,p,readyOnly=false){return v2Incoming(s,h,p,s.decisionTurn);}
function qWalk(s,h,target){if(qEq(h,target))return qOrder(h,'wait');const route=G.pathTo(h.team,h.p,target);if(!route||route.length<2)return qOrder(h,'wait');const shortest=route.length-1,choices=G.neighbors(h.team,h.p).map(p=>({p,path:G.pathTo(h.team,p,target),risk:qIncoming(s,h,p,true)})).filter(x=>x.path&&x.path.length-1<=shortest);choices.sort((a,b)=>(a.path.length*23+Math.min(90,a.risk/Math.max(1,h.maxHP)*P.moveRisk*100))-(b.path.length*23+Math.min(90,b.risk/Math.max(1,h.maxHP)*P.moveRisk*100))||G.key(a.p).localeCompare(G.key(b.p)));return qOrder(h,'move',{to:choices[0]?.p||route[1]});}
function qMacro(s){
 const r=s.decisionTurn,team=s.you,enemy=G.enemy(team),me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),byRole=Object.fromEntries(me.map(h=>[h.role,h])),fronts=s.fronts.filter(f=>f.team===team),goals={},opened=G.openedLanes(s,team),base=s.buildings.find(b=>b.id===team+'_base');
 if(!me.length)return{};
 if(r<=qMemory.turn)qMemory={turn:0,units:{},avoid:{},targets:{}};
 for(const h of me){const m=qMemory.units[h.id]||{p:h.p,gold:h.gold,hp:h.hp,idle:0,loop:[],best:99,lastProgress:r};const productive=(s.events||[]).some(e=>(e.source===h.id&&((e.damage||e.amount||0)>0))||(e.awards||[]).some(a=>a.id===h.id&&a.amount>0)||(e.kind==='push_contest'&&(e.sources?.[team]||[]).includes(h.id)));m.idle=qEq(h.p,m.p)&&h.gold<=m.gold+1e-7&&!productive?m.idle+1:0;m.loop.push(G.key(h.p));if(m.loop.length>8)m.loop.shift();m.p=[...h.p];m.gold=h.gold;m.hp=h.hp;qMemory.units[h.id]=m;}
 qMemory.turn=r;
 const front=l=>fronts.find(f=>f.lane===l),laneCost=(h,l)=>{const f=front(l),bs=s.buildings.filter(b=>b.team!==team&&b.lane===l&&b.hp>0),enemyCount=foes.filter(e=>qD(e,f.p)<=1).length;return qD(h,f.p)*P.travel+bs.reduce((n,b)=>n+b.hp,0)*P.structureCost+enemyCount*P.crowd+(opened.includes(l)?(opened.length>=2?-P.finish:80):0);};
 function farming(h,lane){const f=front(lane),cells=f.cells.map(p=>({p,v:qIncome(s,h,p)*P.income-qIncoming(s,h,p)/Math.max(1,h.maxHP)*16-qD(h,p)*2+(qEq(p,f.p)?2:0)})).sort((a,b)=>b.v-a.v);return{kind:'lane',lane,p:cells[0].p};}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>s.config.laneLock&&opened.includes(lane)&&opened.length<2)lane=[...G.LANES].sort((a,b)=>laneCost(h,a)-laneCost(h,b))[0];goals[h.id]=farming(h,lane);}
 const j=byRole.jungle;
 if(j){const options=s.camps.filter(c=>c.kind==='normal').map(c=>{const travel=qD(j,c),wait=c.alive?0:Math.max(0,(c.spawnAt||r)-r-travel),risk=qIncoming(s,j,c.p)/Math.max(1,j.maxHP);return{c,v:48/(travel+wait+1)-risk*P.campRisk+(c.regionTeam===team?1:0)};}).filter(x=>x.c.alive||x.c.spawnAt<=r+qD(j,x.c)+3).sort((a,b)=>b.v-a.v);if(options[0])goals[j.id]={kind:'camp',p:options[0].c.p,id:options[0].c.id};}
 if(r>s.config.laneLock){
  const clustered=G.LANES.map(l=>({lane:l,n:foes.filter(h=>qD(h,front(l).p)<=2).length})).sort((a,b)=>b.n-a.n),available=[...G.LANES].sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b));
  let primary=available[0];if(P.counter&&clustered[0].n>=3)primary=available.find(l=>l!==clustered[0].lane)||primary;
  if(P.squad>=3){const roles=P.carryLate&&r<85?['top','mid','jungle','support']:['top','mid','support','adc','jungle'];let count=0;for(const role of roles){const h=byRole[role];if(!h)continue;if(role==='jungle'&&P.jungleFarm&&r<100)continue;if(count++>=P.squad)break;goals[h.id]={kind:'push',lane:primary,p:front(primary).p};}}
  if(P.split){for(const h of me.filter(h=>h.role!=='support'&&h.role!=='jungle')){const l=G.roleLane(h.role);const best=opened.includes(l)?available.find(l=>!opened.includes(l))||available[0]:l;goals[h.id]=farming(h,best);}}
 }
 // Resource assignments are short commitments with observable progress and explicit fallback.
 if(j){const candidates=s.camps.filter(a=>a.kind==='ancient'&&(a.alive||Number.isFinite(a.spawnAt)&&a.spawnAt!==null&&a.spawnAt<=r+qD(j,a)+P.notice)&&(qMemory.avoid[a.id]||0)<=r).map(a=>{const travel=qD(j,a),wait=a.alive?0:Math.max(0,a.spawnAt-r-travel),hp=a.maxHP||4,pool=a.goldPool||750;return{a,v:pool*P.resource/(travel+wait+hp+2)-Math.max(0,qIncoming(s,j,a.p)/Math.max(1,j.maxHP)-.5)*50};}).sort((a,b)=>b.v-a.v);
  const a=candidates[0]?.a;if(a){const until=a.alive?0:Math.max(0,a.spawnAt-r),near=foes.filter(h=>qD(h,a)<=Math.min(4,until+(a.maxHP||4)+1)),threat=near.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),roles=me.filter(h=>h.id!==j.id&&(!P.carryLate||h.role!=='adc')).sort((a1,b1)=>(qD(a1,a)+(a1.role==='support'?-.8:0))-(qD(b1,a)+(b1.role==='support'?-.8:0))),staff=[j];
   const needed=near.length?Math.min(P.resourceSquad,Math.max(2,near.length)):1;for(const h of roles){if(staff.length>=needed)break;if(qD(h,a)<=Math.min(7,until+(a.maxHP||4)+2)&&h.hp>=h.maxHP*.4)staff.push(h);}
   const own=staff.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),key=staff.map(h=>h.id).sort().join(',')+'@'+(a.announcement?.cycle||0),target=qMemory.targets[a.id]||{key,best:99,last:r},distance=staff.reduce((n,h)=>n+qD(h,a),0),progress=(s.events||[]).some(e=>e.target===a.id&&e.kind==='ancient_progress'&&e.damage>0)||staff.some(h=>(s.events||[]).some(e=>e.source===h.id&&e.damage>0));
   if(key!==target.key||distance<target.best||progress){target.key=key;target.best=distance;target.last=r;}qMemory.targets[a.id]=target;
   if(r-target.last>P.resourcePatience){qMemory.avoid[a.id]=r+P.resourceAvoid;delete qMemory.targets[a.id];}
   else if(threat===0||own>=threat*P.resourceRatio||near.length===1&&staff.length>=2){for(const h of staff)goals[h.id]={kind:'ancient',id:a.id,p:a.p,group:staff.map(h=>h.id)};}
  }
 }
 if(byRole.support&&goals[byRole.support.id].kind==='lane'){const sup=byRole.support,carry=byRole.adc||byRole.mid||byRole.top;if(carry)goals[sup.id]={kind:'escort',unit:carry.id,p:goals[carry.id]?.p||carry.p,lane:goals[carry.id]?.lane};}
 // Only pull a mass defense toward an actual open-base push; avoid phantom fountain camping.
 const openAgainst=G.openedLanes(s,enemy),lastDamage=(s.events||[]).some(e=>e.kind==='push_damage'&&e.target===base.id&&e.damage>0),attackLanes=fronts.filter(f=>openAgainst.includes(f.lane)&&qD(f.frontP,base)<=1).map(f=>({f,n:foes.filter(h=>qEq(h.p,s.fronts.find(g=>g.team===enemy&&g.lane===f.lane).p)).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
 if(attackLanes[0]&&(lastDamage||base.hp<25)){const {f,n}=attackLanes[0],defenders=[...me].sort((a,b)=>qD(a,f.p)-qD(b,f.p)||b.gold-a.gold).slice(0,Math.min(me.length,n+1));for(const h of defenders)goals[h.id]={kind:'defend',lane:f.lane,p:f.p};}
 // A task with no movement/income/combat progress cannot hold a hero forever.
 for(const h of me){const m=qMemory.units[h.id],g=goals[h.id];if(m.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&!G.engagementOf(s,h)&&g.kind!=='defend'){
   if(h.role==='jungle'&&r<=s.config.laneLock){const c=s.camps.filter(c=>c.kind==='normal'&&c.alive).sort((a,b)=>qD(h,a)-qD(h,b))[0];if(c)goals[h.id]={kind:'camp',id:c.id,p:c.p};}
   else{const options=fronts.filter(f=>r>s.config.laneLock||G.roleLane(h.role)===f.lane).flatMap(f=>f.cells.map(p=>({f,p,v:qIncome(s,h,p)*8/(qD(h,p)+1)-qIncoming(s,h,p)/Math.max(1,h.maxHP)*8}))).sort((a,b)=>b.v-a.v);if(options[0])goals[h.id]={kind:'recover-economy',lane:options[0].f.lane,p:options[0].p};}
  }}
 return goals;
}


function qFountainSally(s,me,foes,orders,r){
 // The fountain has a single exit. Waiting for a path with less than70% incoming
 // damage can be permanent when a siege pins every route. Choose a coordinated
 // break-out, not indefinite safety; a real base-income objective follows it.
 const stuck=me.filter(h=>eq(h.p,G.FOUNTAIN[h.team])&&qIncome(s,h,h.p)===0&&(qMemory.units[h.id]?.idle||0)>=6&&h.stunUntil<r&&h.engageRecoveryUntil<r&&!G.engagementOf(s,h));
 if(!stuck.length)return;
 const team=s.you,home=G.HOME[team],exits=G.neighbors(team,G.FOUNTAIN[team]);if(!exits.length)return;
 const exit=exits.slice().sort((a,b)=>G.dist(a,home)-G.dist(b,home))[0];
 for(let i=0;i<me.length;i++){
  const h=me[i];if(!eq(h.p,G.FOUNTAIN[team])||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h))continue;
  const target=foes.find(t=>t.id===orders[i].target),attack=['attack','reap','spell'].includes(orders[i].action)&&(orders[i].action==='spell'?orders[i].cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(orders[i].action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)));
  if(attack)continue;
  // Every available ally takes the same timing, including the healer. This is a
  // strategic commitment after six dry turns, not an extra engine command.
  orders[i]=O(h,'move',{to:exit.slice()});
  const goal=qRecoveryGoal(s,h)||s.fronts.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>({p,lane:f.lane,value:qIncome(s,h,p)/(G.dist(p,exit)+1)}))).sort((a,b)=>b.value-a.value)[0];
  if(goal)qMemory.recovery[h.id]={p:goal.p,lane:goal.lane,until:r+12};
 }
}

function macro(s){
 track(s);
 const team=s.you,enemy=G.enemy(team),r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),goals=assignments(s,team),fs=s.fronts.filter(f=>f.team===team),preds=[predict(s,enemy,0),predict(s,enemy,1),motionPrediction(s,enemy)],oldByID=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const provisional=me.map(h=>{const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;if(g.kind==='camp'||g.kind==='ancient'){const c=s.camps.find(c=>c.id===g.id);if(c?.alive&&eq(c.p,h.p))return O(h,'capture',{target:c.id});}if(g.lane&&eq(G.pushPosition(s,team,g.lane),h.p))return O(h,'push',{lane:g.lane});return travel(s,h,g.p);});
 const savedEscort=history.escort;preds.push(responsePrediction(s,enemy,provisional));history.escort=savedEscort;
 const goalP=(h,n=s)=>{const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'};if(g.kind==='lane')return G.pushPosition(n,team,g.lane);if(g.kind==='escort'){const t=n.heroes.find(x=>x.id===g.unit);if(t?.alive)return t.p;}return g.p;};
 let simCount=0;
 function value(n,orders){
  if(n.result)return n.result.winner===team?1e7:n.result.winner===enemy?-1e7:0;
  let v=0;const alive=n.heroes.filter(h=>h.alive),nf=G.fronts(n);
  for(const h of n.heroes){
   const old=oldByID[h.id],us=h.team===team,sign=us?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sign*(h.gold-old.gold)*(Q.roleMoney?w:1)*1.25;
   if(!h.alive){if(old.alive)v-=sign*(220+Math.min(170,r)+h.gold*.035)*w*Math.min(1,Math.max(1,s.config.maxTurns+1-r)/16);continue;}
   const fraction=h.hp/h.maxHP*Math.min(1,Math.max(0,s.config.maxTurns-r)/12);
   v+=sign*fraction*(110+h.maxHP*.045)*w;
   if(h.stunUntil>=n.turn+1)v-=sign*18*w;
   if(h.attackReady>n.turn+1)v-=sign*5*w;
   if(us){
    const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'},p=goalP(h,n),d=distance(h,p),coef=g.kind==='defend'?65:g.kind==='ancient'?30:g.kind==='camp'?19:g.kind==='escort'?12:23;
    v-=Math.max(0,d-(g.kind==='escort'?1:0))*coef;
    const nextDanger=danger(n,h,h.p,n.turn+1),support=alive.find(t=>t.role==='support'&&t.team===team&&G.engagementCanUtility(n,t,h,'heal'));
    const net=Math.max(0,nextDanger-(support&&support.stunUntil<n.turn+1?support.heal*.6:0));
    v-=net*.025*w*Math.min(1,1100/h.maxHP)*Q.risk+Math.max(0,net*1.25-h.hp)/Math.max(1,h.maxHP)*250*w;
   }
   const preferred=G.roleLane(h.role),eligible=nf.filter(f=>f.team===h.team&&f.cells.some(p=>eq(p,h.p))&&(n.turn+1>40||f.lane===preferred));
   for(const f of eligible){const members=alive.filter(a=>a.team===h.team&&f.cells.some(p=>eq(p,a.p))&&(n.turn+1>40||G.roleLane(a.role)===f.lane)),den=Math.max(1,members.reduce((v,a)=>v+(a.role==='support'?.25:1),0));let income=12*(h.role==='support'?.25:1)/den+(h.role==='adc'?s.config.adcLaneFlat:0);if(h.role==='support'&&members.some(a=>a.role==='adc'))income*=1.5;v+=sign*income*w*1.8;}
   if(us&&n.turn+1>s.config.laneLock){const bestFuture=Math.max(0,...nf.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>qIncome({...n,fronts:nf,decisionTurn:n.turn+1},h,p)/(G.dist(h,p)+1))));v+=bestFuture*Q.future;}
  }
  for(const b of n.buildings){const old=s.buildings.find(x=>x.id===b.id),sign=b.team===team?-1.2:1;v+=sign*(old.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);if(old.hp>0&&b.hp<=0)v+=sign*50;}
  for(const e of n.events){
   if(e.kind==='invalid'&&e.unit[0]===team)v-=30;
   if(e.kind==='ancient_progress'&&e.damage){const c=n.camps.find(c=>c.id===e.target);if(c.alive)v+=(e.counts[team]>e.counts[enemy]?1:e.counts[team]<e.counts[enemy]?-1:0)*120;}
  }
  return v;
 }
 function sim(orders,ps){simCount++;return G.simulate(s,{[team]:{orders},[enemy]:{orders:ps}},'public-simulation-'+r+'-'+JSON.stringify(ps));}
 const scoreCache=new Map(),predictionKeys=preds.map(ps=>JSON.stringify(ps));
 function score(orders){
  const key=JSON.stringify(orders);if(scoreCache.has(key))return scoreCache.get(key);
  const cases=new Map(),values=preds.map((ps,i)=>{const k=predictionKeys[i];if(!cases.has(k))cases.set(k,value(sim(orders,ps),orders));return cases.get(k);});
  const base=.65*(values[0]+values[1])/2+.35*Math.min(values[0],values[1]);const old=.8*base+.2*values[2];const v=.65*old+.25*values[3]+.1*Math.min(old,values[3]);scoreCache.set(key,v);return v;
 }
 const opts=me.map(h=>{
  const allowed=G.engageAllowedActions(s,h,r),out=[O(h,'wait')],has=a=>allowed.includes(a);
  if(has('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(has('teleport'))for(const t of G.teleportTargets(s,h,r))if(!eq(h.p,t.p))out.push(O(h,'teleport',{to:t.p.slice()}));
  if(has('recall')&&h.hp<h.maxHP*.85&&!G.threatened(s,h))out.push(O(h,'recall'));
  out.push(...v2CombatOptions(s,h,foes,preds));
  if(has('heal'))for(const a of me)if(a.hp<a.maxHP&&G.dist(a,h)<=2||a.hp<a.maxHP&&G.sameEngagement(s,h,a))out.push(O(h,'heal',{target:a.id}));
  if(has('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  if(has('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(c.kind==='ancient'||h.role!=='support'))out.push(O(h,'capture',{target:c.id}));
  if(has('push'))for(const f of fs)if(eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  return out;
 });
 let orders=me.map((h,i)=>{
  const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;
  if(opts[i].length===1)return opts[i][0];
  if(g.kind==='lane'){const push=opts[i].find(o=>o.action==='push'&&o.lane===g.lane);if(push)return push;}
  if(g.kind==='ancient'||g.kind==='camp'){const cap=opts[i].find(o=>o.action==='capture'&&o.target===g.id);if(cap)return cap;if(eq(h.p,g.p))return O(h,'wait');}
  return travel(s,h,goalP(h));
 });
 let best=score(orders);
 // Joint actions cross count thresholds that single-coordinate search cannot cross.
 for(const f of fs){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='push'&&o.lane===f.lane));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length);mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'push',{lane:f.lane});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 for(const c of s.camps.filter(c=>c.kind==='ancient'&&c.alive)){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='capture'&&o.target===c.id));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length);mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'capture',{target:c.id});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 const sequence=me.map((h,i)=>i).sort((a,b)=>['support','adc','mid','top','jungle'].indexOf(me[a].role)-['support','adc','mid','top','jungle'].indexOf(me[b].role));
 for(let pass=0;pass<2;pass++){let changed=false;for(const i of sequence){let chosen=orders[i];for(const o of opts[i]){const trial=orders.slice();trial[i]=o;const v=score(trial);if(v>best+.0001){chosen=o;best=v;}}if(chosen!==orders[i])changed=true;orders[i]=chosen;}if(!changed)break;}
 // Compare engaging with continuing the chosen macro orders, using actual simultaneous rules.
 const ji=me.findIndex(h=>h.role==='jungle');
 if(ji>=0&&G.engageCanCast(s,me[ji],r)){
  const centers=foes.filter(h=>G.dist(h,me[ji])<=1).map(h=>h.p).filter((p,i,a)=>a.findIndex(q=>eq(p,q))===i);
  const combatValue=n=>n.heroes.reduce((v,h)=>{const sign=h.team===team?1:-1,w=(150+h.gold*.05+(h.role==='mid'?h.damage*1.5:h.role==='support'?h.heal:h.damage*.6));return v+sign*(h.alive?w*(1+h.hp/h.maxHP):0);},0);
  function rollout(first){let n=first;for(let k=0;k<5&&n.phase==='map'&&!n.result;k++){refresh(n);const commands={A:{orders:[]},B:{orders:[]}};for(const h of n.heroes.filter(h=>h.alive)){let o=combat(n,h);if(!G.engagementOf(n,h)&&o.action==='wait'){const g=h.team===team?goals[h.id]:null;o=g?travel(n,h,g.kind==='lane'?G.pushPosition(n,team,g.lane):g.p):predict(n,h.team,0).find(o=>o.unit===h.id)||o;}commands[h.team].orders.push(o);}n=G.step(n,commands);}return combatValue(n);}
  const baseline=centers.length?rollout(sim(orders,preds[0])):0;let bv=baseline+45,bo=null;
  for(const p of centers){const preview=G.previewEngage(s,me[ji],p);if(!preview)continue;const trial=me.map((h,i)=>i===ji?O(h,'engage',{to:p.slice()}):G.engagementOf(preview,preview.heroes.find(x=>x.id===h.id))?combat(preview,preview.heroes.find(x=>x.id===h.id)):orders[i]);const n=sim(trial,preds[0]),v=rollout(n);if(v>bv){bv=v;bo=trial;}}
  if(bo)orders=bo;
 }
 if(r>40&&me.filter(h=>qMemory.units[h.id]?.idle>=2&&qIncome(s,h,h.p)===0).length>=2){
  const actionFor=(n,h)=>{const co=combat(n,h);if(co.action!=='wait')return co;const g=goals[h.id];if(!g)return O(h,'wait');if(g.kind==='camp'||g.kind==='ancient'){const c=n.camps.find(c=>c.id===g.id);if(c?.alive&&eq(h.p,c.p))return O(h,'capture',{target:c.id});if(!c?.alive){const fs=G.fronts(n).filter(f=>f.team===h.team).sort((a,b)=>G.dist(h,a.p)-G.dist(h,b.p));return eq(h.p,fs[0].p)?O(h,'push',{lane:fs[0].lane}):travel(n,h,fs[0].p);}}const p=g.kind==='lane'?G.pushPosition(n,h.team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;return g.lane&&eq(h.p,G.pushPosition(n,h.team,g.lane))?O(h,'push',{lane:g.lane}):travel(n,h,p);};
  const planned=me.map(h=>actionFor(s,h));
  function rolloutScore(first,sample){let n=G.simulate(s,{[team]:{orders:first},[enemy]:{orders:preds[sample]}},'macro-commit-'+r+'-'+sample);for(let k=0;k<Q.rollout&&!n.result&&n.phase==='map';k++){refresh(n);const commands={};commands[team]={orders:n.heroes.filter(h=>h.alive&&h.team===team).map(h=>actionFor(n,h))};commands[enemy]={orders:predict(n,enemy,sample)};n=G.step(n,commands);}return value(n,first);}
  let a=0,b=0;for(let sample=0;sample<2;sample++){a+=rolloutScore(orders,sample);b+=rolloutScore(planned,sample);}if(b>a+10)orders=planned;
 }
 for(let i=0;i<me.length;i++){const h=me[i],recovery=qMemory.recovery?.[h.id];if(!recovery||qIncome(s,h,h.p)>0||G.engagementOf(s,h)||h.stunUntil>=r||h.engageRecoveryUntil>=r)continue;const o=orders[i],target=foes.find(t=>t.id===o.target),useful=['attack','reap','spell'].includes(o.action)&&(o.action==='spell'?o.cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(o.action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)))||o.action==='heal'&&me.some(a=>a.id===o.target&&a.hp<a.maxHP-.001)||o.action==='control'&&target&&G.engagementCanUtility(s,h,target,'control');if(useful)continue;const route=qRecoveryPath(s,h,recovery.p);if(route?.length>1&&qIncoming(s,h,route[1],true)<h.hp*.7)orders[i]=O(h,'move',{to:route[1]});}
 qFountainSally(s,me,foes,orders,r);
 return{orders};
}
module.exports.decide=function(s){if(s.phase==='final_battle')return arena(s);if(s.phase!=='map'||s.result)return{orders:[]};return macro(s);};


const __decide=module.exports.decide;module.exports.decide=function(obs){for(const c of obs.camps)if(c.kind==='ancient'&&!c.alive&&c.spawnAt===null)c.spawnAt=Number.MAX_SAFE_INTEGER;return __decide(obs);};

;return module.exports;}
function makeSelf(){const module={exports:{}};const exports=module.exports;const require=function(n){if(n==='./engine.cjs')return __G;throw new Error('Only ./engine.cjs');};
// Attribution: adapted from public hex-moba-contest policies (Sol V15 search core); new rules, skills, final solver and macro changes by this task.
'use strict';
const Q={"macro":"new","start":41,"future":4,"risk":1.05,"rollout":6,"roleMoney":false,"speculate":false},P={"travel":3,"structureCost":0.22,"crowd":8,"finish":95,"income":2,"moveRisk":0.7,"campRisk":8,"squad":2,"split":false,"counter":false,"carryLate":true,"jungleFarm":true,"resource":1.65,"notice":5,"resourceSquad":4,"resourceRatio":0.85,"resourcePatience":5,"resourceAvoid":9,"idleLimit":4,"recall":0.3,"pushRisk":1,"engageRatio":1.05,"id":"resource_v2"};
'use strict';
// Sol V15 entrant v3. Reuses public policies/sol_ref.cjs (frozen-sol-v7).
// Changes: resource staffing, cooperative push/capture, expected tied rewards, proactive defense.
const G=require('./engine.cjs');
const PLAN={"mode":"split","rotate":40,"jungle":"farm","primary":"bottom","dynamicLane":false,"routeHP":0.4,"routeDistance":4,"routeThreat":0.02,"campRisk":6,"invade":0,"anticipate":3,"ancientRisk":2,"ancientHelp":[],"helpRange":4,"helpThreat":1,"rotateOpened":true,"reactCluster":[],"defend":true,"defendHP":18,"gold":1.0,"hp":1.0,"death":1.0,"position":1.2,"tower":3.5,"base":1.5,"ancient":1.0,"income":1.0,"passes":2};
const relativeID=(team,id)=>team==='A'?id:id.replace(/^[AB]_/,m=>m==='A_'?'B_':'A_');
const localNeighbors=(team,p)=>G.neighbors('A',team==='A'?p:p.map(v=>-v)).map(q=>team==='A'?q:q.map(v=>-v));
const K=p=>p.join(','), eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const cells=G.CELLS, ix=new Map(cells.map((p,i)=>[K(p),i]));
const adj=cells.map(p=>G.neighbors('A',p).map(q=>ix.get(K(q))));
const terrain=cells.map(p=>G.isLane(p));
const dd=cells.map((p,i)=>{const d=Array(cells.length).fill(99),q=[i];d[i]=0;for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(d[j]===99){d[j]=d[q[n]]+1;q.push(j);}return d;});
const distance=(a,b)=>dd[ix.get(K(a.p||a))][ix.get(K(b.p||b))];
const canHit=(a,b)=>G.dist(a,b)<=1&&(terrain[ix.get(K(a.p||a))]||!terrain[ix.get(K(b.p||b))]);
const order=(h,action,extra)=>({unit:h.id,action,...extra});
const valueRole={top:1,mid:1.35,adc:1.5,support:1,jungle:1.12};

// Fixed-order final arena, explicit adversarial prefix and several continuation policies.
/* Final solver and tactics are defined below. */
let history={turn:0,units:{},escort:null};
// Opponent-model hook (set by the outer glue each map turn): exact predicted enemy orders when a behaviour model is confident.
let EXACT={on:false,orders:null,seeds:3};
const __late=()=>!!EXACT.deadline&&Date.now()>EXACT.deadline;
module.exports.__setExact=function(x){EXACT=x||{on:false,orders:null,seeds:3};};
const O=(h,action,more={})=>({unit:h.id,action,...more});
function refresh(s){s.decisionTurn=s.turn+1;s.fronts=G.fronts(s);for(const h of s.heroes)Object.assign(h,G.stats(h,s.config));return s;}
function track(s){
 if(s.decisionTurn<=history.turn)history={turn:0,units:{},escort:null};
 for(const h of s.heroes.filter(h=>h.team!==s.you)){
  const m=history.units[h.id]||{lane:G.roleLane(h.role),last:'move',push:0,attack:0,capture:0,engage:0};
  for(const k of ['push','attack','capture','engage'])m[k]*=.96;
  for(const e of s.events||[]){
   let a=null;
   if(e.kind==='push_contest'&&(e.sources?.[h.team]||[]).includes(h.id)){a='push';m.lane=e.lane;}
   if(e.kind==='ancient_progress'&&e.sources.includes(h.id))a='capture';
   if(e.source===h.id||e.unit===h.id){
    if(e.kind==='hit')a=e.attackType==='capture'?'capture':'attack';
    if(['aoe','engage_aoe','spell','reap'].includes(e.kind))a='attack';
    if(['move','teleport','recall','heal','control'].includes(e.kind))a=e.kind;
    if(e.kind==='engage_cast')a='engage';
   }
   if(a){m.last=a;if(m[a]!==undefined)m[a]++;}
  }
  const f=s.fronts.filter(f=>f.team===h.team).sort((a,b)=>distance(h,a.p)-distance(h,b.p));
  if(s.decisionTurn>40&&m.last==='move'&&distance(h,f[0].p)<2)m.lane=f[0].lane;
  m.stationary=m.p&&eq(m.p,h.p)?(m.stationary||0)+1:0;if(m.stationary>=2&&!(s.events||[]).some(e=>(e.unit===h.id||e.source===h.id)&&['move','teleport','recall','hit','heal','control','engage_cast'].includes(e.kind)))m.last='wait';m.oldP=m.p;m.p=h.p.slice();history.units[h.id]=m;
 }
 history.turn=s.decisionTurn;
}
function danger(s,h,p,r=s.turn+1){return v2Incoming(s,h,p,r);}
function travel(s,h,p){
 if(eq(h.p,p))return O(h,'wait');
 const ns=localNeighbors(h.team,h.p);ns.sort((a,b)=>distance(a,p)-distance(b,p)||danger(s,h,a)-danger(s,h,b)||K(h.team==='A'?a:a.map(v=>-v)).localeCompare(K(h.team==='A'?b:b.map(v=>-v))));
 return ns.length?O(h,'move',{to:ns[0]}):O(h,'wait');
}
// New-version tactics. Shared by the three documented baseline families.
function v2CombatOptions(s,h,foes,predicted=[]){
 const r=s.turn+1,a=G.engageAllowedActions(s,h,r),out=[];if(Q.speculate===false&&!EXACT.on)predicted=[];
 if(a.includes('attack'))for(const t of foes)if(G.canHeroAttack(h,t,s)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canHeroAttack(h,{...t,p:o.to},s))))out.push(O(h,'attack',{target:t.id}));
 if(a.includes('reap'))for(const t of foes)if(G.canReap(s,h,t)||predicted.some(os=>os.some(o=>o.unit===t.id&&o.action==='move'&&G.canReap(s,h,{...t,p:o.to}))))out.push(O(h,'reap',{target:t.id}));
 if(a.includes('spell'))for(const cells of G.spellTargets(s,h))if(foes.some(t=>cells.some(p=>eq(p,t.p)))||predicted.some(os=>os.some(o=>o.unit[0]!==h.team&&o.action==='move'&&cells.some(p=>eq(p,o.to)))))out.push(O(h,'spell',{cells}));
 return out;
}
function v2Incoming(s,h,p,r=s.turn+1){
 let sum=0;
 for(const t of s.heroes.filter(t=>t.alive&&t.team!==h.team&&t.role!=='support'&&t.stunUntil<r)){
  const victim={...h,p},basic=G.canHeroAttack(t,victim,s)?t.damage:0;
  const reap=t.role==='adc'&&t.reapReady<=r&&G.canReap(s,t,victim)?Math.floor(t.damage*s.config.reapMultiplier):0;
  const spell=t.role==='mid'&&t.spellReady<=r&&G.spellTargets(s,t).some(cells=>cells.some(q=>eq(q,p)))?t.damage:0;
  sum+=Math.max(basic,reap,spell);
 }
 return sum;
}
function combat(s,h,mode=0){
 const r=s.turn+1,all=s.heroes.filter(x=>x.alive&&x.team===h.team),foes=s.heroes.filter(x=>x.alive&&x.team!==h.team),wait=O(h,'wait'),allowed=G.engageAllowedActions(s,h,r);
 if(!h.alive||h.stunUntil>=r)return wait;
 if(h.engageRecoveryUntil>=r){if(allowed.includes('recall')&&h.hp<h.maxHP*.6&&!G.threatened(s,h))return O(h,'recall');return wait;}
 const threat=t=>t.role==='support'?t.heal*1.4:t.damage*(t.role==='mid'?1.4:t.role==='adc'?1.18:1);
 const harm=(t,power)=>Math.min(power,t.hp)*(.5+threat(t)/Math.max(100,t.maxHP))+(t.hp<=power?280+threat(t)*1.5+t.gold*.04:0);
 let best=wait,bv=0;
 if(h.role==='support'){
  for(const t of all)if(G.engagementCanUtility(s,h,t,'heal')){const n=Math.min(h.heal,t.maxHP-t.hp),danger=v2Incoming(s,t,t.p,r),v=n*(.8+(t.role==='mid'?.35:t.role==='adc'?.3:0))+(t.hp<=danger&&t.hp+n>danger?200+threat(t):0);if(v>bv){bv=v;best=O(h,'heal',{target:t.id});}}
  if(allowed.includes('control'))for(const t of foes)if(t.stunUntil<r+1&&G.engagementCanUtility(s,h,t,'control')){const v=threat(t)*.9;if(v>bv){bv=v;best=O(h,'control',{target:t.id});}}
  return bv>5?best:wait;
 }
 for(const o of v2CombatOptions(s,h,foes)){
  let v=0;
  if(o.action==='spell'){const targets=foes.filter(t=>o.cells.some(p=>eq(p,t.p)));v=targets.reduce((n,t)=>n+harm(t,h.damage),0)-h.damage*.12;}
  else{const t=foes.find(t=>t.id===o.target),power=o.action==='reap'?Math.floor(h.damage*s.config.reapMultiplier):h.damage;v=harm(t,power)-(o.action==='reap'&&t.hp>power?h.damage*.08:0);if(mode===1)v+=power/(1+t.hp/Math.max(1,power));}
  if(v>bv){bv=v;best=o;}
 }
 return best;
}

// Final combat uses the actual new engine, not the old forced-mid-wait approximation.
function arena(s){
 const d=s.finalDecision;if(!d||d.team!==s.you)return{orders:[]};const actor=s.heroes.find(h=>h.id===d.actor);
 if(d.forcedWait)return{orders:[O(actor,'wait')]};
 const team=s.you,opp=G.enemy(team),base={phase:'final_battle',turn:s.turn,mapTurn:s.mapTurn,version:s.version,config:s.config,heroes:G.clone(s.heroes),battle:G.clone(s.battle),teams:G.clone(s.teams),events:[],orders:{A:[],B:[]},result:null};
 function options(n){
  const dd=G.finalDecision(n),h=n.heroes.find(x=>x.id===dd.actor),friends=n.heroes.filter(x=>x.alive&&x.team===h.team),foes=n.heroes.filter(x=>x.alive&&x.team!==h.team),out=[];
  if(dd.forcedWait)return[O(h,'wait')];
  for(const a of dd.legalActions){if(a==='spell')out.push(O(h,'spell'));else if(a==='attack'||a==='reap'||a==='control'){for(const t of foes)if(a!=='control'||!n.battle.skip[t.id])out.push(O(h,a,{target:t.id}));}else if(a==='heal'){for(const t of friends)if(t.hp<t.maxHP)out.push(O(h,'heal',{target:t.id}));}}
  return out.length?out:[O(h,'wait')];
 }
 function value(n,side){
  if(n.result)return n.result.winner===side?1e8:-1e8;
  let v=0;
  for(const h of n.heroes){const sign=h.team===side?1:-1,p=h.role==='support'?h.heal*1.35:h.damage*(h.role==='mid'?1.5:h.role==='adc'?1.12:1),w=150+p*.8+h.gold*.035;
   if(h.alive){v+=sign*(w*(.55+h.hp/h.maxHP*.45)+Math.sqrt(h.hp)*.5);if(n.battle.skip[h.id])v-=sign*p*.35;}}
  return v;
 }
 function step(n,o){return G.stepFinalBattle(n,{[o.unit[0]]:{orders:[o]}});}
 function ranked(n,limit){const side=n.battle.actor[0];return options(n).map(o=>{const child=step(n,o);return{o,n:child,v:value(child,side)};}).sort((a,b)=>b.v-a.v||JSON.stringify(a.o).localeCompare(JSON.stringify(b.o))).slice(0,limit);}
 const roots=ranked(base,Math.min(7,options(base).length));let best=roots[0].o,bv=-Infinity;
 for(const candidate of roots){let n=candidate.n;for(let k=0;k<22&&!n.result;k++)n=ranked(n,1)[0].n;const v=value(n,team)*.85+candidate.v*.15;if(v>bv){bv=v;best=candidate.o;}}
 return{orders:[best]};
}

function originalAssignments(s,team){
 const r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),fs=s.fronts.filter(f=>f.team===team),g={},byRole=Object.fromEntries(me.map(h=>[h.role,h])),opened=G.openedLanes(s,team);
 const front=l=>fs.find(f=>f.lane===l),risk=(h,p)=>danger(s,h,p)/Math.max(200,h.maxHP);
 function route(h){return fs.filter(f=>!opened.includes(f.lane)).sort((a,b)=>(distance(h,a.p)*5+risk(h,a.p)*8+s.buildings.filter(b=>b.team!==team&&b.lane===a.lane).reduce((v,b)=>v+b.hp,0)*.2)-(distance(h,b.p)*5+risk(h,b.p)*8+s.buildings.filter(t=>t.team!==team&&t.lane===b.lane).reduce((v,b)=>v+b.hp,0)*.2))[0]?.lane;}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>40&&opened.includes(lane)&&opened.length<1&&h.role!=='mid')lane=route(h)||lane;g[h.id]={kind:'lane',lane,p:front(lane).p};}
 const j=byRole.jungle;
 let ancient=null;
 if(j){
  const opts=s.camps.filter(c=>c.kind==='ancient'&&(c.alive||c.spawnAt<=r+distance(j,c)+3)).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*2})).sort((a,b)=>a.v-b.v);
  ancient=opts[0]?.c;
  if(ancient)g[j.id]={kind:'ancient',p:ancient.p,id:ancient.id};
  else {
   const cs=s.camps.filter(c=>c.kind==='normal'&&(c.alive||c.spawnAt<=r+distance(j,c))).map(c=>({c,v:distance(j,c)+Math.max(0,(c.spawnAt||r)-r-distance(j,c))+risk(j,c.p)*4})).sort((a,b)=>a.v-b.v||relativeID(team,a.c.id).localeCompare(relativeID(team,b.c.id)));
   if(cs[0])g[j.id]={kind:'camp',p:cs[0].c.p,id:cs[0].c.id};
  }
 }
 const sup=byRole.support;
 if(sup&&r>40){
  const options=me.filter(h=>h.role!=='support'&&h.role!=='jungle').map(h=>({h,v:danger(s,h,h.p)/Math.max(1,h.maxHP)*2+(1-h.hp/h.maxHP)*.5+(h.role==='mid'?.15:0)-distance(sup,h)*.07+(history.escort===h.role?.12:0)})).sort((a,b)=>b.v-a.v);
  const escort=options[0]?.h;
  if(escort){history.escort=escort.role;g[sup.id]={kind:'escort',p:escort.p,unit:escort.id,lane:g[escort.id]?.lane};}
 }
 if(ancient&&r>40){
  const remaining=ancient.alive?ancient.hp:4;
  const eta=Math.max(0,(ancient.spawnAt||r)-r)+remaining;
  const relevant=foes.filter(h=>distance(h,ancient)<=Math.min(6,eta+2));
  const enemyCount=relevant.reduce((n,h)=>n+(h.role==='jungle'?2:1),0);
  const helpers=me.filter(h=>!['jungle','adc'].includes(h.role)&&distance(h,ancient)<=6&&h.hp>h.maxHP*.45).sort((a,b)=>{
   const cost=h=>distance(h,ancient)+(h.role==='support'?-1.6:h.role==='mid'?1.8:0)+(1-h.hp/h.maxHP)*3;
   return cost(a)-cost(b);
  });
  const need=Math.max(0,Math.min(2,enemyCount-1));
  for(const h of helpers.slice(0,need))g[h.id]={kind:'ancient',p:ancient.p,id:ancient.id};
 }
 const base=s.buildings.find(b=>b.id===team+'_base'),openAgainst=G.openedLanes(s,G.enemy(team));
 if(openAgainst.length){
  const lanes=fs.filter(f=>openAgainst.includes(f.lane)).map(f=>({f,ef:s.fronts.find(e=>e.team!==team&&e.lane===f.lane),attackers:foes.filter(h=>distance(h,base)<=3&&G.PATHS[f.lane].some(p=>eq(p,h.p)))})).sort((a,b)=>b.attackers.length-a.attackers.length);
  const bad=lanes.find(x=>x.attackers.length&&distance(x.ef.p,base)<=2);
  if(bad){
   const cap=Math.max(1,bad.attackers.reduce((n,h)=>n+G.towerDamage(h,s.config),0));
   const urgency=base.hp/(cap*Math.max(1,bad.attackers.length));
   const defenders=me.filter(h=>h.role!=='adc').sort((a,b)=>{
    const cost=h=>distance(h,bad.f.p)*5-(h.role==='mid'?12:h.role==='support'?8:0)-h.hp/h.maxHP*3;
    return cost(a)-cost(b);
   });
   const needed=Math.min(defenders.length,urgency<10?3:2);
   for(const h of defenders.slice(0,needed))g[h.id]={kind:'defend',lane:bad.f.lane,p:bad.f.p};
  }
 }

 return g;
}

function qForecast(s,h,p){let damage=0;for(const e of s.heroes.filter(e=>e.alive&&e.team!==h.team&&e.role!=='support'&&e.stunUntil<s.decisionTurn+1)){if(G.canHeroAttack(e,{...h,p},s))damage+=e.damage;else if(G.neighbors(e.team,e.p).some(q=>G.canHeroAttack({...e,p:q},{...h,p},s)))damage+=e.damage*.4;}return damage;}
function qRecoveryPath(s,h,target){const nodes=G.CELLS,distances=new Map([[G.key(h.p),0]]),previous=new Map(),open=[h.p],closed=new Set();while(open.length){open.sort((a,b)=>(distances.get(G.key(a))||0)-(distances.get(G.key(b))||0));const p=open.shift(),k=G.key(p);if(closed.has(k))continue;closed.add(k);if(eq(p,target)){const out=[p];while(previous.has(G.key(out[0])))out.unshift(previous.get(G.key(out[0])));return out;}for(const q of G.neighbors(h.team,p)){const current=qIncoming(s,h,q,true),future=qForecast(s,h,q),cost=distances.get(k)+1+current/Math.max(1,h.hp)*8+future/Math.max(1,h.maxHP)*3,kk=G.key(q);if(cost<(distances.get(kk)??Infinity)){distances.set(kk,cost);previous.set(kk,p);open.push(q);}}}return null;}
function qRecoveryGoal(s,h){const choices=s.fronts.filter(f=>f.team===h.team&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane)).flatMap(f=>f.cells.map(p=>{const path=qRecoveryPath(s,h,p),danger=path?.[1]?qIncoming(s,h,path[1],true):0;return{p,lane:f.lane,path,danger,value:qIncome(s,h,p)*10/Math.max(1,path?.length||99)-qForecast(s,h,p)/Math.max(1,h.maxHP)*30-danger/Math.max(1,h.hp)*30};})).filter(x=>x.path&&x.danger<h.hp*.7).sort((a,b)=>b.value-a.value);return choices[0];}
function assignments(s,team){
 if(team!==s.you)return originalAssignments(s,team);
 const candidate=qMacro(s),native=originalAssignments(s,team),goals=s.decisionTurn<Q.start||Q.macro==='native'?native:candidate;
 qMemory.recovery||={};
 for(const h of s.heroes.filter(h=>h.alive&&h.team===team)){
  const m=qMemory.units[h.id],r=s.decisionTurn;let recovery=qMemory.recovery[h.id];
  if(recovery&&(r>recovery.until||qIncome(s,h,h.p)>0)){delete qMemory.recovery[h.id];recovery=null;}
  if(!recovery&&m?.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&r>s.config.laneLock&&!G.engagementOf(s,h)){const best=qRecoveryGoal(s,h);if(best){recovery={p:best.p,lane:best.lane,until:r+10};qMemory.recovery[h.id]=recovery;}}
  if(recovery)goals[h.id]={kind:'recover-economy',lane:recovery.lane,p:recovery.p};
  if(goals[h.id]?.lane&&!['ancient','camp','escort','recover-economy'].includes(goals[h.id].kind))goals[h.id].kind='lane';
 }
 // Gank intent: when an ally laner is already trading with an enemy that our laner(s) plus the jungler can finish
 // within about two turns, walk the jungler to a lane cell next to that enemy (jungle cells cannot hit lane targets).
 if(EXACT.gank){const r=s.decisionTurn,j=s.heroes.find(h=>h.alive&&h.team===team&&h.role==='jungle'),jg=j&&goals[j.id];
  if(j&&!G.engagementOf(s,j)&&j.stunUntil<r&&!(j.engageRecoveryUntil>=r)&&(!jg||jg.kind==='camp'||jg.kind==='lane')){
   let best=null;
   for(const e of s.heroes.filter(e=>e.alive&&e.team!==team&&G.isLane(e.p))){
    const mates=s.heroes.filter(h=>h.alive&&h.team===team&&h.role!=='support'&&h.id!==j.id&&G.canHeroAttack(h,e,s));
    if(!mates.length)continue;const dmg=mates.reduce((n,h)=>n+h.damage,0);if(e.hp>dmg*2+j.damage)continue;
    for(const c of cells)if(terrain[ix.get(K(c))]&&G.dist(c,e.p)<=1){const d=distance(j,c);if(d>2)continue;const v=d*100+e.hp/Math.max(1,e.maxHP)*50-(e.role==='adc'?25:e.role==='mid'?20:0);if(!best||v<best.v)best={v,p:c,e};}
   }
   if(best)goals[j.id]={kind:'gank',p:best.p.slice(),unit:best.e.id};
  }}
 return goals;
}
function predict(s,team,mode=0){
 const r=s.turn+1,hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team);
 return hs.map(h=>{
  const m=history.units[h.id],locked=G.engagementOf(s,h)||h.engageRecoveryUntil>=r;
  const co=combat(s,h,mode);if(h.stunUntil>=r||locked)return co;
  if(h.hp<h.maxHP*.28&&!G.threatened(s,h))return O(h,'recall');
  let lane=r<=40?G.roleLane(h.role):m?.lane||G.roleLane(h.role);lane=lane||'mid';
  const f=s.fronts.find(f=>f.team===team&&f.lane===lane);
  if(mode===1&&eq(h.p,f.p)&&m?.push>m?.attack*.65&&co.action!=='heal')return O(h,'push',{lane});
  if(co.action!=='wait')return co;
  if(h.role==='jungle'){
   const cs=s.camps.filter(c=>c.alive||c.spawnAt<=r+distance(h,c)+1).map(c=>({c,v:distance(h,c)+(c.kind==='ancient'?-5:0)+Math.max(0,(c.spawnAt||r)-r-distance(h,c))+danger(s,h,c.p)/Math.max(1,h.maxHP)*3})).sort((a,b)=>a.v-b.v);
   if(cs.length)return eq(h.p,cs[0].c.p)?cs[0].c.alive?O(h,'capture',{target:cs[0].c.id}):O(h,'wait'):travel(s,h,cs[0].c.p);
  }
  if(eq(h.p,f.p))return O(h,'push',{lane});return travel(s,h,f.p);
 });
}

function motionPrediction(s,team){
 const r=s.turn+1,defaultOrders=predict(s,team,0);
 return defaultOrders.map(o=>{
  const h=s.heroes.find(h=>h.id===o.unit),m=history.units[h.id];
  if(!m||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h)||o.action==='heal')return o;if(m.last==='wait'&&m.stationary>=2&&combat(s,h).action==='wait')return O(h,'wait');
  // A move during attack cooldown is weak evidence for retreat when the attack has just recovered.
  if(['attack','spell','reap'].includes(o.action))return o;
  const camp=s.camps.find(c=>c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'));
  if(camp&&(h.role==='jungle'||m.last==='capture'))return O(h,'capture',{target:camp.id});
  if(m.last==='move'&&m.oldP&&G.dist(m.oldP,m.p)===1){
   const next=[h.p[0]+m.p[0]-m.oldP[0],h.p[1]+m.p[1]-m.oldP[1]],f=s.fronts.find(f=>f.team===team&&f.lane===(m.lane||G.roleLane(h.role)||'mid'));
   if(G.valid(next)&&!eq(h.p,f.p)&&(!s.camps.some(c=>eq(c.p,h.p)&&c.alive)||h.role==='support')){
    if(distance(next,f.p)<distance(h,f.p)||danger(s,h,next)<danger(s,h,h.p))return O(h,'move',{to:next});
   }
  }
  if(h.hp<h.maxHP*.55&&danger(s,h,h.p)>h.hp*.55){
   const choices=localNeighbors(team,h.p).map(p=>({p,v:danger(s,h,p)+distance(p,G.FOUNTAIN[team])*h.maxHP*.025})).sort((a,b)=>a.v-b.v);
   if(choices.length&&danger(s,h,choices[0].p)<danger(s,h,h.p)*.55)return O(h,'move',{to:choices[0].p});
  }
  return o;
 });
}

// A generic best response hypothesis, using only legal public-state outcomes.
function responsePrediction(s,team,ours){
 const r=s.turn+1,gs=assignments(s,team),hs=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),old=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const active=h=>G.engageAllowedActions(s,h,r);
 const options=h=>{
  const a=active(h),out=[O(h,'wait')];
  if(a.includes('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(a.includes('teleport'))for(const b of G.teleportTargets(s,h,r))out.push(O(h,'teleport',{to:b.p}));
  if(a.includes('recall')&&!G.threatened(s,h)&&h.hp<h.maxHP*.85)out.push(O(h,'recall'));
  if(a.includes('push'))for(const f of s.fronts)if(f.team===team&&eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  if(a.includes('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(h.role!=='support'||c.kind==='ancient'))out.push(O(h,'capture',{target:c.id}));
  out.push(...v2CombatOptions(s,h,foes,[ours]));
  if(a.includes('heal'))for(const t of hs)if(t.hp<t.maxHP&&G.dist(h,t)<=2||t.hp<t.maxHP&&G.sameEngagement(s,h,t))out.push(O(h,'heal',{target:t.id}));
  if(a.includes('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  return out;
 };
 let os=predict(s,team,0);
 function value(n){
  if(n.result)return n.result.winner===team?1e7:n.result.winner?-1e7:0;
  const nf=G.fronts(n);let v=0;
  for(const h of n.heroes){
   const o=old[h.id],sg=h.team===team?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sg*(h.gold-o.gold)*w*1.25;
   if(!h.alive){if(o.alive)v-=sg*(240+Math.min(r,170)+h.gold*.04)*w;continue;}
   v+=sg*h.hp/h.maxHP*(130+h.maxHP*.045)*w;
   if(h.stunUntil>=r+1)v-=sg*20*w;
   if(h.attackReady>r+1)v-=sg*5*w;
   if(h.team===team){const g=gs[h.id];let p=g.kind==='lane'||g.kind==='defend'?G.pushPosition(n,team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;
    v-=Math.max(0,distance(h,p)-(g.kind==='escort'?1:0))*(g.kind==='defend'?60:g.kind==='ancient'?27:g.kind==='camp'?19:23);
    v-=Math.max(0,danger(n,h,h.p,r+1)*1.15-h.hp)/h.maxHP*300;
   }
  }
  for(const b of n.buildings){const o=s.buildings.find(x=>x.id===b.id);v+=(b.team===team?-1.2:1)*(o.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);}
  for(const e of n.events){if(e.kind==='invalid'&&e.unit[0]===team)v-=30;if(e.kind==='ancient_progress'&&e.damage&&n.camps.find(c=>c.id===e.target).alive)v+=(e.counts[team]>e.counts[G.enemy(team)]?1:e.counts[team]<e.counts[G.enemy(team)]?-1:0)*100;}
  return v;
 }
 for(let i=0;i<hs.length;i++){
  let best=os[i],bv=-Infinity;
  for(const a of options(hs[i])){os[i]=a;const n=G.step(s,{[team]:{orders:os},[G.enemy(team)]:{orders:ours}}),v=value(n);if(v>bv+.0001){bv=v;best=a;}}
  os[i]=best;
 }
 return os;
}


// Local benchmark policy. Only public observations and self-chosen simulation seeds.
const qEq=(a,b)=>G.key(a.p||a)===G.key(b.p||b),qD=(a,b)=>G.dist(a,b),qOrder=(h,action,extra={})=>({unit:h.id,action,...extra});
let qMemory={turn:0,units:{},avoid:{},targets:{}};
const roleWeight={top:1,mid:1.35,adc:1.55,support:.9,jungle:1.15};
function qPower(h){return h.role==='support'?h.heal*.85:h.damage*.6;}
function qIncome(s,h,p,all=s.heroes){let total=0;for(const f of s.fronts.filter(f=>f.team===h.team&&f.cells.some(x=>qEq(x,p))&&(s.decisionTurn>s.config.laneLock||G.roleLane(h.role)===f.lane))){const members=all.filter(x=>x.alive&&x.team===h.team&&(x.id===h.id||f.cells.some(p=>qEq(x,p)))&&(s.decisionTurn>s.config.laneLock||G.roleLane(x.role)===f.lane)),den=Math.max(1,members.reduce((v,x)=>v+(x.role==='support'?.25:1),0));let n=s.config.laneGold*(h.role==='support'?.25:1)/den;if(h.role==='adc')n+=s.config.adcLaneFlat;if(h.role==='support'&&members.some(x=>x.role==='adc'))n*=1+s.config.supportWithAdcLaneBonus;total+=n;}return total;}
function qIncoming(s,h,p,readyOnly=false){return v2Incoming(s,h,p,s.decisionTurn);}
function qWalk(s,h,target){if(qEq(h,target))return qOrder(h,'wait');const route=G.pathTo(h.team,h.p,target);if(!route||route.length<2)return qOrder(h,'wait');const shortest=route.length-1,choices=G.neighbors(h.team,h.p).map(p=>({p,path:G.pathTo(h.team,p,target),risk:qIncoming(s,h,p,true)})).filter(x=>x.path&&x.path.length-1<=shortest);choices.sort((a,b)=>(a.path.length*23+Math.min(90,a.risk/Math.max(1,h.maxHP)*P.moveRisk*100))-(b.path.length*23+Math.min(90,b.risk/Math.max(1,h.maxHP)*P.moveRisk*100))||G.key(a.p).localeCompare(G.key(b.p)));return qOrder(h,'move',{to:choices[0]?.p||route[1]});}
function qMacro(s){
 const r=s.decisionTurn,team=s.you,enemy=G.enemy(team),me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),byRole=Object.fromEntries(me.map(h=>[h.role,h])),fronts=s.fronts.filter(f=>f.team===team),goals={},opened=G.openedLanes(s,team),base=s.buildings.find(b=>b.id===team+'_base');
 if(!me.length)return{};
 if(r<=qMemory.turn)qMemory={turn:0,units:{},avoid:{},targets:{}};
 for(const h of me){const m=qMemory.units[h.id]||{p:h.p,gold:h.gold,hp:h.hp,idle:0,loop:[],best:99,lastProgress:r};const productive=(s.events||[]).some(e=>(e.source===h.id&&((e.damage||e.amount||0)>0))||(e.awards||[]).some(a=>a.id===h.id&&a.amount>0)||(e.kind==='push_contest'&&(e.sources?.[team]||[]).includes(h.id)));m.idle=qEq(h.p,m.p)&&h.gold<=m.gold+1e-7&&!productive?m.idle+1:0;m.loop.push(G.key(h.p));if(m.loop.length>8)m.loop.shift();m.p=[...h.p];m.gold=h.gold;m.hp=h.hp;qMemory.units[h.id]=m;}
 qMemory.turn=r;
 const front=l=>fronts.find(f=>f.lane===l),laneCost=(h,l)=>{const f=front(l),bs=s.buildings.filter(b=>b.team!==team&&b.lane===l&&b.hp>0),enemyCount=foes.filter(e=>qD(e,f.p)<=1).length;return qD(h,f.p)*P.travel+bs.reduce((n,b)=>n+b.hp,0)*P.structureCost+enemyCount*P.crowd+(opened.includes(l)?-P.finish:0);};
 function farming(h,lane){const f=front(lane),cells=f.cells.map(p=>({p,v:qIncome(s,h,p)*P.income-qIncoming(s,h,p)/Math.max(1,h.maxHP)*16-qD(h,p)*2+(qEq(p,f.p)?2:0)})).sort((a,b)=>b.v-a.v);return{kind:'lane',lane,p:cells[0].p};}
 for(const h of me){let lane=G.roleLane(h.role)||'mid';if(r>s.config.laneLock&&opened.includes(lane)&&opened.length<1)lane=[...G.LANES].sort((a,b)=>laneCost(h,a)-laneCost(h,b))[0];goals[h.id]=farming(h,lane);}
 const j=byRole.jungle;
 if(j){const options=s.camps.filter(c=>c.kind==='normal').map(c=>{const travel=qD(j,c),wait=c.alive?0:Math.max(0,(c.spawnAt||r)-r-travel),risk=qIncoming(s,j,c.p)/Math.max(1,j.maxHP);return{c,v:48/(travel+wait+1)-risk*P.campRisk+(c.regionTeam===team?1:0)};}).filter(x=>x.c.alive||x.c.spawnAt<=r+qD(j,x.c)+3).sort((a,b)=>b.v-a.v);if(options[0])goals[j.id]={kind:'camp',p:options[0].c.p,id:options[0].c.id};}
 if(r>s.config.laneLock){
  const clustered=G.LANES.map(l=>({lane:l,n:foes.filter(h=>qD(h,front(l).p)<=2).length})).sort((a,b)=>b.n-a.n),available=[...G.LANES].sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b));
  let primary=available[0];if(P.counter&&clustered[0].n>=3)primary=available.find(l=>l!==clustered[0].lane)||primary;
  if(P.squad>=3){const roles=P.carryLate&&r<85?['top','mid','jungle','support']:['top','mid','support','adc','jungle'];let count=0;for(const role of roles){const h=byRole[role];if(!h)continue;if(role==='jungle'&&P.jungleFarm&&r<100)continue;if(count++>=P.squad)break;goals[h.id]={kind:'push',lane:primary,p:front(primary).p};}}
  if(P.split){for(const h of me.filter(h=>h.role!=='support'&&h.role!=='jungle')){const l=G.roleLane(h.role);const best=opened.includes(l)?available.find(l=>!opened.includes(l))||available[0]:l;goals[h.id]=farming(h,best);}}
 }
 if(r>s.config.laneLock&&opened.length){const lane=opened.slice().sort((a,b)=>laneCost(byRole.mid||me[0],a)-laneCost(byRole.mid||me[0],b))[0],n=P.split?3:4;const group=me.slice().sort((a,b)=>qD(a,front(lane).p)-qD(b,front(lane).p)||b.gold-a.gold).slice(0,n);for(const h of group)goals[h.id]={kind:'push',lane,p:front(lane).p};}
 // Resource assignments are short commitments with observable progress and explicit fallback.
 if(j){const candidates=s.camps.filter(a=>a.kind==='ancient'&&(a.alive||Number.isFinite(a.spawnAt)&&a.spawnAt!==null&&a.spawnAt<=r+qD(j,a)+P.notice)&&(qMemory.avoid[a.id]||0)<=r).map(a=>{const travel=qD(j,a),wait=a.alive?0:Math.max(0,a.spawnAt-r-travel),hp=a.maxHP||4,pool=a.goldPool||750;return{a,v:pool*P.resource/(travel+wait+hp+2)-Math.max(0,qIncoming(s,j,a.p)/Math.max(1,j.maxHP)-.5)*50};}).sort((a,b)=>b.v-a.v);
  const a=candidates[0]?.a;if(a){const until=a.alive?0:Math.max(0,a.spawnAt-r),near=foes.filter(h=>qD(h,a)<=Math.min(4,until+(a.maxHP||4)+1)),threat=near.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),roles=me.filter(h=>h.id!==j.id&&(!P.carryLate||h.role!=='adc')).sort((a1,b1)=>(qD(a1,a)+(a1.role==='support'?-.8:0))-(qD(b1,a)+(b1.role==='support'?-.8:0))),staff=[j];
   const needed=near.length?Math.min(P.resourceSquad,Math.max(2,near.length)):1;for(const h of roles){if(staff.length>=needed)break;if(qD(h,a)<=Math.min(7,until+(a.maxHP||4)+2)&&h.hp>=h.maxHP*.4)staff.push(h);}
   const own=staff.reduce((n,h)=>n+qPower(h)*Math.sqrt(h.hp/Math.max(1,h.maxHP)),0),key=staff.map(h=>h.id).sort().join(',')+'@'+(a.announcement?.cycle||0),target=qMemory.targets[a.id]||{key,best:99,last:r},distance=staff.reduce((n,h)=>n+qD(h,a),0),progress=(s.events||[]).some(e=>e.target===a.id&&e.kind==='ancient_progress'&&e.damage>0)||staff.some(h=>(s.events||[]).some(e=>e.source===h.id&&e.damage>0));
   if(key!==target.key||distance<target.best||progress){target.key=key;target.best=distance;target.last=r;}qMemory.targets[a.id]=target;
   if(r-target.last>P.resourcePatience){qMemory.avoid[a.id]=r+P.resourceAvoid;delete qMemory.targets[a.id];}
   else if(threat===0||own>=threat*P.resourceRatio||near.length===1&&staff.length>=2){for(const h of staff)goals[h.id]={kind:'ancient',id:a.id,p:a.p,group:staff.map(h=>h.id)};}
  }
 }
 if(byRole.support&&goals[byRole.support.id].kind==='lane'){const sup=byRole.support,carry=byRole.adc||byRole.mid||byRole.top;if(carry)goals[sup.id]={kind:'escort',unit:carry.id,p:goals[carry.id]?.p||carry.p,lane:goals[carry.id]?.lane};}
 // Only pull a mass defense toward an actual open-base push; avoid phantom fountain camping.
 const openAgainst=G.openedLanes(s,enemy),lastDamage=(s.events||[]).some(e=>e.kind==='push_damage'&&e.target===base.id&&e.damage>0),attackLanes=fronts.filter(f=>openAgainst.includes(f.lane)&&qD(f.frontP,base)<=1).map(f=>({f,n:foes.filter(h=>qEq(h.p,s.fronts.find(g=>g.team===enemy&&g.lane===f.lane).p)).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
 if(attackLanes[0]&&(lastDamage||base.hp<45||attackLanes[0].n>=3)){const {f,n}=attackLanes[0],defenders=[...me].sort((a,b)=>qD(a,f.p)-qD(b,f.p)||b.gold-a.gold).slice(0,Math.min(me.length,n+1));for(const h of defenders)goals[h.id]={kind:'defend',lane:f.lane,p:f.p};}
 // A task with no movement/income/combat progress cannot hold a hero forever.
 for(const h of me){const m=qMemory.units[h.id],g=goals[h.id];if(m.idle>=P.idleLimit&&qIncome(s,h,h.p)===0&&!G.engagementOf(s,h)&&g.kind!=='defend'){
   if(h.role==='jungle'&&r<=s.config.laneLock){const c=s.camps.filter(c=>c.kind==='normal'&&c.alive).sort((a,b)=>qD(h,a)-qD(h,b))[0];if(c)goals[h.id]={kind:'camp',id:c.id,p:c.p};}
   else{const options=fronts.filter(f=>r>s.config.laneLock||G.roleLane(h.role)===f.lane).flatMap(f=>f.cells.map(p=>({f,p,v:qIncome(s,h,p)*8/(qD(h,p)+1)-qIncoming(s,h,p)/Math.max(1,h.maxHP)*8}))).sort((a,b)=>b.v-a.v);if(options[0])goals[h.id]={kind:'recover-economy',lane:options[0].f.lane,p:options[0].p};}
  }}
 return goals;
}


function qFountainSally(s,me,foes,orders,r){
 // The fountain has a single exit. Waiting for a path with less than70% incoming
 // damage can be permanent when a siege pins every route. Choose a coordinated
 // break-out, not indefinite safety; a real base-income objective follows it.
 const stuck=me.filter(h=>eq(h.p,G.FOUNTAIN[h.team])&&qIncome(s,h,h.p)===0&&(qMemory.units[h.id]?.idle||0)>=6&&h.stunUntil<r&&h.engageRecoveryUntil<r&&!G.engagementOf(s,h));
 if(!stuck.length)return;
 const team=s.you,home=G.HOME[team],exits=G.neighbors(team,G.FOUNTAIN[team]);if(!exits.length)return;
 const exit=exits.slice().sort((a,b)=>G.dist(a,home)-G.dist(b,home))[0];
 for(let i=0;i<me.length;i++){
  const h=me[i];if(!eq(h.p,G.FOUNTAIN[team])||h.stunUntil>=r||h.engageRecoveryUntil>=r||G.engagementOf(s,h))continue;
  const target=foes.find(t=>t.id===orders[i].target),attack=['attack','reap','spell'].includes(orders[i].action)&&(orders[i].action==='spell'?orders[i].cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(orders[i].action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)));
  if(attack)continue;
  // Every available ally takes the same timing, including the healer. This is a
  // strategic commitment after six dry turns, not an extra engine command.
  orders[i]=O(h,'move',{to:exit.slice()});
  const goal=qRecoveryGoal(s,h)||s.fronts.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>({p,lane:f.lane,value:qIncome(s,h,p)/(G.dist(p,exit)+1)}))).sort((a,b)=>b.value-a.value)[0];
  if(goal)qMemory.recovery[h.id]={p:goal.p,lane:goal.lane,until:r+12};
 }
}

function macro(s){
 track(s);
 const team=s.you,enemy=G.enemy(team),r=s.turn+1,me=s.heroes.filter(h=>h.alive&&h.team===team),foes=s.heroes.filter(h=>h.alive&&h.team!==team),goals=assignments(s,team),fs=s.fronts.filter(f=>f.team===team),preds=EXACT.on?[EXACT.orders]:[predict(s,enemy,0),predict(s,enemy,1),motionPrediction(s,enemy)],oldByID=Object.fromEntries(s.heroes.map(h=>[h.id,h]));
 const provisional=me.map(h=>{const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;if(g.kind==='camp'||g.kind==='ancient'){const c=s.camps.find(c=>c.id===g.id);if(c?.alive&&eq(c.p,h.p))return O(h,'capture',{target:c.id});}if(g.lane&&eq(G.pushPosition(s,team,g.lane),h.p))return O(h,'push',{lane:g.lane});return travel(s,h,g.p);});
 if(!EXACT.on){const savedEscort=history.escort;preds.push(responsePrediction(s,enemy,provisional));history.escort=savedEscort;if(EXACT.extra)preds.push(EXACT.extra);}
 const goalP=(h,n=s)=>{const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'};if(g.kind==='lane')return G.pushPosition(n,team,g.lane);if(g.kind==='escort'){const t=n.heroes.find(x=>x.id===g.unit);if(t?.alive)return t.p;}return g.p;};
 let simCount=0;
 function value(n,orders){
  if(n.result)return n.result.winner===team?1e7:n.result.winner===enemy?-1e7:0;
  let v=0;const alive=n.heroes.filter(h=>h.alive),nf=G.fronts(n);
  for(const h of n.heroes){
   const old=oldByID[h.id],us=h.team===team,sign=us?1:-1,w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[h.role];
   v+=sign*(h.gold-old.gold)*(Q.roleMoney?w:1)*1.25;
   if(!h.alive){if(old.alive)v-=sign*(220+Math.min(170,r)+h.gold*.035)*w*Math.min(1,Math.max(1,s.config.maxTurns+1-r)/16);continue;}
   const fraction=h.hp/h.maxHP*Math.min(1,Math.max(0,s.config.maxTurns-r)/12);
   v+=sign*fraction*(110+h.maxHP*.045)*w;
   if(h.stunUntil>=n.turn+1)v-=sign*18*w;
   if(h.role==='mid'&&h.spellReady>n.turn+1)v-=sign*h.damage*.018*w;if(h.role==='adc'&&h.reapReady>n.turn+1)v-=sign*h.damage*.008*w;
   if(us){
    const g=goals[h.id]||{kind:'lane',lane:G.roleLane(h.role)||'mid'},p=goalP(h,n),d=distance(h,p),coef=g.kind==='defend'?65:g.kind==='ancient'?30:g.kind==='camp'?19:g.kind==='escort'?12:23;
    v-=Math.max(0,d-(g.kind==='escort'?1:0))*coef;
    const nextDanger=danger(n,h,h.p,n.turn+1),support=alive.find(t=>t.role==='support'&&t.team===team&&G.engagementCanUtility(n,t,h,'heal'));
    const net=Math.max(0,nextDanger-(support&&support.stunUntil<n.turn+1?support.heal*.6:0));
    v-=net*.025*w*Math.min(1,1100/h.maxHP)*Q.risk+Math.max(0,net*1.25-h.hp)/Math.max(1,h.maxHP)*250*w;
   }
   const preferred=G.roleLane(h.role),eligible=nf.filter(f=>f.team===h.team&&f.cells.some(p=>eq(p,h.p))&&(n.turn+1>40||f.lane===preferred));
   for(const f of eligible){const members=alive.filter(a=>a.team===h.team&&f.cells.some(p=>eq(p,a.p))&&(n.turn+1>40||G.roleLane(a.role)===f.lane)),den=Math.max(1,members.reduce((v,a)=>v+(a.role==='support'?.25:1),0));let income=12*(h.role==='support'?.25:1)/den+(h.role==='adc'?s.config.adcLaneFlat:0);if(h.role==='support'&&members.some(a=>a.role==='adc'))income*=1.5;v+=sign*income*w*1.8;}
   if(us&&n.turn+1>s.config.laneLock){const bestFuture=Math.max(0,...nf.filter(f=>f.team===team).flatMap(f=>f.cells.map(p=>qIncome({...n,fronts:nf,decisionTurn:n.turn+1},h,p)/(G.dist(h,p)+1))));v+=bestFuture*Q.future;}
  }
  // Kill threat for next turn (exact-model mode only): enemies our living attackers can already reach for lethal damage.
  if(EXACT.off){for(const e of n.heroes){if(e.team===team||!e.alive)continue;const pot=v2Incoming(n,e,e.p,n.turn+1);if(pot>=e.hp){const w={top:1,mid:1.35,adc:1.5,support:.9,jungle:1.2}[e.role];v+=EXACT.off*(220+Math.min(170,r)+e.gold*.035)*w;}}}
  for(const b of n.buildings){const old=s.buildings.find(x=>x.id===b.id),sign=b.team===team?-1.2:1;v+=sign*(old.hp-b.hp)*(b.kind==='base'?100:b.tier==='inner'?30:16);if(old.hp>0&&b.hp<=0)v+=sign*50;}
  for(const e of n.events){
   if(e.kind==='invalid'&&e.unit[0]===team)v-=30;
   if(e.kind==='ancient_progress'&&e.damage){const c=n.camps.find(c=>c.id===e.target);if(c.alive)v+=(e.counts[team]>e.counts[enemy]?1:e.counts[team]<e.counts[enemy]?-1:0)*120;}
  }
  return v;
 }
 function sim(orders,ps,k){simCount++;return G.simulate(s,{[team]:{orders},[enemy]:{orders:ps}},k===undefined?'public-simulation-'+r+'-'+JSON.stringify(ps):typeof k==='string'?k:'exact-simulation-'+r+'-'+k);}
 const scoreCache=new Map(),predictionKeys=preds.map(ps=>JSON.stringify(ps));
 function score(orders){
  const key=JSON.stringify(orders);if(scoreCache.has(key))return scoreCache.get(key);
  if(EXACT.on){const ss=EXACT.simSeeds&&EXACT.simSeeds.length?EXACT.simSeeds:[0];let v=0;for(const k of ss)v+=value(sim(orders,preds[0],k),orders);v/=ss.length;scoreCache.set(key,v);return v;}
  const cases=new Map(),values=preds.map((ps,i)=>{const k=predictionKeys[i];if(!cases.has(k))cases.set(k,value(sim(orders,ps),orders));return cases.get(k);});
  const base=.65*(values[0]+values[1])/2+.35*Math.min(values[0],values[1]);const old=.8*base+.2*values[2];let v=.65*old+.25*values[3]+.1*Math.min(old,values[3]);if(values.length>4){const w=EXACT.extraWeight||.4;v=(1-w)*v+w*values[4];}scoreCache.set(key,v);return v;
 }
 const opts=me.map(h=>{
  const allowed=G.engageAllowedActions(s,h,r),out=[O(h,'wait')],has=a=>allowed.includes(a);
  if(has('move'))for(const p of localNeighbors(team,h.p))out.push(O(h,'move',{to:p}));
  if(has('teleport'))for(const t of G.teleportTargets(s,h,r))if(!eq(h.p,t.p))out.push(O(h,'teleport',{to:t.p.slice()}));
  if(has('recall')&&h.hp<h.maxHP*.85&&!G.threatened(s,h))out.push(O(h,'recall'));
  out.push(...v2CombatOptions(s,h,foes,preds));
  if(has('heal'))for(const a of me)if(a.hp<a.maxHP&&G.dist(a,h)<=2||a.hp<a.maxHP&&G.sameEngagement(s,h,a))out.push(O(h,'heal',{target:a.id}));
  if(has('control'))for(const t of foes)if(G.engagementCanUtility(s,h,t,'control'))out.push(O(h,'control',{target:t.id}));
  if(has('capture'))for(const c of s.camps)if(c.alive&&eq(c.p,h.p)&&(c.kind==='ancient'||h.role!=='support'))out.push(O(h,'capture',{target:c.id}));
  if(has('push'))for(const f of fs)if(eq(f.p,h.p))out.push(O(h,'push',{lane:f.lane}));
  return out;
 });
 let orders=me.map((h,i)=>{
  const co=combat(s,h),g=goals[h.id];if(co.action!=='wait')return co;
  if(opts[i].length===1)return opts[i][0];
  if(g.kind==='lane'){const push=opts[i].find(o=>o.action==='push'&&o.lane===g.lane);if(push)return push;}
  if(g.kind==='ancient'||g.kind==='camp'){const cap=opts[i].find(o=>o.action==='capture'&&o.target===g.id);if(cap)return cap;if(eq(h.p,g.p))return O(h,'wait');}
  return travel(s,h,goalP(h));
 });
 let best=score(orders);
 // Joint actions cross count thresholds that single-coordinate search cannot cross.
 for(const f of fs){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='push'&&o.lane===f.lane));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length)&&!__late();mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'push',{lane:f.lane});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 for(const c of s.camps.filter(c=>c.kind==='ancient'&&c.alive)){
  const eligible=me.map((h,i)=>({h,i})).filter(x=>opts[x.i].some(o=>o.action==='capture'&&o.target===c.id));
  if(eligible.length<2)continue;
  for(let mask=1;mask<(1<<eligible.length)&&!__late();mask++)if(mask&(mask-1)){
   const trial=orders.slice();eligible.forEach((x,j)=>{if(mask&(1<<j))trial[x.i]=O(x.h,'capture',{target:c.id});});
   const v=score(trial);if(v>best+.0001){best=v;orders=trial;}
  }
 }
 const sequence=me.map((h,i)=>i).sort((a,b)=>['support','adc','mid','top','jungle'].indexOf(me[a].role)-['support','adc','mid','top','jungle'].indexOf(me[b].role));
 for(let pass=0;pass<2&&!__late()&&!EXACT.fast;pass++){let changed=false;for(const i of sequence){if(__late())break;let chosen=orders[i];for(const o of opts[i]){const trial=orders.slice();trial[i]=o;const v=score(trial);if(v>best+.0001){chosen=o;best=v;}}if(chosen!==orders[i])changed=true;orders[i]=chosen;}if(!changed)break;}
 // Compare engaging with continuing the chosen macro orders, using actual simultaneous rules.
 const ji=me.findIndex(h=>h.role==='jungle');
 if(ji>=0&&G.engageCanCast(s,me[ji],r)&&!__late()){
  const centers=foes.filter(h=>G.dist(h,me[ji])<=1).map(h=>h.p).filter((p,i,a)=>a.findIndex(q=>eq(p,q))===i);
  const combatValue=n=>n.heroes.reduce((v,h)=>{const sign=h.team===team?1:-1,w=(150+h.gold*.05+(h.role==='mid'?h.damage*1.5:h.role==='support'?h.heal:h.damage*.6));return v+sign*(h.alive?w*(1+h.hp/h.maxHP):0);},0);
  function rollout(first){let n=first;for(let k=0;k<5&&n.phase==='map'&&!n.result;k++){refresh(n);const commands={A:{orders:[]},B:{orders:[]}};for(const h of n.heroes.filter(h=>h.alive)){let o=combat(n,h);if(!G.engagementOf(n,h)&&o.action==='wait'){const g=h.team===team?goals[h.id]:null;o=g?travel(n,h,g.kind==='lane'?G.pushPosition(n,team,g.lane):g.p):predict(n,h.team,0).find(o=>o.unit===h.id)||o;}commands[h.team].orders.push(o);}n=G.step(n,commands);}return combatValue(n);}
  const baseline=centers.length?rollout(sim(orders,preds[0])):0;let bv=baseline+45,bo=null;
  for(const p of centers){const preview=G.previewEngage(s,me[ji],p);if(!preview)continue;const trial=me.map((h,i)=>i===ji?O(h,'engage',{to:p.slice()}):G.engagementOf(preview,preview.heroes.find(x=>x.id===h.id))?combat(preview,preview.heroes.find(x=>x.id===h.id)):orders[i]);const n=sim(trial,preds[0]),v=rollout(n);if(v>bv){bv=v;bo=trial;}}
  if(bo)orders=bo;
 }
 if(r>40&&!__late()&&me.filter(h=>qMemory.units[h.id]?.idle>=2&&qIncome(s,h,h.p)===0).length>=2){
  const actionFor=(n,h)=>{const co=combat(n,h);if(co.action!=='wait')return co;const g=goals[h.id];if(!g)return O(h,'wait');if(g.kind==='camp'||g.kind==='ancient'){const c=n.camps.find(c=>c.id===g.id);if(c?.alive&&eq(h.p,c.p))return O(h,'capture',{target:c.id});if(!c?.alive){const fs=G.fronts(n).filter(f=>f.team===h.team).sort((a,b)=>G.dist(h,a.p)-G.dist(h,b.p));return eq(h.p,fs[0].p)?O(h,'push',{lane:fs[0].lane}):travel(n,h,fs[0].p);}}const p=g.kind==='lane'?G.pushPosition(n,h.team,g.lane):g.kind==='escort'?n.heroes.find(x=>x.id===g.unit)?.p||g.p:g.p;return g.lane&&eq(h.p,G.pushPosition(n,h.team,g.lane))?O(h,'push',{lane:g.lane}):travel(n,h,p);};
  const planned=me.map(h=>actionFor(s,h));
  function rolloutScore(first,sample){let n=G.simulate(s,{[team]:{orders:first},[enemy]:{orders:preds[Math.min(sample,preds.length-1)]}},'macro-commit-'+r+'-'+sample);for(let k=0;k<Q.rollout&&!n.result&&n.phase==='map';k++){refresh(n);const commands={};commands[team]={orders:n.heroes.filter(h=>h.alive&&h.team===team).map(h=>actionFor(n,h))};commands[enemy]={orders:predict(n,enemy,sample)};n=G.step(n,commands);}return value(n,first);}
  let a=0,b=0;for(let sample=0;sample<2;sample++){a+=rolloutScore(orders,sample);b+=rolloutScore(planned,sample);}if(b>a+10)orders=planned;
 }
 for(let i=0;i<me.length;i++){const h=me[i],recovery=qMemory.recovery?.[h.id];if(!recovery||qIncome(s,h,h.p)>0||G.engagementOf(s,h)||h.stunUntil>=r||h.engageRecoveryUntil>=r)continue;const o=orders[i],target=foes.find(t=>t.id===o.target),useful=['attack','reap','spell'].includes(o.action)&&(o.action==='spell'?o.cells.some(p=>foes.some(t=>eq(p,t.p))):target&&(o.action==='reap'?G.canReap(s,h,target):G.canHeroAttack(h,target,s)))||o.action==='heal'&&me.some(a=>a.id===o.target&&a.hp<a.maxHP-.001)||o.action==='control'&&target&&G.engagementCanUtility(s,h,target,'control');if(useful)continue;const route=qRecoveryPath(s,h,recovery.p);if(route?.length>1&&qIncoming(s,h,route[1],true)<h.hp*.7)orders[i]=O(h,'move',{to:route[1]});}
 qFountainSally(s,me,foes,orders,r);
 return{orders};
}
module.exports.decide=function(s){if(s.phase==='final_battle')return arena(s);if(s.phase!=='map'||s.result)return{orders:[]};return macro(s);};


const __decide=module.exports.decide;module.exports.decide=function(obs){for(const c of obs.camps)if(c.kind==='ancient'&&!c.alive&&c.spawnAt===null)c.spawnAt=Number.MAX_SAFE_INTEGER;return __decide(obs);};

;return module.exports;}
// ===== Outer glue: online behaviour-model identification + best response =====
// Each embedded public baseline runs as an isolated "shadow" fed the enemy's public observation
// (same public state with you=enemy). Its predicted orders are checked against the next turn's
// public events; only a model that keeps explaining the opponent's actual actions is trusted.
// Otherwise the self policy falls back to its generic multi-hypothesis predictions.
const __SELF=makeSelf();
let __OFF=0.3,__BOFF=0.3,__GOFF=0.3,__GANK=1;const __USE_SHADOWS=true;module.exports.__setOff=function(x){__OFF=x;};
const __MAKERS=__USE_SHADOWS?[makeShadow0,makeShadow1,makeShadow2]:[];
let __M=null;
const __sameP=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a[0]===b[0]&&a[1]===b[1];
function __fresh(){return{turn:0,shadows:__MAKERS.map((f,i)=>({i,bot:f(),hit:0,tot:0,recent:1,alive:true,pred:null,ms:0,miss:0})),dropAll:false};}
function __consistent(o,E,id){
 const ev=E.filter(e=>e.unit===id||e.source===id);
 if(ev.some(e=>e.kind==='stun'))return null;
 const died=E.some(e=>(e.kind==='kill'||e.kind==='death')&&e.target===id);
 const canc=ev.find(e=>e.kind==='engage_cancel');if(canc)return canc.action===o.action;
 const inv=ev.find(e=>e.kind==='invalid'),a=o.action,inPush=E.some(e=>e.kind==='push_contest'&&Object.values(e.sources||{}).some(l=>l.includes(id)));
 const inAnc=E.some(e=>e.kind==='ancient_progress'&&(e.sources||[]).includes(id));
 if(a==='move')return ev.some(e=>e.kind==='move'&&__sameP(e.to,o.to))||(!!inv&&inv.reason==='move');
 if(a==='teleport')return ev.some(e=>e.kind==='teleport'&&__sameP(e.to,o.to))||(!!inv&&/^teleport/.test(inv.reason));
 if(a==='attack')return ev.some(e=>(e.kind==='hit'&&e.attackType==='hero'&&e.target===o.target)||(e.kind==='move_escape'&&!e.attackType&&e.target===o.target)||e.kind==='attack_cancelled')||(!!inv&&['hero-target','support-attack'].includes(inv.reason));
 if(a==='reap')return ev.some(e=>(e.kind==='reap'&&e.target===o.target)||e.kind==='attack_cancelled')||(!!inv&&inv.reason==='reap');
 if(a==='spell')return ev.some(e=>(e.kind==='spell'&&JSON.stringify(e.cells)===JSON.stringify(o.cells))||e.kind==='attack_cancelled')||(!!inv&&inv.reason==='spell');
 if(a==='capture')return ev.some(e=>e.kind==='hit'&&e.attackType==='capture'&&e.target===o.target)||inAnc||(!!inv&&/capture|support-normal/.test(inv.reason));
 if(a==='push')return died?null:inPush||(!!inv&&inv.reason==='push-position-or-lane');
 if(a==='heal'||a==='control')return ev.some(e=>e.kind===a&&e.target===o.target)||(!!inv&&inv.reason==='utility');
 if(a==='recall')return died?null:ev.some(e=>e.kind==='recall'||e.kind==='recall_fail');
 if(a==='engage')return ev.some(e=>e.kind==='engage_cast')||(!!inv&&/^engage/.test(inv.reason));
 if(a==='wait')return !ev.some(e=>['move','teleport','hit','spell','reap','heal','control','recall','recall_fail','engage_cast','move_escape','attack_cancelled','invalid'].includes(e.kind))&&!inPush&&!inAnc;
 return null;
}
// Two simulation seeds whose hidden attack permutation puts all our attackers first / all theirs first,
// so a lethal exchange is scored as the even mixture of both orders instead of one arbitrary sample.
function __orderSeeds(obs){
 const turn=obs.turn+1,mine=obs.heroes.filter(h=>h.alive&&h.role!=='support'&&h.team===obs.you).map(h=>h.id),theirs=obs.heroes.filter(h=>h.alive&&h.role!=='support'&&h.team!==obs.you).map(h=>h.id);
 if(!mine.length||!theirs.length)return['order-'+turn+'-0'];
 let first=null,last=null;
 for(let k=0;k<4000&&(!first||!last);k++){const sd='order-'+turn+'-'+k;let a=-1,b=2,c=2,d=-1;for(const id of mine){const x=__G.rng(sd,turn,'attack-order',id);if(x>a)a=x;if(x<c)c=x;}for(const id of theirs){const x=__G.rng(sd,turn,'attack-order',id);if(x<b)b=x;if(x>d)d=x;}
  if(!first&&a<b)first=sd;if(!last&&d<c)last=sd;}
 return [first||'order-'+turn+'-a',last||'order-'+turn+'-b'];
}
function __model(obs,t0){
 const enemy=obs.you==='A'?'B':'A';
 if(!__M||obs.decisionTurn<=__M.turn)__M=__fresh();
 const M=__M,E=obs.events||[];
 if(M.turn===obs.decisionTurn-1)for(const sh of M.shadows)if(sh.alive&&sh.pred){
  let h=0,t=0;for(const o of sh.pred){if(!o||typeof o.unit!=='string'||o.unit[0]!==enemy)continue;const c=__consistent(o,E,o.unit);if(c===null)continue;t++;if(c)h++;}
  if(t){sh.hit+=h;sh.tot+=t;sh.recent=sh.recent*.75+.25*(h/t);if(h<t)sh.miss++;}
 }
 // Prune models that clearly fail to explain the opponent (saves time; never resurrected).
 const live=M.shadows.filter(s=>s.alive);
 const rate=s=>s.tot?s.hit/s.tot:1,bestRate=Math.max(0,...live.map(rate));
 const minMiss=Math.min(...live.map(s=>s.tot-s.hit));
 for(const sh of live){if(sh.tot-sh.hit>=minMiss+2||(sh.tot>=40&&(rate(sh)<bestRate-.04||sh.recent<.55)))sh.alive=false;}
 if(obs.decisionTurn>25&&M.shadows.every(s=>!s.alive||s.recent<.6))for(const sh of M.shadows)sh.alive=false;
 const eobs=JSON.stringify({...obs,you:enemy});let spent=0;
 const order=M.shadows.filter(s=>s.alive).sort((a,b)=>(a.tot-a.hit)-(b.tot-b.hit)||b.recent-a.recent||a.i-b.i);
 for(const sh of order){if(sh!==order[0]&&Date.now()-t0>650){sh.pred=null;sh.skipped=(sh.skipped||0)+1;continue;}const a=Date.now();try{const out=sh.bot.decide(JSON.parse(eobs));sh.pred=out&&Array.isArray(out.orders)?out.orders:null;if(!sh.pred)sh.alive=false;}catch(e){sh.alive=false;sh.pred=null;}sh.ms=Date.now()-a;spent+=sh.ms;}
 M.turn=obs.decisionTurn;
 const cands=M.shadows.filter(s=>s.alive&&s.pred&&s.tot>=10).sort((a,b)=>b.recent-a.recent||rate(b)-rate(a)||a.i-b.i);
 const best=cands[0];
 const nLive=M.shadows.filter(s=>s.alive).length,el=Date.now()-t0;
 if(best&&best.recent>=.95&&rate(best)>=.97)return{on:true,orders:JSON.parse(JSON.stringify(best.pred)),simSeeds:__orderSeeds(obs),off:__OFF,gank:__GANK,deadline:t0+1050,fast:el>850};
 if(best&&best.recent>=.7&&rate(best)>=.75)return{on:false,orders:null,extra:JSON.parse(JSON.stringify(best.pred)),extraWeight:.25+.5*Math.max(0,Math.min(1,(best.recent-.7)/.25)),off:__BOFF,gank:0,deadline:t0+1050,fast:el>850};
 return null;
}
// Emergency base defence (post-processing). The one-step search cannot see a base that will fall in a few
// turns while heroes chase fights elsewhere; when enemy pushers can finish our base soon and we are not winning
// the base race, send heroes home by the fastest legal route (teleport > recall > walk) to contest/kill the pushers.
let __DEF=1;
function __defend(obs,res){
 if(!__DEF||!res||!Array.isArray(res.orders)||obs.phase!=='map')return res;
 const G=__G,me=obs.you,en=me==='A'?'B':'A',r=obs.decisionTurn,K=p=>p[0]+','+p[1];
 const base=obs.buildings.find(b=>b.id===me+'_base'),ebase=obs.buildings.find(b=>b.id===en+'_base');if(!base||base.hp<=0)return res;
 if(!G.openedLanes(obs,en).length)return res;
 const fr=obs.fronts||G.fronts(obs);let worst=null;
 for(const f of fr.filter(f=>f.team===en&&f.target===base.id)){
  const pushers=obs.heroes.filter(h=>h.alive&&h.team===en&&K(h.p)===K(f.p)&&h.stunUntil<r);if(!pushers.length)continue;
  const dmg=pushers.reduce((n,h)=>n+G.towerDamage(h,obs.config),0),turns=Math.ceil(base.hp/Math.max(1,dmg));
  if(!worst||turns<worst.turns)worst={f,pushers,turns};
 }
 if(!worst||worst.turns>12)return res;
 // Base race: if our current pushers finish their base strictly first, keep attacking.
 if(G.openedLanes(obs,me).length&&ebase&&ebase.hp>0){let ours=Infinity;for(const f of fr.filter(f=>f.team===me&&f.target===ebase.id)){const ps=obs.heroes.filter(h=>h.alive&&h.team===me&&K(h.p)===K(f.p));if(ps.length){const d=ps.reduce((n,h)=>n+G.towerDamage(h,obs.config),0);ours=Math.min(ours,Math.ceil(ebase.hp/Math.max(1,d)));}}if(ours<worst.turns)return res;}
 const lane=worst.f.lane,mine=fr.find(f=>f.team===me&&f.lane===lane),spot=mine.p,pusherIds=new Set(worst.pushers.map(h=>h.id));
 const byUnit=new Map(res.orders.map(o=>[o.unit,o])),out=[];
 for(const h of obs.heroes.filter(h=>h.alive&&h.team===me)){
  const o=byUnit.get(h.id)||{unit:h.id,action:'wait'},a=h.allowedActions||[];
  if(!a.includes('move')){out.push(o);continue;}
  if(['attack','reap'].includes(o.action)&&(pusherIds.has(o.target)||(()=>{const t=obs.heroes.find(x=>x.id===o.target);return t&&t.hp<=h.damage;})())){out.push(o);continue;}
  if(o.action==='spell'&&o.cells.some(c=>worst.pushers.some(p=>K(p.p)===K(c)))){out.push(o);continue;}
  if(o.action==='heal'){out.push(o);continue;}
  if(K(h.p)===K(spot)){out.push(a.includes('push')?{unit:h.id,action:'push',lane}:o);continue;}
  const walk=G.dist(h.p,spot);
  if(a.includes('teleport')&&walk>2&&(h.teleportTargets||[]).includes(me+'_base')){out.push({unit:h.id,action:'teleport',to:base.p.slice()});continue;}
  const fountain=G.FOUNTAIN[me];
  if(a.includes('recall')&&h.recallAllowed&&walk>1+G.dist(fountain,spot)+1&&!(K(h.p)===K(fountain))){out.push({unit:h.id,action:'recall'});continue;}
  if(walk-1>worst.turns+1){out.push(o);continue;}
  const route=G.pathTo(me,h.p,spot);if(route&&route.length>1){out.push({unit:h.id,action:'move',to:route[1]});continue;}
  out.push(o);
 }
 return{orders:out};
}
module.exports.decide=function(obs){
 const t0=Date.now();
 if(obs&&obs.phase==='map'&&!obs.result){let ex=null;try{ex=__model(obs,t0);}catch(e){ex=null;}if(!ex)ex={on:false,orders:null,seeds:1,off:__GOFF,gank:0,deadline:t0+1050,fast:Date.now()-t0>850};__SELF.__setExact(ex);}
 else __SELF.__setExact(null);
 const text=JSON.stringify(obs);
 try{const res=__SELF.decide(JSON.parse(text));try{return __defend(obs,res);}catch(e){return res;}}
 catch(e){try{__SELF.__setExact({on:false,orders:null,seeds:1,off:0,deadline:Date.now()+600,fast:true});return __SELF.decide(JSON.parse(text));}catch(e2){
  if(obs&&obs.phase==='final_battle'&&obs.finalDecision&&obs.finalDecision.team===obs.you)return{orders:[{unit:obs.finalDecision.actor,action:'wait'}]};
  return{orders:[]};}}
};
module.exports.__diag=function(){return __M;};

// Preserve the original team planner and upgrade a strictly wider group spell.
const migrationEngine=require('./engine.cjs'), migrationDecide=module.exports.decide;
module.exports.decide=function(observation){
 const view=JSON.parse(JSON.stringify(observation));
 const decision=migrationDecide(view);
 if(observation.phase!=='map'||!decision?.orders)return decision;
 const mid=observation.heroes.find(h=>h.id===observation.you+'_mid');
 const i=decision.orders.findIndex(o=>o?.unit===mid.id);
 if(!mid.alive||i<0||!mid.allowedActions.includes('spell'))return decision;
 const order=decision.orders[i],targets=mid.spellEngagementTargets;
 if(!targets.length)return decision;
 if(order.action==='spell'&&order.cells){
  const local=observation.heroes.filter(h=>h.alive&&h.team!==mid.team&&
   order.cells.some(p=>migrationEngine.key(p)===migrationEngine.key(h.p))).map(h=>h.id);
  if(local.every(id=>targets.includes(id))&&targets.length>local.length)decision.orders[i]={unit:mid.id,action:'spell'};
 }else if(targets.length>=2&&(order.action==='wait'||(order.action==='attack'&&targets.includes(order.target)))){
  decision.orders[i]={unit:mid.id,action:'spell'};
 }
 return decision;
};
