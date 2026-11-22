(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HexMoba=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='hex-moba-balance-lab';
const C={maxTurns:360,initialGold:0,growthPerGold:.005,laneIncomeCells:2,laneGold:12,adcLaneFlat:2,supportWithAdcLaneBonus:.5,supportWeight:.25,killGold:120,killRadius:1,normalGold:32,jungleBonus:.5,normalRespawn:15,ancientHP:4,ancientGold:750,ancientFirst:80,ancientOffset:-20,ancientPeriod:60,ancientRequired:2,outerHP:42,innerHP:42,baseHP:60,outerGold:100,innerGold:200,attackCooldown:0,spellCooldown:2,reapCooldown:5,reapRange:2,reapMultiplier:1.2,utilityCooldown:3,controlCooldown:3,healCooldown:0,laneLock:40,towerGoldStep:500,towerMaxDamage:4,towerGoldBasis:'total',engageCooldown:10,engageUnlockRound:21,teleportUnlockRound:31,teleportCooldown:20,engageTargetRange:1,engageRequiresEnemyCenter:true,engageRadius:1,respawnStage:60,respawnStart:8,respawnStep:4,oneLaneCap:null,twoLaneCap:null,randomAncients:true,ancientDelayMin:20,ancientDelayMax:70,ancientNoticeMin:5,ancientNoticeMax:20,ancientHPMin:3,ancientHPMax:6,ancientGoldMin:500,ancientGoldMax:1000,randomAttackOrder:false,economicDodge:true,dodgeBase:.5,dodgeGoldStep:100,dodgePerStep:.01,dodgeMin:.35,dodgeMax:.65,randomTowers:true,outerHPMin:30,outerHPMax:60,innerHPMin:40,innerHPMax:60,towerHPMirrored:true,stackLaneIncome:true,growthCurve:null,earlyStructureUntil:0,earlyStructureDamageCap:null,earlySingleFrontInnerCap:null,earlyHomePushPriority:false,earlySplitSupport:0,earlyTowerCover:0,earlyTowerCoverEnemyCount:4,lateSiegeRound:null};
const ROLE_STATS={top:{hp:400,attack:70},mid:{hp:400,attack:70},adc:{hp:320,attack:105},support:{hp:400,attack:70},jungle:{hp:400,attack:70}};
const ROLES=['top','mid','adc','support','jungle'],NAMES={top:'上',mid:'中',adc:'射',support:'辅',jungle:'野'},LANES=['top','mid','bottom'],HOME={A:[-3,3],B:[3,-3]},FOUNTAIN={A:[-4,4],B:[4,-4]},PATHS={top:[[-3,3],[-3,2],[-3,1],[-3,0],[-2,-1],[-1,-2],[0,-3],[1,-3],[2,-3],[3,-3]],mid:[[-3,3],[-2,2],[-1,1],[0,0],[1,-1],[2,-2],[3,-3]],bottom:[[-3,3],[-2,3],[-1,3],[0,3],[1,2],[2,1],[3,0],[3,-1],[3,-2],[3,-3]]};
const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]],CELLS=[];
for(let q=-3;q<=3;q++)for(let r=-3;r<=3;r++)if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=3)CELLS.push([q,r]);
CELLS.push([...FOUNTAIN.A],[...FOUNTAIN.B]);
const key=p=>p.join(','),point=x=>Array.isArray(x)?x:x.p,dist=(a,b)=>{const x=point(a),y=point(b),q=x[0]-y[0],r=x[1]-y[1];return Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));},enemy=t=>t==='A'?'B':'A',clone=x=>JSON.parse(JSON.stringify(x));
const cellKeys=new Set(CELLS.map(key)),laneKeys=new Set([...Object.values(PATHS).flat(),...Object.values(FOUNTAIN)].map(key));
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isInteger)&&cellKeys.has(key(p));
const gold=h=>h.goldMicros/1e6;
function setGold(h,value){h.goldMicros=Math.round(value*1e6);h.gold=h.goldMicros/1e6;return h;}
function towerDamage(h,c=C,round=0){
 const amount=c.towerGoldBasis==='total'?h.goldMicros/1e6:Math.max(0,h.goldMicros/1e6-c.initialGold);
 const goldDamage=c.towerGoldStep>0?Math.floor(amount/c.towerGoldStep):0;
 const lateDamage=c.lateSiegeRound!=null&&round>=c.lateSiegeRound?1:0;
 return Math.min(c.towerMaxDamage,1+goldDamage+lateDamage);
}
function growthFactors(earned,role,c){
 const curve=c.growthCurve;
 if(!curve){
  const factor=1+earned*c.growthPerGold;
  return {attack:factor,hp:factor};
 }
 const early=Math.min(earned,curve.threshold),late=earned-early;
 const factor=([first,rest])=>1+early*first+late*rest;
 return {attack:factor(curve.attack),hp:factor(role==='adc'?curve.adcHP:curve.hp)};
}
function stats(h,c=C,round=0){
 const earned=Math.max(0,h.goldMicros/1e6-c.initialGold),base=ROLE_STATS[h.role],growth=growthFactors(earned,h.role,c);
 const attack=Math.floor(base.attack*growth.attack+1e-9);
 return {towerDamage:towerDamage(h,c,round),damage:h.role==='support'?0:attack,range:1,heal:attack,
  maxHP:Math.floor(base.hp*growth.hp+1e-9),factor:growth.attack,hpFactor:growth.hp,earned};
}
function structureDamageCap(config,round){
 return round<=config.earlyStructureUntil?config.earlyStructureDamageCap:null;
}
function towerCover(s,h,round,active){
 const config=s.config;
 if(!config.earlyTowerCover||round>config.earlyStructureUntil||
    !s.buildings.some(b=>b.team===h.team&&b.kind==='tower'&&b.hp>0&&dist(h,b)<=1))return 0;
 let friends=0,enemies=0;
 for(const actor of active){
  if(dist(actor,h)>2)continue;
  if(actor.team===h.team)friends++;else enemies++;
 }
 return enemies>=config.earlyTowerCoverEnemyCount&&enemies>=friends+2?config.earlyTowerCover:0;
}
function syncStats(h,c=C){const next=stats(h,c).maxHP,old=h.maxHP;h.hp=old>0?Math.round(h.hp*next/old*1e6)/1e6:h.hp;h.maxHP=next;return h;}
const hitChance=()=>1; // Compatibility export: combat never samples a hit roll.
function nextAncient(a,r,c){if(c.randomAncients)return r+(c.ancientDelayMin+c.ancientDelayMax)/2;const first=c.ancientFirst+(a.id==='ancient_lower'?c.ancientOffset:0);return first+(Math.floor((r-first)/c.ancientPeriod)+1)*c.ancientPeriod;}
function rng(seed,...keys){let h=2166136261>>>0;for(const ch of [seed,...keys].join('|')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>0)/4294967296;}

// Private schedules use independent keyed draws. Unannounced plans never enter observe().
function randomInt(s,min,max,...parts){return min+Math.floor(rng(s._seed,...parts)*(max-min+1));}
function planAncient(s,a,origin){
 a.alive=false;a.hp=0;a.maxHP=0;a.spawnAt=null;a.goldPool=null;a.announcement=null;
 if(s._seed===undefined)return; // Observational previews cannot invent the actual hidden future.
 const cycle=a.captures.A+a.captures.B+1,c=s.config,base=['ancient-plan',a.id,cycle];
 const delay=randomInt(s,c.ancientDelayMin,c.ancientDelayMax,...base,'delay'),lead=randomInt(s,c.ancientNoticeMin,c.ancientNoticeMax,...base,'notice');
 const plan={cycle,origin,spawnAt:origin+delay,noticeAt:origin+delay-lead,maxHP:randomInt(s,c.ancientHPMin,c.ancientHPMax,...base,'hp'),goldPool:randomInt(s,c.ancientGoldMin,c.ancientGoldMax,...base,'gold'),announced:false};
 (s._ancientPlans||(s._ancientPlans={}))[a.id]=plan;
}
function announceAncients(s,r,ev){
 if(!s.config.randomAncients)return;
 for(const a of s.camps.filter(a=>a.kind==='ancient')){
  const p=s._ancientPlans?.[a.id];if(!p||p.announced||p.noticeAt>r||p.spawnAt>s.config.maxTurns)continue;
  p.announced=true;a.spawnAt=p.spawnAt;a.maxHP=p.maxHP;a.goldPool=p.goldPool;a.announcement={cycle:p.cycle,noticeAt:p.noticeAt,spawnAt:p.spawnAt,maxHP:p.maxHP,goldPool:p.goldPool};
  ev('ancient_notice',{target:a.id,...a.announcement});
 }
}
function ancientForecasts(s){return s.camps.filter(a=>a.kind==='ancient'&&a.announcement).map(a=>({id:a.id,p:[...a.p],alive:a.alive,...clone(a.announcement)}));}
function dodgeProbability(escapingGold,attackingGold,c=C){return Math.max(c.dodgeMin,Math.min(c.dodgeMax,c.dodgeBase+(escapingGold-attackingGold)/c.dodgeGoldStep*c.dodgePerStep));}
// A paired test carries the same draws across the team swap. Normal matches use the original orientation.
function randomSide(s,team){return s._mirrorRandomness?enemy(team):team;}
function randomId(s,id){return randomSide(s,id[0])+id.slice(1);}
function resourceTie(s,r,kind,id){
 const key=id.startsWith('ancient_')?id:randomId(s,id);
 return randomSide(s,rng(s._seed,r,kind,key)<.5?'A':'B');
}
function escapeRoll(s,r,source,target){
 return rng(s._seed??'preview',r,'move-escape',randomId(s,source.id),randomId(s,target.id));
}
function attackSequence(s,ids){
 const draw=id=>rng(s._seed??'preview',s.turn,'attack-order',randomId(s,id));
 return [...ids].sort((a,b)=>draw(a)-draw(b)||randomId(s,a).localeCompare(randomId(s,b)));
}
function simulate(input,commands,simulationSeed,{mirrorRandomness=false}={}){
 const {ancientForecasts,...s}=input;
 s._seed=String(simulationSeed);s._mirrorRandomness=mirrorRandomness;
 return step(s,commands);
}
function weighted(items,weight,u){let total=items.reduce((n,x)=>n+weight(x),0),v=u*total;for(const x of items){v-=weight(x);if(v<0)return x;}return items.at(-1);}
function share(members,pool,type,s){const c=s.config,weights=members.map(h=>h.role==='support'?1:4),den=Math.max(4,weights.reduce((a,b)=>a+b,0));return members.map((h,i)=>{let amount=Math.round(pool*1e6*weights[i]/den);if(type==='normal'&&h.role==='jungle')amount=Math.round(amount*(1+c.jungleBonus));if(type==='lane'&&h.role==='adc')amount+=Math.round((c.adcLaneFlat||0)*1e6);if(type==='lane'&&h.role==='support'&&members.some(a=>a.team===h.team&&a.role==='adc'))amount=Math.round(amount*(1+(c.supportWithAdcLaneBonus||0)));h.goldMicros+=amount;h.gold=h.goldMicros/1e6;h.income[type]=(h.income[type]||0)+amount/1e6;return{id:h.id,amount:amount/1e6};});}
function killAwards(killer,members,pool,s){
 const total=Math.round(pool*1e6),others=members.filter(h=>h.id!==killer.id).sort((a,b)=>a.id.localeCompare(b.id)),main=Math.floor(total*2/3),parts=[{h:killer,amount:main}];
 if(others.length){const remainder=total-main,weights=others.map(h=>h.role==='support'?1:4),den=weights.reduce((a,b)=>a+b,0),amounts=weights.map(w=>Math.floor(remainder*w/den));let extra=remainder-amounts.reduce((a,b)=>a+b,0);for(let i=0;extra>0;i=(i+1)%amounts.length,extra--)amounts[i]++;others.forEach((h,i)=>parts.push({h,amount:amounts[i]}));}
 return parts.map(({h,amount})=>{h.goldMicros+=amount;h.gold=h.goldMicros/1e6;h.income.kill+=amount/1e6;return{id:h.id,amount:amount/1e6};});
}
function makeState(seed=20261024,overrides={},{mirrorRandomness=false}={}){
 const config={...C,...overrides},heroes=[];for(const team of ['A','B'])for(const role of ROLES){const hp=ROLE_STATS[role].hp;heroes.push(setGold({id:team+'_'+role,team,role,name:team+NAMES[role],p:[...FOUNTAIN[team]],hp,maxHP:hp,alive:true,respawnAt:null,stunUntil:0,attackReady:1,spellReady:1,reapReady:1,utilityReady:1,engageReady:config.engageUnlockRound,teleportReady:config.teleportUnlockRound,engageRecoveryUntil:0,engageRecoveryTeams:[],engagementId:null,kills:0,deaths:0,income:{lane:0,normal:0,ancient:0,tower:0,kill:0}},config.initialGold));}
 const buildings=[];for(const team of ['A','B']){buildings.push({id:team+'_base',team,kind:'base',p:[...HOME[team]],hp:config.baseHP,maxHP:config.baseHP,power:0});for(const lane of LANES)for(const tier of ['inner','outer']){const path=PATHS[lane],n=path.length-1,index=team==='A'?(tier==='inner'?1:lane==='mid'?2:3):(tier==='inner'?n-1:lane==='mid'?n-2:n-3),hp=config.randomTowers?((tier==='inner'?config.innerHPMin:config.outerHPMin)+Math.floor(rng(seed,'tower-hp',config.towerHPMirrored?'paired':randomSide({_mirrorRandomness:mirrorRandomness},team),lane,tier)*((tier==='inner'?config.innerHPMax-config.innerHPMin:config.outerHPMax-config.outerHPMin)+1))):(tier==='inner'?config.innerHP:config.outerHP);buildings.push({id:team+'_'+lane+'_'+tier,team,lane,tier,kind:'tower',p:[...path[index]],hp,maxHP:hp,power:0});}}
 // Swap axial coordinates to reflect a camp into the other team's half while keeping the same lane.
 const a=[[-2,0],[-2,1],[-1,2],[-1,0],[0,1],[0,2]],camps=[];
 for(const team of ['A','B'])a.forEach((p,i)=>camps.push({id:team+'_camp_'+(i+1),regionTeam:team,kind:'normal',p:team==='A'?[...p]:[p[1],p[0]],hp:1,maxHP:1,power:0,alive:true,spawnAt:null,captures:{A:0,B:0}}));
 for(const [id,p]of [['ancient_upper',[-1,-1]],['ancient_lower',[1,1]]])camps.push({id,kind:'ancient',p,hp:0,maxHP:config.ancientHP,power:0,alive:false,spawnAt:config.ancientFirst+(id==='ancient_lower'?config.ancientOffset:0),captures:{A:0,B:0}});
 const state={version:VERSION,config,_seed:String(seed),_mirrorRandomness:mirrorRandomness,turn:0,mapTurn:0,phase:'map',engagements:[],nextEngagementId:1,heroes,buildings,camps,lanes:{top:{indices:[4,5]},mid:{indices:[3]},bottom:{indices:[4,5]}},teams:{A:{kills:0,towers:0,ancients:0},B:{kills:0,towers:0,ancients:0}},events:[],orders:{A:[],B:[]},result:null};
 if(config.randomAncients){state._ancientPlans={};for(const a of camps.filter(a=>a.kind==='ancient'))planAncient(state,a,0);announceAncients(state,0,(kind,data)=>state.events.push({kind,...data}));}return state;
}
function prepare(s){
 if(s.phase&&s.phase!=='map')return s;const r=s.turn+1,ev=(kind,data)=>{(s._prepareEvents||(s._prepareEvents=[])).push({kind,...data});};
 for(const h of s.heroes)if(!h.alive&&h.respawnAt<=r){h.alive=true;h.hp=h.maxHP;h.p=[...FOUNTAIN[h.team]];h.stunUntil=0;h.respawnAt=null;}
 announceAncients(s,r,ev);
 for(const c of s.camps)if(!c.alive&&Number.isFinite(c.spawnAt)&&c.spawnAt!==null&&c.spawnAt<=r){c.alive=true;c.hp=c.maxHP;c.spawnAt=null;if(c.kind==='ancient'&&s.config.randomAncients)ev('ancient_spawn',{target:c.id,...c.announcement});}
 refreshEngagementMembers(s);return s;
}
function openedLanes(s,attacker){return LANES.filter(l=>s.buildings.filter(b=>b.team===enemy(attacker)&&b.lane===l).every(b=>b.hp<=0));}
function shield(s,defender){const opened=openedLanes(s,enemy(defender)),n=opened.length;return{opened,cap:n===0?0:n===1?s.config.oneLaneCap:n===2?s.config.twoLaneCap:null};}
function vulnerable(s,b){return b.kind==='base'?openedLanes(s,enemy(b.team)).length>0:b.tier==='outer'||s.buildings.find(o=>o.team===b.team&&o.lane===b.lane&&o.tier==='outer').hp<=0;}
function laneAt(h){for(const lane of LANES){const index=PATHS[lane].findIndex(p=>key(p)===key(h.p));if(index>=0)return{lane,index};}return null;}
function roleLane(role){return role==='top'?'top':role==='mid'?'mid':role==='adc'||role==='support'?'bottom':null;}
function incomePath(lane){return[FOUNTAIN.A,...PATHS[lane],FOUNTAIN.B];}
function fronts(s){return ['A','B'].flatMap(team=>LANES.map(lane=>{
 const path=PATHS[lane],indices=[...s.lanes[lane].indices],index=team==='A'?indices[0]:indices.at(-1),frontIndex=team==='A'?indices.at(-1):indices[0],p=[...path[index]],frontP=[...path[frontIndex]],target=s.buildings.find(b=>b.team===enemy(team)&&b.hp>0&&key(b.p)===key(frontP));
 return{team,lane,index,p,target:target?.id||null,indices,cells:indices.map(i=>[...path[i]]),frontIndex,frontP,initialSingle:indices.length===1};
}));}
function pushPosition(s,team,lane){return fronts(s).find(f=>f.team===team&&f.lane===lane)?.p||null;}
function isLane(p){return laneKeys.has(key(point(p)));}
const E=(function(G){
 const id=x=>typeof x==='string'?x:x?.id,hero=(s,x)=>typeof x==='string'?s.heroes.find(h=>h.id===x):x;
 const cells=center=>G.CELLS.filter(p=>G.dist(p,center)<=1).map(p=>[...p]);
 const contains=(field,p)=>(field.cells||[]).some(q=>G.key(q)===G.key(Array.isArray(p)?p:p.p));
 function engagementOf(s,x){const h=hero(s,x);return h?.alive?(s.engagements||[]).find(e=>(e.members||[]).includes(h.id))||null:null;}
 function sameEngagement(s,a,b){const x=engagementOf(s,a),y=engagementOf(s,b);return !!x&&x.id===y?.id;}
 const ordinaryRange=(a,b)=>G.dist(a,b)<=1&&(G.isLane(a)||!G.isLane(b));
 function canAttack(s,a,b){return sameEngagement(s,a,b)||ordinaryRange(a,b);}
 function canUtility(s,a,b){return sameEngagement(s,a,b)||G.dist(a,b)<=1;}
 function internalEnemies(s,x){const h=hero(s,x),e=engagementOf(s,h);return e?s.heroes.filter(t=>t.alive&&t.team!==h.team&&e.members.includes(t.id)):[];}
 function midCanTargetCell(s,x,p){const h=hero(s,x);return !!h&&G.valid(p)&&G.dist(h,p)<=1;}
 return{engagementCells:cells,engagementContains:contains,engagementOf,sameEngagement,ordinaryAttackRange:ordinaryRange,engagementCanAttack:canAttack,engagementCanUtility:canUtility,engagementEnemies:internalEnemies,engagementMidCanTargetCell:midCanTargetCell};
})({CELLS,dist,key,isLane,valid});
function canHeroAttack(source,target,s=null){return s?E.engagementCanAttack(s,source,target):source?.engagementId&&source.engagementId===target?.engagementId||dist(source,target)<=1&&(isLane(source)||!isLane(target));}
// Inserted inside the engine closure. No external resources or hidden inputs.
function teleportCanUse(s,h,r=s.turn+1){return s.phase==='map'&&!!h?.alive&&h.role==='top'&&r>=s.config.teleportUnlockRound&&(h.teleportReady||s.config.teleportUnlockRound)<=r&&h.stunUntil<r&&!E.engagementOf(s,h)&&!(h.engageRecoveryUntil>=r);}
function teleportTargets(s,h,r=s.turn+1){return teleportCanUse(s,h,r)?s.buildings.filter(b=>b.team===h.team&&['base','tower'].includes(b.kind)):[];}
function engageCenterLegal(s,h,p){return !!h&&valid(p)&&dist(h,p)<=s.config.engageTargetRange&&s.heroes.some(t=>t.alive&&t.team!==h.team&&key(t.p)===key(p));}
function engageCanCast(s,h,r=s.turn+1,coach=false){
 if(s.phase!=='map'||r<s.config.engageUnlockRound||!h?.alive||h.stunUntil>=r||E.engagementOf(s,h))return false;
 if(coach){
  if((s.coachEngageReady?.[h.team]??s.config.engageUnlockRound)>r||
     (s.engagements||[]).some(e=>e.coachTeams?.includes(h.team)))return false;
 }else if(!['jungle','support'].includes(h.role)||(h.engageReady||1)>r)return false;
 if((s.engagements||[]).some(e=>e.initiators.includes(h.id)))return false;
 return !(h.engageRecoveryUntil>=r&&(h.engageRecoveryTeams||[]).includes(h.team));
}
function previewEngage(input,caster,center){
 const s=clone(input),id=typeof caster==='string'?caster:caster.id,orders=new Map(s.heroes.map(h=>[h.id,{unit:h.id,action:h.id===id?'engage':'wait',...(h.id===id?{to:[...center]}:{})}]));
 const accepted=resolveEngagementCasts(s,orders,input.decisionTurn||input.turn+1,()=>{});return accepted.has(id)?s:null;
}

// Only public geometry is used to enumerate skill targets.
function spellCellsLegal(s,h,points){
 if(s.phase!=='map'||h?.role!=='mid'||!Array.isArray(points)||points.length!==3||
    !points.every(p=>E.engagementMidCanTargetCell(s,h,p))||new Set(points.map(key)).size!==3)return false;
 // Among three distinct cells, connectivity means one is adjacent to both others.
 return points.some(center=>points.filter(p=>dist(center,p)===1).length===2);
}
function uncachedSpellTargets(s,h){
 if(s.phase!=='map'||h?.role!=='mid')return[];
 const cells=(h.team==='B'?CELLS.map(([q,r])=>[r,q]):CELLS).filter(p=>E.engagementMidCanTargetCell(s,h,p)),triples=[];
 for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++)for(let k=j+1;k<cells.length;k++){
  const points=[cells[i],cells[j],cells[k]];
  if(spellCellsLegal(s,h,points))triples.push(points.map(p=>[...p]));
 }
 return triples;
}
const spellGeometry=new Map();
function spellTargets(s,h){
 if(s.phase!=='map'||h?.role!=='mid')return [];
 const id=(h.team==='B'?'B':'A')+':'+key(h.p);
 if(!spellGeometry.has(id))spellGeometry.set(id,uncachedSpellTargets(s,h));
 return spellGeometry.get(id).map(cells=>cells.map(p=>[...p]));
}
function canReap(s,h,t){
 return s.phase==='map'&&h?.role==='adc'&&!!t?.role&&t.alive&&t.team!==h.team&&
  (E.sameEngagement(s,h,t)||dist(h,t)<=s.config.reapRange&&(isLane(h)||!isLane(t)));
}
function reapTargets(s,h){return s.heroes.filter(t=>canReap(s,h,t)).map(t=>t.id);}

function engageAllowedActions(s,h,r=s.turn+1){
 if(s.phase!=='map')return[];
 if(!h?.alive||h.stunUntil>=r)return['wait'];
 if(h.engageRecoveryUntil>=r)return['wait','recall',...(engageCanCast(s,h,r)?['engage']:[])];
 const combat=h.role==='support'?['heal',...(h.utilityReady<=r?['control']:[])]:['attack',...(h.role==='mid'&&h.spellReady<=r?['spell']:[]),...(h.role==='adc'&&h.reapReady<=r?['reap']:[])];
 if(E.engagementOf(s,h))return['wait',...combat];
 return['wait','move',...combat,'recall','capture','push',...(engageCanCast(s,h,r)?['engage']:[]),...(teleportCanUse(s,h,r)?['teleport']:[])];
}
function refreshEngagementMembers(s,ev=null,r=s.turn+1){
 s.engagements||=[];
 for(const e of s.engagements){
  e.members=e.members.filter(id=>{const h=s.heroes.find(x=>x.id===id);return h?.alive&&E.engagementContains(e,h);});
  for(const h of s.heroes)if(h.alive&&E.engagementContains(e,h)&&!e.members.includes(h.id)){
   e.members.push(h.id);if(!e.joined.includes(h.id))e.joined.push(h.id);
   if(ev)ev('engage_join',{engagement:e.id,unit:h.id,deadline:e.deadline});
  }
  e.members.sort();e.joined.sort();
 }
 for(const h of s.heroes)h.engagementId=E.engagementOf(s,h)?.id||null;
 return s;
}
function resolveEngagementCasts(s,orders,r,ev,coachUnits=new Set()){
 const casts=[],accepted=new Set();
 for(const h of s.heroes){
  const o=orders.get(h.id);if(!h.alive||o?.action!=='engage')continue;
  const coached=coachUnits.has(h.id);
  let reason=null;
  if(!engageCanCast(s,h,r,coached))reason='unavailable';
  else if(!valid(o.to)||dist(h,o.to)>s.config.engageTargetRange||o.target!==undefined||o.lane!==undefined)reason='center';
  else if(!engageCenterLegal(s,h,o.to))reason='enemy-center-required';
  const area=reason?[]:E.engagementCells(o.to),members=reason?[]:s.heroes.filter(x=>x.alive&&area.some(p=>key(p)===key(x.p)));
  if(!reason&&new Set(members.map(x=>x.team)).size!==2)reason='both-teams-required';
  if(reason){ev('invalid',{unit:h.id,reason:'engage-'+reason});continue;}
  casts.push({caster:h.id,coached,center:[...o.to],cells:area,initial:members.map(x=>x.id)});accepted.add(h.id);
 }
 if(!casts.length)return accepted;
 const nodes=[...s.engagements.map(e=>({kind:'old',e,cells:e.cells})),...casts.map(c=>({kind:'cast',c,cells:c.cells}))],seen=new Set(),fields=[];
 const overlaps=(a,b)=>a.cells.some(p=>b.cells.some(q=>key(p)===key(q))),unique=xs=>[...new Set(xs)],uniqueCells=xs=>[...new Map(xs.map(p=>[key(p),[...p]])).values()];
 for(let i=0;i<nodes.length;i++){
  if(seen.has(i))continue;const q=[i],component=[];seen.add(i);
  while(q.length){const n=q.pop();component.push(nodes[n]);for(let j=0;j<nodes.length;j++)if(!seen.has(j)&&overlaps(nodes[n],nodes[j])){seen.add(j);q.push(j);}}
  const old=component.filter(n=>n.kind==='old').map(n=>n.e),fresh=component.filter(n=>n.kind==='cast').map(n=>n.c);
  if(!fresh.length){fields.push(...old);continue;}
  const area=uniqueCells(component.flatMap(n=>n.cells)),allInitial=s.heroes.filter(h=>h.alive&&area.some(p=>key(p)===key(h.p))).map(h=>h.id).sort(),initiators=unique([...old.flatMap(e=>e.initiators),...fresh.map(c=>c.caster)]).sort();let e;
  if(old.length){
   const first=[...old].sort((a,b)=>a.deadline-b.deadline||a.id-b.id)[0];
   e={...first,cells:area,centers:uniqueCells([...old.flatMap(e=>e.centers),...fresh.map(c=>c.center)]),initiators,members:unique(old.flatMap(e=>e.members)).sort(),joined:unique([...old.flatMap(e=>e.joined),...allInitial]).sort(),deadline:Math.min(...old.map(e=>e.deadline))};
  }else{
   e={id:s.nextEngagementId++,openedAt:r,initialCount:allInitial.length,initialMembers:allInitial,deadline:r+allInitial.length,cells:area,centers:uniqueCells(fresh.map(c=>c.center)),initiators,members:[...allInitial],joined:[...allInitial]};
   ev('engage_start',{engagement:e.id,centers:clone(e.centers),members:[...allInitial],initialCount:e.initialCount,openedAt:r,firstCountedTurn:r+1,deadline:e.deadline,initiators:[...initiators]});
  }
  const coachTeams=unique([...old.flatMap(field=>field.coachTeams||[]),...fresh.filter(c=>c.coached).map(c=>c.caster[0])]);
  if(coachTeams.length){
   e.coachTeams=coachTeams;
   e.nativeInitiators=unique([...old.flatMap(field=>field.nativeInitiators||field.initiators),
     ...fresh.filter(c=>!c.coached).map(c=>c.caster)]);
  }
  if(old.length||fresh.length>1)ev('engage_merge',{engagement:e.id,old:old.map(e=>e.id),centers:clone(e.centers),deadline:e.deadline,extended:false,simultaneous:old.length===0});
  for(const cast of fresh)ev('engage_cast',{engagement:e.id,source:cast.caster,team:cast.caster[0],center:[...cast.center],deadline:e.deadline,...(cast.coached?{coach:true}:{})});
  fields.push(e);
 }
 s.engagements=fields.sort((a,b)=>a.id-b.id);refreshEngagementMembers(s,ev,r);return accepted;
}
function restrictEngagementOrders(s,orders,accepted,r,ev){
 for(const h of s.heroes){
  if(!h.alive)continue;const o=orders.get(h.id);if(accepted.has(h.id)&&o.action==='engage')continue;
  if(h.engageRecoveryUntil>=r&&!['wait','recall'].includes(o.action)){
   ev('engage_cancel',{unit:h.id,action:o.action,reason:'recovery'});orders.set(h.id,{unit:h.id,action:'wait'});continue;
  }
  if(E.engagementOf(s,h)&&!['wait','attack','spell','reap','heal','control'].includes(o.action)){
   ev('engage_cancel',{unit:h.id,action:o.action,reason:'engaged'});orders.set(h.id,{unit:h.id,action:'wait'});
  }
 }
}
function finishEngagements(s,r,ev){
 refreshEngagementMembers(s,ev,r);const keep=[];
 for(const e of s.engagements){
  const live=s.heroes.filter(h=>h.alive&&e.members.includes(h.id)),teams=[...new Set(live.map(h=>h.team))],reason=teams.length<2?'one-side':s.buildings.some(b=>b.kind==='base'&&b.hp<=0)?'base-end':r>=e.deadline?'round-limit':r>=s.config.maxTurns?'map-limit':null;
  if(!reason){keep.push(e);continue;}
  const recoveryTurn=r+1,initiatorTeams=[...new Set(e.initiators.map(id=>id[0]))];
  for(const id of e.joined){const h=s.heroes.find(h=>h.id===id),previousTeams=h.engageRecoveryUntil>=recoveryTurn?(h.engageRecoveryTeams||[]):[];h.engageRecoveryUntil=Math.max(h.engageRecoveryUntil||0,recoveryTurn);h.engageRecoveryTeams=[...new Set([...previousTeams,...initiatorTeams])];}
  for(const id of e.nativeInitiators||e.initiators){const h=s.heroes.find(h=>h.id===id);h.engageReady=Math.max(h.engageReady||1,recoveryTurn+s.config.engageCooldown);}
  for(const team of e.coachTeams||[]){
   s.coachEngageReady ||= {};
   s.coachEngageReady[team]=recoveryTurn+s.config.engageCooldown;
  }
  ev('engage_end',{engagement:e.id,reason,winner:teams.length===1?teams[0]:null,members:[...e.joined],initiators:[...e.initiators],recoveryTurn,cooldownReady:recoveryTurn+s.config.engageCooldown,deadline:e.deadline});
 }
 s.engagements=keep;refreshEngagementMembers(s,null,r);
}

function pushLanes(s,h,r=s.turn+1){return s.phase==='map'&&h?.alive&&h.stunUntil<r&&!E.engagementOf(s,h)&&!(h.engageRecoveryUntil>=r)?fronts(s).filter(f=>f.team===h.team&&key(f.p)===key(h.p)).map(f=>f.lane):[];}
function incomeLanes(s,h,p=h.p,r=s.turn+1){return fronts(s).filter(f=>f.team===h.team&&f.cells.some(x=>key(x)===key(p))&&(r>s.config.laneLock||roleLane(h.role)===f.lane)).map(f=>f.lane);}
function threatened(s,h){return s.heroes.some(f=>f.alive&&f.team!==h.team&&(E.sameEngagement(s,f,h)||isLane(f)&&dist(f,h)<=1));}
function observe(input,team){
 const s=prepare(clone(input));
 delete s._seed;delete s._mirrorRandomness;delete s._ancientPlans;delete s._prepareEvents;delete s.orders;
 s.ancientForecasts=ancientForecasts(s);s.you=team;s.decisionTurn=s.turn+1;
 s.structureDamageCap=structureDamageCap(s.config,s.decisionTurn);
 s.fronts=fronts(s);s.shields={A:shield(s,'A'),B:shield(s,'B')};
 s.heroes.forEach(h=>Object.assign(h,stats(h,s.config,s.decisionTurn),{
  terrain:isLane(h)?'lane':'jungle',
  recallAllowed:s.phase==='map'&&h.alive&&h.stunUntil<s.decisionTurn&&!E.engagementOf(s,h),
  engageAvailable:engageCanCast(s,h,s.decisionTurn),
  teleportAvailable:teleportCanUse(s,h,s.decisionTurn),
  teleportTargets:teleportTargets(s,h,s.decisionTurn).map(b=>b.id),
  pushLanes:pushLanes(s,h,s.decisionTurn),incomeLanes:incomeLanes(s,h,h.p,s.decisionTurn),
  spellTargets:spellTargets(s,h),
  spellEngagementTargets:h.role==='mid'?E.engagementEnemies(s,h).map(t=>t.id):[],
  reapTargets:reapTargets(s,h),allowedActions:engageAllowedActions(s,h,s.decisionTurn)
 }));
 if(s.phase==='final_battle')s.finalDecision=finalDecision(s);
 return s;
}
function coachOrderLegal(s,team,o,r=s.turn+1){
 const h=s.heroes.find(unit=>unit.id===o?.unit&&unit.team===team);
 if(!h?.alive||s.phase!=='map'||h.stunUntil>=r||!o||Object.keys(o).some(k=>!['unit','action','target','to','cells','lane'].includes(k)))return false;
 const {action,to,target,cells,lane}=o,t=s.heroes.find(unit=>unit.id===target);
 const usesTarget=['attack','reap','capture','heal','control'].includes(action);
 const usesPosition=['move','teleport','engage','coach_engage'].includes(action);
 if((target!==undefined)!==usesTarget||(to!==undefined)!==usesPosition||
    (lane!==undefined)!==(action==='push')||(cells!==undefined&&action!=='spell'))return false;
 if(action==='coach_engage')return engageCanCast(s,h,r,true)&&engageCenterLegal(s,h,to);
 if(!engageAllowedActions(s,h,r).includes(action))return false;
 if(action==='move')return valid(to)&&dist(h,to)===1;
 if(action==='teleport')return valid(to)&&teleportTargets(s,h,r).some(b=>key(b.p)===key(to));
 if(action==='engage')return engageCenterLegal(s,h,to);
 if(action==='push')return pushLanes(s,h,r).includes(lane);
 if(action==='attack')return !!t?.alive&&t.team!==team&&canHeroAttack(h,t,s);
 if(action==='reap')return canReap(s,h,t);
 if(action==='spell')return cells===undefined?!!E.engagementOf(s,h):spellCellsLegal(s,h,cells);
 if(action==='heal'||action==='control')return !!t?.alive&&(action==='heal'?t.team===team:t.team!==team)&&E.engagementCanUtility(s,h,t,action);
 if(action==='capture')return s.camps.some(c=>c.id===target&&c.alive&&c.hp>0&&dist(h,c)===0&&(h.role!=='support'||c.kind!=='normal'));
 return action==='wait'||action==='recall';
}
function applyCoach(s,commands,orders,r,ev){
 const coachUnits=new Set();
 for(const team of ['A','B']){
  const replacement=commands?.[team]?.coach;
  if(replacement==null)continue;
  if(!coachOrderLegal(s,team,replacement,r)){
   ev('coach_rejected',{team,unit:typeof replacement.unit==='string'?replacement.unit:null});
   continue;
  }
  const {unit,action}=replacement;
  ev('coach_override',{team,unit,before:clone(orders.get(unit)),after:clone(replacement)});
  if(action==='coach_engage')coachUnits.add(unit);
  orders.set(unit,action==='coach_engage'?{...replacement,action:'engage'}:replacement);
 }
 return coachUnits;
}
function neighbors(team,p){const order=team==='A'?[[0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0]]:[[-1,0],[-1,1],[0,1],[1,0],[1,-1],[0,-1]];return order.map(d=>[p[0]+d[0],p[1]+d[1]]).filter(valid);}
function uncachedPathTo(team,start,goal){if(!valid(goal))return null;const q=[start],prev=new Map([[key(start),null]]);let end=null;for(let i=0;i<q.length;i++){const p=q[i];if(key(p)===key(goal)){end=p;break;}for(const n of neighbors(team,p))if(!prev.has(key(n))){prev.set(key(n),p);q.push(n);}}if(!end)return null;const out=[end];while(prev.get(key(out.at(-1))))out.push(prev.get(key(out.at(-1))));return out.reverse();}

const paths=new Map();
function pathTo(team,start,goal){
 if(!valid(start)||!valid(goal))return uncachedPathTo(team,start,goal);
 const id=team+':'+key(start)+':'+key(goal);
 if(!paths.has(id))paths.set(id,uncachedPathTo(team,start,goal));
 return paths.get(id)?.map(p=>[...p])??null;
}
// The arena is a separate, sequential phase. It never invokes map preparation,
// awards gold, respawns dead heroes, or makes an algorithm's targeting choices.
function finalDecision(s){
 const b=s.battle,h=s.heroes.find(h=>h.id===b.actor),n=b.personalTurns[h.id]+1;
 const solo=h.role==='support'&&s.heroes.filter(x=>x.alive&&x.team===h.team).length===1;
 const forcedWait=b.skip[h.id]?'controlled':null;
 const legalActions=forcedWait?['wait']:h.role==='support'&&!solo?['heal',...(n>=b.controlReady[h.id]?['control']:[]),'wait']:['attack',...(h.role==='mid'&&n>=b.spellReady[h.id]?['spell']:[]),...(h.role==='adc'&&n>=b.reapReady[h.id]?['reap']:[]),'wait'];
 return{actor:h.id,team:h.team,personalTurn:n,round:b.round,forcedWait,supportSolo:solo,legalActions,controlReadyAt:b.controlReady[h.id],aoeReadyAt:b.spellReady[h.id],spellReadyAt:b.spellReady[h.id],reapReadyAt:b.reapReady[h.id]};
}
function beginFinalBattle(input){
 const s=clone(input),order=['A','B'].flatMap(team=>ROLES.map(role=>randomSide(s,team)+'_'+role));s.turn++;s.phase='final_battle';s.mapTurn=s.config.maxTurns;s.engagements=[];s.events=[];s.orders={A:[],B:[]};
 for(let i=order.length-1;i>0;i--){const j=Math.floor(rng(s._seed,'final-order',i)*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 for(const h of s.heroes){syncStats(h,s.config);h.alive=true;h.hp=h.maxHP;h.respawnAt=null;h.stunUntil=0;h.attackReady=1;h.spellReady=1;h.reapReady=1;h.utilityReady=1;}
 const zeros=()=>Object.fromEntries(order.map(id=>[id,0])),ones=()=>Object.fromEntries(order.map(id=>[id,1]));
 s.battle={order,cursor:0,actor:order[0],round:1,actions:0,personalTurns:zeros(),aoeReady:ones(),spellReady:ones(),reapReady:ones(),reapDamageThisRound:{},controlReady:ones(),skip:zeros()};
 delete s.incomePositions;delete s.incomeZones;
 s.events.push({kind:'final_start',order:[...order],mapTurn:s.mapTurn});return s;
}
function stepFinalBattle(input,commands){
 const s=clone(input),b=s.battle,d=finalDecision(s),h=s.heroes.find(x=>x.id===d.actor),byID=new Map(s.heroes.map(x=>[x.id,x]));
 s.turn++;b.actions++;b.personalTurns[h.id]++;s.events=[];s.orders={A:[],B:[]};const ev=(kind,data={})=>s.events.push({kind,...data});
 const raw=Array.isArray(commands?.[h.team]?.orders)?commands[h.team].orders:[],own=raw.filter(o=>o&&o.unit===h.id),o=own.length===1?own[0]:{unit:h.id,action:'wait'};
 s.orders[h.team]=clone(raw);ev('final_action',{unit:h.id,round:b.round,personalTurn:d.personalTurn});
 const invalid=reason=>ev('invalid',{unit:h.id,reason:'final-'+reason});
 function damage(t,amount,attackType='hero'){
  const applied=Math.min(t.hp,amount);t.hp=Math.max(0,t.hp-amount);
  const ledger=b.reapDamageThisRound[t.id]||(b.reapDamageThisRound[t.id]={});if(attackType==='reap'&&applied>0)ledger[h.id]=(ledger[h.id]||0)+applied;
  ev('final_hit',{source:h.id,target:t.id,damage:applied,raw:amount,attackType});
  if(t.hp<=0){
   t.alive=false;t.respawnAt=null;t.deaths++;h.kills++;s.teams[h.team].kills++;b.skip[t.id]=0;ev('final_kill',{source:h.id,target:t.id});
   const adc=byID.get(h.team+'_adc');
   if(ledger[adc.id]>0){b.reapReady[adc.id]=b.personalTurns[adc.id]+1;ev('reap_refresh',{unit:adc.id,target:t.id,reason:adc.id===h.id?'kill':'assist',scope:'battle-round'});}
  }
 }
 if(d.forcedWait){if(d.forcedWait==='controlled')b.skip[h.id]=0;ev('final_wait',{unit:h.id,reason:d.forcedWait});}
 else if(own.length>1)invalid('duplicate');
 else if(o.action==='wait')ev('final_wait',{unit:h.id,reason:'voluntary'});
 else if(o.action==='attack'&&(h.role!=='support'||d.supportSolo)){
  const t=byID.get(o.target);
  if(o.to!==undefined||o.cells!==undefined||!t?.alive||t.team===h.team)invalid('target');
  else{if(d.supportSolo)ev('support_attack',{source:h.id,power:stats(h,s.config).heal});damage(t,h.role==='support'?stats(h,s.config).heal:stats(h,s.config).damage);}
 }else if(o.action==='spell'&&h.role==='mid'){
  if(o.target!==undefined||o.to!==undefined||o.cells!==undefined)invalid('spell-all-targets');
  else if(d.personalTurn<b.spellReady[h.id])invalid('spell-cooldown');
  else{b.spellReady[h.id]=b.aoeReady[h.id]=d.personalTurn+s.config.spellCooldown;ev('final_spell',{source:h.id});for(const t of s.heroes.filter(t=>t.alive&&t.team!==h.team))damage(t,stats(h,s.config).damage,'spell');}
 }else if(o.action==='reap'&&h.role==='adc'){
  const t=byID.get(o.target);
  if(o.to!==undefined||o.cells!==undefined||!t?.alive||t.team===h.team)invalid('reap-target');
  else if(d.personalTurn<b.reapReady[h.id])invalid('reap-cooldown');
  else{b.reapReady[h.id]=d.personalTurn+s.config.reapCooldown;ev('final_reap',{source:h.id,target:t.id});damage(t,Math.floor(stats(h,s.config).damage*s.config.reapMultiplier),'reap');}
 }else if(h.role==='support'&&!d.supportSolo&&['heal','control'].includes(o.action)){
  const t=byID.get(o.target);
  if(o.to!==undefined||!t?.alive||(o.action==='heal'?t.team!==h.team:t.team===h.team))invalid('utility-target');
  else if(o.action==='heal'){const amount=Math.min(stats(h,s.config).heal,t.maxHP-t.hp);t.hp+=amount;ev('final_heal',{source:h.id,target:t.id,amount});}
  else if(d.personalTurn<b.controlReady[h.id])invalid('control-cooldown');
  else{b.controlReady[h.id]=d.personalTurn+s.config.controlCooldown;b.skip[t.id]=1;ev('final_control',{source:h.id,target:t.id});}
 }else invalid('action');
 const alive=s.heroes.filter(x=>x.alive);if(!alive.some(x=>x.team!==h.team)){s.result={winner:h.team,reason:'final-battle',mapTurns:s.mapTurn,battleActions:b.actions,battleRounds:b.round};b.actor=null;ev('final_end',{winner:h.team});return s;}
 // Advance through the original fixed order, omitting heroes who died permanently.
 for(let n=0;n<b.order.length;n++){b.cursor++;if(b.cursor>=b.order.length){b.cursor=0;b.round++;b.reapDamageThisRound={};}const next=byID.get(b.order[b.cursor]);if(next.alive){b.actor=next.id;return s;}}
 throw Error('Final battle has no living actor');
}

function step(input,commands){
 if(input.result)return clone(input);if(input.phase==='final_pending')return beginFinalBattle(input);if(input.phase==='final_battle')return stepFinalBattle(input,commands);const s=prepare(clone(input)),c=s.config,r=s.turn+1;s.turn=r;s.mapTurn=r;s.events=s._prepareEvents||[];delete s._prepareEvents;s.orders={A:[],B:[]};const ev=(kind,data={})=>s.events.push({kind,...data}),byID=new Map([...s.heroes,...s.buildings,...s.camps].map(x=>[x.id,x])),orders=new Map(),active=s.heroes.filter(h=>h.alive),before=new Map(s.heroes.map(h=>[h.id,{...stats(h,c,r),gold:h.gold,p:[...h.p],alive:h.alive}])),combatAlive=new Set(active.map(h=>h.id));
 for(const team of ['A','B']){const raw=Array.isArray(commands?.[team]?.orders)?commands[team].orders:[];s.orders[team]=clone(raw);for(const h of s.heroes.filter(h=>h.team===team)){const found=raw.filter(o=>o&&o.unit===h.id);orders.set(h.id,found.length===1?found[0]:{unit:h.id,action:'wait'});if(found.length>1)ev('invalid',{unit:h.id,reason:'duplicate'});}}
 const coachUnits=applyCoach(s,commands,orders,r,ev);
 const acceptedEngages=resolveEngagementCasts(s,orders,r,ev,coachUnits);restrictEngagementOrders(s,orders,acceptedEngages,r,ev);
 const movedNormally=new Set(),usable=h=>h.stunUntil<r;
 for(const h of active){
  const o=orders.get(h.id);if(!usable(h)){ev('stun',{unit:h.id});continue;}
  if(o.action==='move'){if(!valid(o.to)||dist(h,o.to)!==1){ev('invalid',{unit:h.id,reason:'move'});continue;}const from=h.p;h.p=[...o.to];movedNormally.add(h.id);ev('move',{unit:h.id,from,to:h.p});}
  else if(o.action==='teleport'){
   if(!teleportCanUse(s,h,r)){ev('invalid',{unit:h.id,reason:'teleport-unavailable'});continue;}
   const target=valid(o.to)&&o.target===undefined&&o.lane===undefined?teleportTargets(s,h,r).find(b=>key(b.p)===key(o.to)):null;
   if(!target){ev('invalid',{unit:h.id,reason:'teleport-friendly-base-or-tower-anchor'});continue;}
   const from=[...h.p];h.p=[...target.p];h.teleportReady=r+c.teleportCooldown;ev('teleport',{unit:h.id,team:h.team,target:target.id,from,to:[...h.p],readyAt:h.teleportReady});
  }
 }
 refreshEngagementMembers(s,ev,r);const shields={A:shield(s,'A'),B:shield(s,'B')},gates=new Map(s.buildings.map(b=>[b.id,vulnerable(s,b)])),damage=[],controls=new Set(),ancientOrders=new Map(),pushOrders=new Map();
 const protection=c.earlyTowerCover?new Map(active.map(h=>[h.id,towerCover(s,h,r,active)])):null;
 function attack(source,target,scale=1,attackType=null){
  if(target.kind==='ancient'){const list=ancientOrders.get(target.id)||[];list.push({source:source.id,team:source.team,count:source.role==='jungle'?2:1});ancientOrders.set(target.id,list);return;}
  const cover=protection?.get(target.id)??0;
  const raw=target.role?Math.floor(before.get(source.id).damage*scale):1;
  const amount=cover?Math.floor(raw*(1-cover)+1e-9):raw;
  ev('hit',{source:source.id,target:target.id,p:1,damage:amount,attackType:attackType||(target.role?'hero':'capture'),...(cover?{towerCover:cover}:{})});
  damage.push({source:source.id,target:target.id,team:source.team,kind:target.role?'hero':'capture',amount,attackType:attackType||(target.role?'hero':'capture')});if(target.role&&c.randomAttackOrder){target.hp=Math.max(0,target.hp-amount);if(target.hp<=0)target.alive=false;}
 }
 for(const h of active){if(!usable(h))continue;const o=orders.get(h.id);if(!['heal','control'].includes(o.action))continue;const t=byID.get(o.target);if(h.role!=='support'||(o.action==='control'&&h.utilityReady>r)||!t?.role||!t.alive||!E.engagementCanUtility(s,h,t,o.action)||(o.action==='heal'?t.team!==h.team:t.team===h.team)){ev('invalid',{unit:h.id,reason:'utility'});continue;}if(o.action==='control')h.utilityReady=r+c.controlCooldown;if(o.action==='heal'){const amount=Math.min(before.get(h.id).heal,t.maxHP-t.hp);t.hp+=amount;ev('heal',{source:h.id,target:t.id,amount});}else{const p=1,success=true;if(success)controls.add(t.id);ev('control',{source:h.id,target:t.id,p,success});}}
 const submittedAttacks=active.filter(h=>usable(h)&&['attack','spell','reap'].includes(orders.get(h.id).action)),attackIds=c.randomAttackOrder?attackSequence(s,submittedAttacks.map(h=>h.id)):[];
 if(c.randomAttackOrder&&attackIds.length)ev('attack_order',{order:attackIds});
 const actionActors=c.randomAttackOrder?[...active.filter(h=>!['attack','spell','reap'].includes(orders.get(h.id).action)),...attackIds.map(id=>byID.get(id))]:active;
 for(const h of actionActors){
  if(!usable(h))continue;const o=orders.get(h.id);
  if(c.randomAttackOrder&&!h.alive){if(['attack','spell','reap'].includes(o.action))ev('attack_cancelled',{unit:h.id,reason:'dead-before-attack'});continue;}
  if(['move','wait','heal','control','recall','engage','teleport'].includes(o.action))continue;
  if(o.action==='push'){const f=fronts(s).find(f=>f.team===h.team&&f.lane===o.lane);if(o.target!==undefined||o.to!==undefined||!f||key(h.p)!==key(f.p)){ev('invalid',{unit:h.id,reason:'push-position-or-lane'});continue;}pushOrders.set(h.id,o.lane);continue;}
  if(o.action==='spell'){
   const field=o.cells===undefined?E.engagementOf(s,h):null;
   if(h.role!=='mid'||h.spellReady>r||o.target!==undefined||o.to!==undefined||o.lane!==undefined||
      (!field&&!spellCellsLegal(s,h,o.cells))){ev('invalid',{unit:h.id,reason:'spell'});continue;}
   if(field){
    h.spellReady=r+c.spellCooldown;
    const targets=E.engagementEnemies(s,h);
    ev('spell',{source:h.id,cells:clone(field.cells),engagement:field.id,targets:targets.map(t=>t.id),readyAt:h.spellReady});
    for(const t of targets)attack(h,t,1,'spell');
    continue;
   }
   h.spellReady=r+c.spellCooldown;const cells=o.cells.map(p=>[...p]);ev('spell',{source:h.id,cells,readyAt:h.spellReady});
   for(const t of s.heroes.filter(t=>t.alive&&t.team!==h.team)){
    if(cells.some(p=>key(p)===key(t.p))){attack(h,t,1,'spell');continue;}
    const old=before.get(t.id),canRace=c.economicDodge&&movedNormally.has(t.id)&&cells.some(p=>key(p)===key(old.p));
    if(!canRace)continue;
    const probability=dodgeProbability(old.gold,before.get(h.id).gold,c),success=escapeRoll(s,r,h,t)<probability;
    ev('move_escape',{source:h.id,target:t.id,attackType:'spell',probability,success,from:[...old.p],to:[...t.p]});if(!success)attack(h,t,1,'spell');
   }
  }else if(o.action==='reap'){
   const t=byID.get(o.target);
   if(h.role!=='adc'||h.reapReady>r||o.to!==undefined||o.cells!==undefined||o.lane!==undefined||!t?.role||!t.alive||t.team===h.team){if(c.randomAttackOrder&&t?.role&&!t.alive&&t.team!==h.team&&before.get(t.id)?.alive)ev('attack_cancelled',{unit:h.id,target:t.id,reason:'target-died-before-attack'});else ev('invalid',{unit:h.id,reason:'reap'});continue;}
   if(!canReap(s,h,t)){
    const old=before.get(t.id),canRace=c.economicDodge&&movedNormally.has(t.id)&&dist(h,t)>c.reapRange&&dist(h,old.p)<=c.reapRange&&(isLane(h)||!isLane(old.p));
    if(!canRace){ev('invalid',{unit:h.id,reason:'reap'});continue;}
    h.reapReady=r+c.reapCooldown;ev('reap',{source:h.id,target:t.id,readyAt:h.reapReady});
    const probability=dodgeProbability(old.gold,before.get(h.id).gold,c),success=escapeRoll(s,r,h,t)<probability;
    ev('move_escape',{source:h.id,target:t.id,attackType:'reap',probability,success,from:[...old.p],to:[...t.p]});if(success)continue;
   }else{h.reapReady=r+c.reapCooldown;ev('reap',{source:h.id,target:t.id,readyAt:h.reapReady});}
   attack(h,t,c.reapMultiplier,'reap');
  }else if(o.action==='attack'){
   if(h.role==='support'){ev('invalid',{unit:h.id,reason:'support-attack'});continue;}
   const t=byID.get(o.target);
   if(o.to!==undefined||o.cells!==undefined||!t?.role||!t.alive||t.team===h.team){if(c.randomAttackOrder&&t?.role&&!t.alive&&t.team!==h.team&&before.get(t.id)?.alive)ev('attack_cancelled',{unit:h.id,target:t.id,reason:'target-died-before-attack'});else ev('invalid',{unit:h.id,reason:'hero-target'});continue;}
   if(!canHeroAttack(h,t,s)){
    const old=before.get(t.id),canRace=c.economicDodge&&movedNormally.has(t.id)&&dist(h,t)>1&&dist(h,old.p)<=1&&(isLane(h)||!isLane(old.p));
    if(!canRace){ev('invalid',{unit:h.id,reason:'hero-target'});continue;}
    h.attackReady=r+1;const probability=dodgeProbability(old.gold,before.get(h.id).gold,c),success=escapeRoll(s,r,h,t)<probability;
    ev('move_escape',{source:h.id,target:t.id,probability,success,from:[...old.p],to:[...t.p]});if(success)continue;
   }
   h.attackReady=r+1;attack(h,t);
  }else if(o.action==='capture'){
   const t=byID.get(o.target);
   if(o.to!==undefined||!t||!s.camps.includes(t)||t.hp<=0||t.alive===false){ev('invalid',{unit:h.id,reason:'capture-target'});continue;}
   if(h.role==='support'&&t.kind==='normal'){ev('invalid',{unit:h.id,reason:'support-normal'});continue;}
   if(dist(h,t)!==0){ev('invalid',{unit:h.id,reason:'capture-same-cell'});continue;}
   if(s.buildings.includes(t)&&!gates.get(t.id)){ev('protected',{source:h.id,target:t.id});continue;}
   attack(h,t);
  }else ev('invalid',{unit:h.id,reason:'action'});
 }
 for(const [id,hits]of ancientOrders){
  const counts={A:0,B:0};for(const hit of hits)counts[hit.team]+=hit.count;
  const total=counts.A+counts.B,eligible=total>=c.ancientRequired;
  ev('ancient_progress',{target:id,counts,damage:eligible?1:0,sources:hits.map(x=>x.source)});
  if(eligible){const tied=counts.A===counts.B,owner=tied?resourceTie(s,r,'ancient-tie',id):(counts.A>counts.B?'A':'B');damage.push({source:hits.find(x=>x.team===owner).source,target:id,team:owner,kind:'ancient',amount:1,counts,tied});}
 }
 const sums=new Map();for(const d of damage)sums.set(d.target,(sums.get(d.target)||0)+d.amount);for(const b of s.buildings.filter(b=>b.kind==='base')){const raw=sums.get(b.id)||0,cap=shields[b.team].cap;if(cap!==null&&raw>cap){sums.set(b.id,cap);ev('base_cap',{target:b.id,raw,applied:cap,open:shields[b.team].opened});}}
 for(const [id,n]of sums){const t=byID.get(id);if(!(c.randomAttackOrder&&t.role))t.hp=Math.max(0,t.hp-n);}
 for(const h of active)if(h.hp<=0){h.alive=false;h.deaths++;const wait=c.respawnStart+Math.floor((r-1)/c.respawnStage)*c.respawnStep;h.respawnAt=r+wait+1;h.stunUntil=0;const hits=damage.filter(d=>d.target===h.id&&d.team===enemy(h.team));if(hits.length){const team=enemy(h.team),killer=hits.slice().sort((a,b)=>b.amount-a.amount||a.source.localeCompare(b.source))[0];byID.get(killer.source).kills++;s.teams[team].kills++;const adc=byID.get(team+'_adc');if(hits.some(d=>d.source===adc.id&&d.attackType==='reap'&&d.amount>0)){adc.reapReady=r;ev('reap_refresh',{unit:adc.id,target:h.id,reason:killer.source===adc.id?'kill':'assist',scope:'map-turn'});}const members=active.filter(a=>a.team===team&&combatAlive.has(a.id)&&dist(a,h)<=c.killRadius),awards=killAwards(byID.get(killer.source),members,c.killGold,s);ev('kill',{target:h.id,team,killer:killer.source,awards,respawnAt:h.respawnAt});}else ev('death',{target:h.id,respawnAt:h.respawnAt});}
 for(const a of s.camps)if(a.alive&&a.hp<=0){
  a.alive=false;a.spawnAt=a.kind==='ancient'?(c.randomAncients?null:nextAncient(a,r,c)):r+c.normalRespawn;
  const hits=damage.filter(d=>d.target===a.id).sort((a,b)=>a.source.localeCompare(b.source));
  const counts={A:0,B:0};for(const d of hits)counts[d.team]+=d.amount;
  const tied=a.kind==='ancient'?hits[0].tied:counts.A===counts.B;
  const owner=a.kind==='ancient'?hits[0].team:(tied?resourceTie(s,r,'normal-tie',a.id):counts.A>counts.B?'A':'B');
  if(owner){a.captures[owner]++;const members=a.kind==='ancient'?s.heroes.filter(h=>h.team===owner):[...new Set(hits.filter(d=>d.team===owner).map(d=>d.source))].map(id=>byID.get(id));if(a.kind==='ancient')s.teams[owner].ancients++;const awards=share(members,a.kind==='ancient'?(c.randomAncients?a.goldPool:c.ancientGold):c.normalGold,a.kind==='ancient'?'ancient':'normal',s);ev(a.kind==='ancient'?'ancient':'camp',{team:owner,target:a.id,awards,spawnAt:a.spawnAt,tied,counts:a.kind==='ancient'?hits[0].counts:counts});if(a.kind==='ancient'&&c.randomAncients){planAncient(s,a,r);announceAncients(s,r,ev);}}
 }

 // Resolve recall before the income/push snapshot. Combat is complete; new controls
 // still only disable next round. This round's income uses the old zone AND old positions.
 for(const h of active){
  if(!h.alive||orders.get(h.id).action!=='recall'||!usable(h))continue;
  if((sums.get(h.id)||0)>0||controls.has(h.id))ev('recall_fail',{unit:h.id});
  else{h.p=[...FOUNTAIN[h.team]];h.hp=h.maxHP;ev('recall',{unit:h.id});}
 }

 const incomeFronts=fronts(s),incomePositions=new Map(s.heroes.filter(h=>h.alive).map(h=>[h.id,[...h.p]]));
 s.incomeZones=clone(incomeFronts);s.incomePositions=Object.fromEntries(incomePositions);
 const plans=[];
 for(const lane of LANES){
  const entries={A:[],B:[]};for(const h of s.heroes)if(h.alive&&pushOrders.get(h.id)===lane)entries[h.team].push(h);
  const counts={A:entries.A.length,B:entries.B.length},powers={A:entries.A.reduce((n,h)=>n+(h.role==='support'?before.get(h.id).heal:before.get(h.id).damage),0),B:entries.B.reduce((n,h)=>n+(h.role==='support'?before.get(h.id).heal:before.get(h.id).damage),0)};
  if(!counts.A&&!counts.B)continue;
  let contestCounts=counts,contestPowers=powers;
  if(c.earlyHomePushPriority&&r<=c.earlyStructureUntil&&counts.A&&counts.B){
   const home=Object.fromEntries(['A','B'].map(team=>[team,entries[team].filter(h=>roleLane(h.role)===lane)]));
   if(home.A.length||home.B.length){
    contestCounts={A:home.A.length,B:home.B.length};
    contestPowers=Object.fromEntries(['A','B'].map(team=>[team,home[team].reduce((power,h)=>
     power+(h.role==='support'?before.get(h.id).heal:before.get(h.id).damage),0)]));
   }
  }
  const winner=contestCounts.A===contestCounts.B?(contestPowers.A===contestPowers.B?null:contestPowers.A>contestPowers.B?'A':'B'):contestCounts.A>contestCounts.B?'A':'B';
  ev('push_contest',{lane,counts,powers,winner,sources:{A:entries.A.map(h=>h.id),B:entries.B.map(h=>h.id)}});
  if(!winner)continue;
  const f=incomeFronts.find(f=>f.team===winner&&f.lane===lane),delta=winner==='A'?1:-1,indices=[...f.indices],members=entries[winner];
  if(indices.length===1){plans.push({kind:'expand',lane,winner,from:indices,to:winner==='A'?[indices[0],indices[0]+1]:[indices[0]-1,indices[0]],members});continue;}
  const target=s.buildings.find(b=>b.team===enemy(winner)&&b.hp>0&&key(b.p)===key(f.frontP));
  if(target){
   const raw=members.reduce((n,h)=>n+before.get(h.id).towerDamage,0);
   let cap=structureDamageCap(c,r);
   if(cap!=null&&c.earlySplitSupport>0){
    const covered=incomeFronts.filter(front=>front.team===winner&&front.lane!==lane&&
     s.heroes.some(h=>h.team===winner&&h.alive&&roleLane(h.role)===front.lane&&
      front.cells.some(p=>key(p)===key(incomePositions.get(h.id))))).length;
    if(covered<c.earlySplitSupport)cap=Math.min(cap,1);
   }
   if(r<=c.earlyStructureUntil&&c.earlySingleFrontInnerCap!=null&&(target.kind==='base'||target.tier==='inner')){
    const openedOuters=s.buildings.filter(b=>b.team===target.team&&b.tier==='outer'&&b.hp<=0).length;
    if(openedOuters<2)cap=Math.min(cap??Infinity,c.earlySingleFrontInnerCap);
   }
   const allowed=gates.get(target.id),applied=allowed?Math.min(raw,cap??Infinity):0;
   plans.push({kind:'damage',lane,winner,target,raw,applied,members,allowed,limited:allowed&&applied<raw});continue;
  }
  const to=indices.map(i=>i+delta);if(to[0]<0||to.at(-1)>=PATHS[lane].length){ev('push_edge',{lane,team:winner});continue;}
  plans.push({kind:'advance',lane,winner,from:indices,to,members,delta});
 }
 // All lane contests use the same pre-push snapshot. Structural losses cannot
 // unlock another gate or change the shared base cap during this same round.
 const baseRemaining={};for(const team of ['A','B'])baseRemaining[team]=shields[team].cap===null?Infinity:shields[team].cap;
 const displacements=new Map();
 for(const plan of plans){
  const {lane,winner,members}=plan;
  if(plan.kind==='damage'){
   const target=plan.target,amount=target.kind==='base'?Math.min(plan.applied,baseRemaining[target.team]):plan.applied;
   if(target.kind==='base')baseRemaining[target.team]-=amount;
   const applied=Math.min(target.hp,amount);target.hp-=applied;
   ev('push_damage',{lane,team:winner,target:target.id,raw:plan.raw,damage:applied,protected:!plan.allowed,...(plan.limited?{earlyCap:plan.applied}:{}),sources:members.map(h=>h.id)});
   continue;
  }
  s.lanes[lane].indices=[...plan.to];
  if(plan.kind==='expand'){ev('mid_expand',{lane,team:winner,from:plan.from,to:plan.to});continue;}
  ev('line_shift',{lane,team:winner,from:plan.from,to:plan.to});
  for(const h of members){
   const from=incomePositions.get(h.id),i=PATHS[lane].findIndex(p=>key(p)===key(from));
   displacements.set(h.id,{lane,from,to:PATHS[lane][i+plan.delta],kind:'push_follow'});
  }
  for(const h of s.heroes.filter(h=>h.alive&&h.team!==winner)){
   const from=incomePositions.get(h.id),i=PATHS[lane].findIndex(p=>key(p)===key(from));
   if(!plan.from.includes(i))continue;
   if(E.engagementOf(s,h)){ev('engage_hold',{unit:h.id,engagement:E.engagementOf(s,h).id,lane});continue;}
   const next=i+plan.delta;if(next<0||next>=PATHS[lane].length)throw Error('Push crossed a live base');
   const prior=displacements.get(h.id);
   if(!prior||(prior.kind==='push_retreat'&&roleLane(h.role)===lane)){
    displacements.set(h.id,{lane,from,to:PATHS[lane][next],kind:'push_retreat'});
   }
  }
 }
 for(const h of s.heroes){
  const move=displacements.get(h.id);if(!move)continue;
  h.p=[...move.to];ev(move.kind,{unit:h.id,lane:move.lane,from:[...move.from],to:[...h.p]});
 }
 refreshEngagementMembers(s,ev,r);
 for(const b of s.buildings.filter(b=>b.kind==='tower'&&b.hp<=0))if(input.buildings.find(a=>a.id===b.id).hp>0){const team=enemy(b.team);s.teams[team].towers++;const awards=share(s.heroes.filter(h=>h.team===team),b.tier==='inner'?c.innerGold:c.outerGold,'tower',s);ev('tower',{team,target:b.id,lane:b.lane,tier:b.tier,awards});}
 for(const id of controls){const h=byID.get(id);if(h.alive)h.stunUntil=r+1;}
 const zones=incomeFronts,memberships=new Map();
 for(const h of s.heroes.filter(h=>h.alive)){
  const preferred=roleLane(h.role),eligible=zones.filter(f=>f.team===h.team&&f.cells.some(p=>key(p)===key(incomePositions.get(h.id)))&&(r>c.laneLock||preferred===f.lane));
  eligible.sort((a,b)=>(a.lane===preferred?-1:0)-(b.lane===preferred?-1:0)||LANES.indexOf(a.lane)-LANES.indexOf(b.lane));
  memberships.set(h.id,(c.stackLaneIncome?eligible:eligible.slice(0,1)).map(f=>f.lane));
 }
 for(const team of ['A','B'])for(const lane of LANES){const f=zones.find(f=>f.team===team&&f.lane===lane),members=s.heroes.filter(h=>h.alive&&h.team===team&&memberships.get(h.id)?.includes(lane));if(members.length)ev('income',{team,lane,zone:f.p,cells:clone(f.cells),positions:members.map(h=>({id:h.id,p:incomePositions.get(h.id)})),awards:share(members,c.laneGold,'lane',s)});}
 for(const h of s.heroes){
  syncStats(h,c);
  if(h.alive&&key(h.p)===key(FOUNTAIN[h.team])&&h.hp<h.maxHP){
   h.hp=h.maxHP;
   ev('fountain',{unit:h.id});
  }
 }
 finishEngagements(s,r,ev);
 const bases=['A','B'].map(t=>s.buildings.find(b=>b.id===t+'_base'));if(bases.some(b=>b.hp<=0))s.result={winner:bases.every(b=>b.hp<=0)?null:bases[0].hp<=0?'B':'A',reason:'base'};else if(r>=c.maxTurns){s.phase='final_pending';ev('final_pending',{mapTurn:r});}
 return s;
}
return{VERSION,C,ROLE_STATS,growthFactors,structureDamageCap,spellCellsLegal,spellTargets,canReap,reapTargets,pushLanes,incomeLanes,ancientForecasts,dodgeProbability,attackSequence,simulate,syncStats,nextAncient,ROLES,NAMES,LANES,HOME,FOUNTAIN,PATHS,DIRS,CELLS,key,dist,valid,enemy,clone,setGold,stats,towerDamage,hitChance,rng,share,killAwards,makeState,prepare,openedLanes,shield,vulnerable,laneAt,roleLane,incomePath,fronts,pushPosition,isLane,canHeroAttack,threatened,observe,neighbors,pathTo,finalDecision,beginFinalBattle,stepFinalBattle,...E,teleportCanUse,teleportTargets,engageCenterLegal,engageCanCast,engageAllowedActions,refreshEngagementMembers,previewEngage,coachOrderLegal,step};
});
