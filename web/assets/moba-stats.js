(()=>{'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=(x,d=0)=>Number(x||0).toLocaleString('zh-CN',{maximumFractionDigits:d}),roles={top:'上路',jungle:'打野',mid:'中路',adc:'射手',support:'辅助'};
function award(a,label){return `<div class="award-card"><small>${label}${a?.winners?.length>1?' · 共同获奖':''}</small>${a?.winners?.length?a.winners.map(w=>`<strong>${esc(w.displayName)}</strong><span>贡献评分 ${num(w.score,2)}${w.mapMVPs!==undefined?' · '+w.mapMVPs+'次小局 MVP':''}</span>`).join(''):'<span>尚未颁发</span>'}</div>`;}
function rules(){return `<div class="scoring-guide"><h3>ROLE IMPACT / 评分规则 v1</h3><p>MVP：每个有效小局结束，从胜队的五位选手中评选。POM：整场 BO 结束，从胜队评选；采用所有已打有效小局的平均贡献评分，包含输掉的小局。</p><p>先按每100有效回合计算各项数据（地图回合＋决战行动数÷10），与赛前封存的同位置样本比较。四个维度的权重如下：</p><div class="scroll"><table><thead><tr><th>位置</th><th>战斗</th><th>目标</th><th>支援</th><th>经济</th></tr></thead><tbody>${[['上路',35,40,0,25],['打野',35,50,0,15],['中路',65,20,0,15],['射手',60,20,0,20],['辅助',10,10,70,10]].map(r=>`<tr>${r.map((v,i)=>`<td>${v}${i?'%':''}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>战斗＝55%有效英雄伤害＋25%击杀＋20%推导助攻；目标＝50%建筑贡献＋30%远古贡献＋20%野区贡献；支援＝60%有效队友治疗＋40%成功控制；经济＝累计金币。各项先转为同位置百分位，加权后扣除10%的阵亡率百分位，再用同位置综合分布校准为0—100分。</p><p>基线固定为已完成的780局互打，每位置1560份样本；本赛季的新对局不回流基线。评分不影响胜负、积分或晋级。只有实际战斗、治疗、控制、目标或击杀贡献才有获奖资格，单靠金币不能获奖。</p><p>平分使用完整精度：MVP 比较较低阵亡率百分位；POM 依次比较小局 MVP 次数、较低平均阵亡率百分位；仍相同则共同获奖。平局、技术无效局不颁 MVP，未完成或技术暂停的 BO 不颁 POM。</p><details><summary>数据口径与归因</summary><p>击杀、阵亡、金币来自引擎终局计数。伤害扣除溢出，治疗只给有效队友治疗计分，自疗单列。助攻是公开事件推导值：前3个地图回合／30个决战行动内，对受害者造成伤害或控制，或治疗击杀者，每次击杀去重。建筑伤害在事件记录的参与者间均分；远古贡献采用引擎的打野2倍参与权重；野区贡献在奖励领取者间均分。这些归因规则用于稳定、可复算的比较，并不等同于个人因果贡献。</p></details></div>`;}
function delta(value,cls='',attrs=''){value=Math.round(value*1e6)/1e6;let sign=value>0?'+':value<0?'−':'';return `<span class="${cls} ${value>0?'econ-up':value<0?'econ-down':'econ-even'}" data-econ-gap="${value}" ${attrs}>${sign}${num(Math.abs(value),Math.abs(value)<1?6:1)}</span>`;}
function reportLogo(v){
 const id=v.participant||'',prefix=id.split('-')[0],brand={gpt:'openai',sol:'openai',astra:'openai',opus:'claude',fable:'claude',google:'gemini',glm:'zhipu',hy4:'hunyuan',moonshotai:'kimi',xiaomi:'mimo',upstage:'solar-llm'}[prefix]||prefix;
 if(!['openai','claude','deepseek','doubao','gemini','grok','hunyuan','kimi','minimax','mimo','qwen','solar-llm','zhipu'].includes(brand))return '<span class="report-monogram">M/</span>';
 const path='/assets/'+brand+(brand==='minimax'?'.webp':brand==='mimo'?'.png':'.svg');
 if(['minimax','mimo'].includes(brand))return `<span class="report-logo" role="img" aria-label="${esc(v.name)}" style="background-image:url('${path}');background-size:${brand==='minimax'?'570%':'800%'} auto;background-position:${brand==='minimax'?'30%':'65%'} 50%;background-repeat:no-repeat"></span>`;
 return `<img class="report-logo" src="${path}" alt="${esc(v.name)}">`;
}
function panel(t,pom){
 const mvps=new Set(t.mvp?.winners?.map(w=>w.key)||[]),opponent=p=>t.players.find(o=>o.team!==p.team&&o.role===p.role),gap=p=>p.gold-(opponent(p)?.gold||0),A=t.teams.A,B=t.teams.B;
 const status=v=>!t.valid?'技术无效':!t.winner?'DRAW':t.winner===v.participant?'WIN':'LOSS';
 const compare=(a,label,b,d=0)=>`<tr><td>${num(a,d)}</td><th scope="row">${label}</th><td>${num(b,d)}</td></tr>`;
 const maxDamage=Math.max(1,...t.players.map(p=>p.damageHeroes));
 const damageRows=Object.entries(roles).map(([role,label])=>{
  const a=t.players.find(p=>p.team==='A'&&p.role===role),b=t.players.find(p=>p.team==='B'&&p.role===role);
  if(!a||!b)return '';
  return `<div class="report-damage-row"><div class="report-damage-name"><span>${esc(a.displayName)}</span><small>${label}</small><span>${esc(b.displayName)}</span></div><div class="report-damage-bars"><div class="report-bar report-blue" style="--fill:${a.damageHeroes/maxDamage*100}%"><span>${num(a.damageHeroes,0)}</span></div><div class="report-bar report-red" style="--fill:${b.damageHeroes/maxDamage*100}%"><span>${num(b.damageHeroes,0)}</span></div></div></div>`;
 }).join('');
 return `<article class="postgame moba-report" aria-label="小局赛后技术报告">
 <div class="report-kicker"><span>HEX MOBA / POSTGAME</span><span>${num(t.mapTurns)} 地图回合${t.battleActions?' · '+num(t.battleActions)+' 决战行动':''}</span></div>
 <div class="post-score"><div class="post-team">${reportLogo(A)}<div><strong>${esc(A.name)}</strong><small class="win-label">${status(A)} <span>BLUE / A</span></small></div></div><div class="votes">${num(A.kills)}:${num(B.kills)}<small>KILLS / 击杀</small></div><div class="post-team">${reportLogo(B)}<div><strong>${esc(B.name)}</strong><small class="win-label">${status(B)} <span>RED / B</span></small></div></div></div>
 <div class="tech-summary">${Object.entries(t.teams).map(([side,v])=>`<div><small>${side==='A'?'BLUE':'RED'} / ${esc(v.name)}</small><strong>${num(v.gold,1)} <span>GOLD</span></strong><p>${num(v.towers)} 塔 · ${num(v.ancients)} 远古 · 总经济差 ${delta(v.gold-t.teams[side==='A'?'B':'A'].gold,'team-gold-gap',`data-side="${side}"`)} 金</p></div>`).join('')}</div>
 <div class="report-comparison"><section><h3>DAMAGE TO CHAMPIONS <small>对英雄有效伤害</small></h3>${damageRows}</section><section><h3>TEAM COMPARISON <small>双方技术对照</small></h3><table class="report-team-table"><tbody>${compare(A.kills,'击杀',B.kills)}${compare(A.gold,'总金币',B.gold,1)}${compare(A.towers,'拆塔',B.towers)}${compare(A.ancients,'夺取远古',B.ancients)}${compare(A.damageHeroes,'有效英雄伤害',B.damageHeroes,1)}${compare(A.healingAllies,'队友治疗',B.healingAllies,1)}</tbody></table></section></div>
 <section class="tech-economy" data-economy-state="loading" aria-label="全局经济差曲线"><p class="status-note">正在读取经济差曲线…</p></section>
 <div class="awards">${award(t.mvp,'本局 MVP')}${pom?award(pom,'整场 POM'):''}</div>
 <div class="report-section-heading"><h3>PLAYER STATISTICS</h3><span>十位选手 / 逐人技术数据</span></div>
 <div class="scroll" tabindex="0" aria-label="选手技术表，可横向滚动"><table class="player-stats"><thead><tr><th scope="col">选手 / 位置</th><th scope="col">K / D / A*</th><th scope="col">金币</th><th scope="col" title="本人减对方同位置选手的金币">对位经济差</th><th scope="col">有效伤害</th><th scope="col">队友治疗</th><th scope="col">控制</th><th scope="col">建筑伤害*</th><th scope="col">野区 / 远古*</th><th scope="col">贡献分</th></tr></thead><tbody>${t.players.map(p=>`<tr class="${mvps.has(p.key)?'map-mvp':''}" data-player-key="${esc(p.key)}"><td><strong>${esc(p.displayName)}</strong><small>${roles[p.role]}${mvps.has(p.key)?' · MVP':''}</small></td><td>${p.kills} / ${p.deaths} / ${p.assistsDerived}</td><td>${num(p.gold,1)}</td><td title="对位 ${esc(opponent(p)?.displayName||'')}">${delta(gap(p),'lane-gold-gap')}</td><td>${num(p.damageHeroes,1)}</td><td>${num(p.healingAllies,1)}</td><td>${p.controlHits}</td><td>${num(p.structuralDamageShared,1)}</td><td>${num(p.campCredits,2)} / ${num(p.ancientCredits,2)}</td><td class="impact">${num(p.rating.score,2)}</td></tr>`).join('')}</tbody></table></div>
 <p class="status-note report-attribution">* 助攻及建筑／野区／远古个人贡献按公开事件归因。K/D、金币为引擎计数。</p>
 <details><summary>逐人补充技术数据与评分维度</summary><div class="extra-stats">${t.players.map(p=>`<article><b>${esc(p.displayName)}</b><p>KDA ${num(p.kda,2)} · 承伤 ${num(p.damageTaken,1)} · 自疗 ${num(p.healingSelf,1)} · 参团率 ${num(p.killParticipation*100,1)}% · 参与破塔 ${p.towersParticipated} · 传送 ${p.teleports} · 回城 ${p.recalls} · 无效指令 ${p.invalidCommands}</p><p>战斗 ${num(p.rating.dimensions.combat,1)} / 目标 ${num(p.rating.dimensions.objectives,1)} / 支援 ${num(p.rating.dimensions.utility,1)} / 经济 ${num(p.rating.dimensions.economy,1)}（同位置百分位）</p></article>`).join('')}</div></details>
 <div class="post-meta">REAL ENGINE / ${esc(t.id)}<br>${num(t.mapTurns)} 个地图回合＋${num(t.battleActions)} 个决战行动 · 评分 ${esc(t.version)} · 数据与奖项按原口径保留</div></article>`;
}

const economyCache=new Map();
async function attachEconomy(container,url,technical){
 const host=container?.querySelector('.tech-economy');if(!host)return;
 try{
  if(!economyCache.has(url)){
   const pending=fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('无法读取回放');return r.json();}).catch(e=>{economyCache.delete(url);throw e;});
   economyCache.set(url,pending);if(economyCache.size>6)economyCache.delete(economyCache.keys().next().value);
  }
  const raw=await economyCache.get(url);if(!host.isConnected)return;
  MobaEconomyCurve.mount(host,(raw.game||raw).frames,{A:technical.teams.A.name,B:technical.teams.B.name});host.dataset.economyState='ready';
 }catch(e){if(host.isConnected){host.dataset.economyState='error';host.innerHTML='<p>经济曲线暂时无法读取。</p><button type="button">重试</button>';host.querySelector('button').onclick=()=>attachEconomy(container,url,technical);}}
}
window.MobaStats={esc,num,roles,award,rules,panel,attachEconomy};
})();
