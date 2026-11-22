(()=>{'use strict';
const $=s=>document.querySelector(s),Q=new URLSearchParams(location.search),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sid=Q.get('season'),fid=Q.get('fixture'),box=Q.get('id'),formal=!!sid;
const player=MobaBroadcast.mount($('#arena-app'),{live:true,liveReview:formal,bridge:false});
let last='',data=null,modeReplay=false,renderKey='',submitting=false,ended=false,timer,polling=false,pollAgain=false;
let reviewing=false,reviewGame=null,summaryId=null,summaryPending=null,nexting=false,generation=0,operations=Promise.resolve();
let streamRecord=null,rosterKey='';
const summariesShown=new Set();
const completedAnimations=new Set();
window.ArenaViewer={player,get data(){return data;},get reviewing(){return reviewing;}};
async function api(url,d){const r=await fetch(url,d?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}:{cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error||'操作失败');return v;}
function operate(d){const task=operations.catch(()=>{}).then(()=>api('/api/season/'+encodeURIComponent(sid)+'/operate',{fixture:fid,...d}));operations=task;return task;}
function overrides(d){const teams=Array.isArray(d.teams)?Object.fromEntries(d.teams.map(t=>[t.id,t])):null;return Object.fromEntries(['A','B'].map(s=>{const id=d.game.labels[s],t=teams?teams[id]:d.teams[s];return[s,{participant:id,team:t?.name||id,region:t?.region,players:Object.fromEntries((t?.players||[]).map(p=>[p.role,p.id])),baseline:id.startsWith('baseline:')}];}));}
function mergeStream(d){
 if(!d.game)return d;const g=d.game,start=g.frameStart;
 if(start==null){streamRecord=g;return d;}
 if(start===0)streamRecord={...g,frames:g.frames.slice()};
 else if(streamRecord?.id===g.id&&streamRecord.frames.length===start){
  const frames=streamRecord.frames;frames.push(...g.frames);Object.assign(streamRecord,g,{frames});
 }else{streamRecord=null;throw Error('正在重新连接播放画面…');}
 return {...d,game:streamRecord};
}
function mapComplete(){
 if(!data?.gameDone||player.game?.id!==data.game.id)return false;
 if(completedAnimations.has(data.game.id))return true;
 if(player.k===player.n()-1&&player.u>=.99&&!player.playing){completedAnimations.add(data.game.id);return true;}
 return false;
}
function syncSandbox(d){
 const active=['queued','running'].includes(d.status);
 const labels={queued:'等待演算',running:'实时沙盒',completed:'已结束',stopped:'已结束并保留记录',technical_hold:'技术暂停',interrupted:'已断开 · 记录保留'};
 $('#viewerTitle').textContent=d.name+' · '+(labels[d.status]||d.status);
 $('#viewerStatus').textContent=modeReplay?'回放模式 · 可拖动进度条，不改变对局':d.interrupted?d.message:!active?'本局已结束，记录已保留，可进入回放查看':d.request?.waiting?'等待人类下达第 '+d.request.turn+' 回合指令':d.control?.paused?'演算已暂停，可单步推进':'程序正在原引擎中实时演算';
 $('#pauseLive').textContent=d.control?.paused?'继续演算':'暂停演算';
 for(const id of ['pauseLive','singleStep','pace','stopSandbox','resumeLive'])$('#'+id).disabled=!active;
 $('#newSandbox').hidden=active;$('#replayMode').disabled=!d.game?.frames?.length;
 $('#editHumanIds').hidden=!Object.values(d.controllers||{}).includes('human');
 human(d);
}
async function paint(d){
 if(!d.game||modeReplay||(formal&&reviewGame))return;
 const key=d.game.id+':'+d.game.frames.length,names=JSON.stringify(overrides(d)),same=player.game?.id===d.game.id;
 if(key!==last||names!==rosterKey){
  if(same&&names===rosterKey)player.appendGame(d.game);
  else{const hero=player.hero;await player.loadGame(d.game,{teams:overrides(d),round:same?player.k:d.game.frames.length-1,autoplay:false});if(hero)player.select(hero);}
  last=key;rosterKey=names;
 }
 player.q('.mb-sub').textContent=formal?'焦点桌 · 完整动画 · 可回看已播部分':'沙盒实时演算 · 完整动画';
 if(formal){if(!reviewing)player.followStream(!d.paused||(d.gameDone&&!mapComplete()));}
 else player.followStream(true);
}
function watched(){return data?.watchedGames||(data?.game?[{id:data.game.id,map:data.map,complete:!!data.gameDone}]:[]);}
function syncFormal(){
 if(!formal||!data)return;const complete=mapComplete(),selected=reviewGame||watched().find(g=>g.id===data.game?.id);
 $('#viewerTitle').textContent=fid+' · '+(selected?'第'+selected.map+'小局'+(reviewGame?' · 回看':''):'焦点桌');
 $('#watchSpeed').value=String(data.speed||1);$('#returnLive').hidden=!reviewing;
 $('#pauseLive').textContent=reviewing?(player.playing?'暂停回看':'播放回看'):player.playing?'暂停观看':'继续观看';$('#pauseLive').hidden=complete&&!reviewing;
 const play=player.q('.mb-play'),atFront=!reviewGame&&player.k>=player.n()-1&&!data.gameDone;
 const label=(reviewing&&!atFront)?(player.playing?'暂停回看':'播放回看'):complete?'回看本局':player.playing?'暂停观看':'继续观看';
 play.textContent=label==='暂停观看'||label==='暂停回看'?'❚❚':'▶';play.title=label;play.setAttribute('aria-label',label);
 if(reviewing&&atFront)$('#pauseLive').textContent='继续观看';
 $('#mapStats').hidden=!(reviewGame?.complete||(!reviewGame&&complete));
 $('#nextMap').hidden=!(complete&&!data.boDone);$('#nextMap').disabled=nexting;
 $('#viewerStatus').textContent=reviewing?'回看已播部分 · 当前播放已停住，可拖动时间轴或点击要闻中的记录':data.waiting?data.message:data.technicalHold?data.message:data.gameDone&&!complete?'正在播放本小局最后的完整动画…':complete?(data.boDone?'本场已播完，可查看技术总结或回看已播小局':'本小局已播完 · 查看技术总结后，手动进入下一把'):data.paused?'观看已暂停，可回看已播部分':'焦点桌 · 时间轴只包含已播画面，可随时回看';
 const list=watched(),value=reviewGame?.id||data.game?.id||'',key=JSON.stringify(list);
 if($('#watchedMap').dataset.key!==key){$('#watchedMap').innerHTML=list.map(g=>`<option value="${E(g.id)}">第 ${g.map} 小局 · ${g.complete?'已看完':'当前播放'}</option>`).join('');$('#watchedMap').dataset.key=key;}
 $('#watchedMap').value=value;$('#watchedMapControl').hidden=list.length<2;
 const f=player.game?.frames[player.k],end=player.game?.frames.at(-1);
 if(f&&end){player.q('.mb-counter').textContent='第 '+f.turn+' 回合 · 已播至 '+end.turn;player.q('.mb-pct').textContent=reviewing?'回看已播部分':complete?'本小局已播完':data.gameDone?'最后动画播放中':data.paused?'观看已暂停，点击播放继续':'本小局仍在播放';}
 $('#roundResult').hidden=!(data.boDone&&complete);if(data.boDone&&complete&&data.fixture){const f=data.fixture,names=Object.fromEntries((data.teams||[]).map(t=>[t.id,t.name]));$('#roundResult').hidden=false;$('#roundResult').innerHTML=`本场结束 · ${E(f.entrants.map(x=>names[x]||x).join(' / '))}　${f.score.join(' : ')} <a href="/?season=${encodeURIComponent(sid)}">返回本轮 →</a>`;}
}
function beginReview(){
 if(!formal||reviewing)return operations;reviewing=true;player.pause();syncFormal();
 if(data&&!data.paused&&!data.gameDone)return operate({action:'pause',paused:true}).then(()=>{if(data)data.paused=true;syncFormal();}).catch(e=>{$('#viewerStatus').textContent=e.message;});
 return operations;
}
player.on('review',()=>{beginReview();});player.on('round',()=>{syncFormal();});
player.on('drained',()=>{
 syncFormal();if(!formal||reviewGame)return;
 if(reviewing)returnCurrent(true).catch(e=>{$('#viewerStatus').textContent=e.message;});
 else if(mapComplete()&&!summariesShown.has(data.game.id))showSummary(data.game.id);
});
if(formal){player.q('.mb-seek').setAttribute('aria-label','已播部分进度');player.q('.mb-last').title='跳到已播末尾';player.q('.mb-first').title='回看开局';}
async function poll(){
 clearTimeout(timer);if(ended)return;if(polling){pollAgain=true;return;}polling=true;const version=generation;
 try{
  const suffix=formal&&streamRecord?'?game='+encodeURIComponent(streamRecord.id)+'&after='+(streamRecord.frames.length-1):'';
  let d=await api(formal?'/api/season/'+encodeURIComponent(sid)+'/stream/'+encodeURIComponent(fid)+suffix:'/api/sandbox/'+encodeURIComponent(box));if(version!==generation){pollAgain=true;return;}if(formal)d=mergeStream(d);data=d;await paint(d);
  if(formal){player.setSpeed(d.speed||1);syncFormal();if(d.gameDone){ended=true;if(!reviewing&&mapComplete()&&!summariesShown.has(d.game.id))await showSummary(d.game.id);}}
  else syncSandbox(d);
 }catch(e){$('#viewerStatus').textContent=e.message;}
 finally{polling=false;const again=pollAgain;pollAgain=false;if(!ended)timer=setTimeout(poll,again?0:formal?Math.max(80,Math.min(250,250/(data?.speed||1))):500);}
}
async function returnCurrent(preservePosition=false){
 if(!data?.game)return;const same=player.game?.id===data.game.id;player.pause();reviewing=false;reviewGame=null;last='';await paint(data);
 if(same&&!preservePosition)player.seekStream(player.n()-1);
 syncFormal();
 if(mapComplete()){await showSummary(data.game.id);return;}
 if(data.gameDone){player.followStream(true);syncFormal();return;}
 await operate({action:'pause',paused:false});data.paused=false;player.followStream(true);ended=false;syncFormal();poll();
}
async function reviewMap(gid){
 if(!data?.game)return;if(gid===data.game.id){await returnCurrent();return;}
 const known=watched().find(g=>g.id===gid&&g.complete);if(!known)return;
 await beginReview();const game=await api('/api/season/'+encodeURIComponent(sid)+'/game/'+encodeURIComponent(gid));reviewGame=known;player.pause();await player.loadGame(game,{teams:overrides({...data,game}),round:0,autoplay:false});syncFormal();
}
function summaryActions(){
 const current=summaryId===data?.game?.id;
 $('#nextMapSummary').hidden=!(current&&mapComplete()&&!data.boDone);$('#nextMapSummary').disabled=nexting;
 $('#summaryBack').hidden=!(current&&data?.boDone&&mapComplete());$('#summaryBack').href='/?season='+encodeURIComponent(sid);
}
async function showSummary(gid){
 if(!gid||summaryPending===gid)return;const known=watched().find(g=>g.id===gid&&g.complete);if(!known&&!(gid===data?.game?.id&&data.gameDone))return;
 summaryPending=gid;summaryId=gid;$('#technicalTitle').textContent='第 '+(known?.map||data.map)+' 小局 · 技术总结';$('#technicalBody').textContent='正在载入技术总结…';summaryActions();
 if(!$('#technicalDialog').open)$('#technicalDialog').showModal();$('#technicalDialog').scrollTop=0;
 try{const r=await api('/api/season/'+encodeURIComponent(sid)+'/technical/'+encodeURIComponent(gid));if(summaryId!==gid)return;$('#technicalBody').innerHTML=MobaStats.panel(r);MobaStats.attachEconomy($('#technicalBody'),'/api/season/'+encodeURIComponent(sid)+'/game/'+encodeURIComponent(gid),r);summariesShown.add(gid);}
 catch(e){$('#technicalBody').textContent=e.message;}finally{if(summaryPending===gid)summaryPending=null;}
}
async function nextMap(){
 if(nexting||!mapComplete()||data.boDone)return;nexting=true;syncFormal();summaryActions();
 try{await operate({action:'next-map',game:data.game.id});generation++;$('#technicalDialog').close();player.pause();reviewing=false;reviewGame=null;summaryId=null;last='';ended=false;$('#roundResult').hidden=true;$('#viewerStatus').textContent='正在进入下一把…';await poll();}
 catch(e){$('#viewerStatus').textContent=e.message;}
 finally{nexting=false;syncFormal();summaryActions();}
}
let hud=null;
function human(d){if(!formal&&window.MobaSandboxHuman){$('#humanPanel').hidden=true;hud=hud||MobaSandboxHuman.mount({player,api,box,refresh:()=>poll()});hud.update(d,{replay:modeReplay});return;}const req=d.request||{},sides=req.teams||[],selected=$('#humanSide')?.value||sides[0],key=req.turn+':'+req.waiting+':'+(d.submittedSides||[]).join(',')+':'+selected;if(key===renderKey)return;renderKey=key;const panel=$('#humanPanel');if(formal||!req.waiting||!sides.length){panel.hidden=true;return;}panel.hidden=false;const side=sides.includes(selected)?selected:sides[0],obs=req.observations[side],submitted=d.submittedSides?.includes(side);const actor=obs.finalDecision?.actor||obs.battle?.actor;const units=obs.heroes.filter(h=>h.team===side&&h.alive&&(obs.phase!=='final_battle'||h.id===actor));const targets=[...obs.heroes,...obs.camps,...obs.buildings];const titles={wait:'等待',move:'移动',attack:'攻击',capture:'夺取野怪／远古',push:'推进兵线／建筑',heal:'治疗',control:'控制',recall:'回城',teleport:'传送',engage:'开启交战'};
panel.innerHTML=`<h3>人类控制 · 第 ${req.turn} 回合</h3><label>控制方 <select id="humanSide">${sides.map(t=>`<option ${side===t?'selected':''}>${t}</option>`).join('')}</select></label><p><small>双方提交后共同结算；未下达的英雄等待。移动需相邻格，传送需己方存活防御塔坐标；推进选择兵线。具体非法指令会按原规则处理并在战报中说明。</small></p>${submitted?'<p>本方已提交，等待另一方。</p>':`<form id="humanForm">${units.map(h=>`<div class="human-order" data-unit="${E(h.id)}"><b>${E(h.id)} · [${h.p.join(',')}]</b><select class="action">${(obs.phase==='final_battle'?obs.finalDecision.legalActions:(h.allowedActions||Object.keys(titles))).map(a=>`<option value="${a}">${titles[a]||a}</option>`).join('')}</select><select class="target">${targets.filter(t=>t.id!==h.id).map(t=>`<option value="${E(t.id)}">${E(t.id)}${t.p?' ['+t.p.join(',')+']':''}</option>`).join('')}</select><label>q <input class="q" type="number" min="-4" max="4" value="${h.p[0]}"></label><label>r <input class="r" type="number" min="-4" max="4" value="${h.p[1]}"></label><select class="lane"><option value="top">上路</option><option value="mid">中路</option><option value="bottom">下路</option></select></div>`).join('')}<button type="submit" ${submitting?'disabled':''}>提交 ${side==='A'?'蓝方':'红方'} 本回合指令</button></form>`}`;
}
$('#backArena').href=formal?'/?season='+encodeURIComponent(sid):'/?sandbox=1';$('#otherDesk').hidden=!formal;$('#otherDesk').href=formal?'/?season='+encodeURIComponent(sid):'/';$('#replayMode').hidden=formal;$('#resumeLive').hidden=formal;$('#singleStep').hidden=formal;$('#stopSandbox').hidden=formal;$('#pace').hidden=formal;$('#watchSpeedControl').hidden=!formal;
async function toggleWatch(){try{if(formal){
 if(reviewing){if(!reviewGame&&!data?.gameDone&&player.k>=player.n()-1){await returnCurrent(true);return;}player.toggle();syncFormal();return;}
 if(data?.gameDone){if(!mapComplete()){player.playing?player.pause():player.followStream(true);syncFormal();return;}await beginReview();player.seek(0);player.play();syncFormal();return;}
 const paused=!data?.paused;await operate({action:'pause',paused});if(data)data.paused=paused;player.followStream(!paused);syncFormal();
 }else await api('/api/sandbox/'+box+'/control',{paused:!data?.control?.paused});poll();}catch(e){$('#viewerStatus').textContent=e.message;}}
$('#pauseLive').onclick=toggleWatch;if(formal)player.q('.mb-play').onclick=toggleWatch;
$('#watchSpeed').onchange=async e=>{const select=e.target,speed=+select.value;select.disabled=true;try{await operate({action:'speed',speed});if(data)data.speed=speed;player.setSpeed(speed);syncFormal();}catch(err){select.value=String(data?.speed||1);$('#viewerStatus').textContent=err.message;}finally{select.disabled=false;}};
$('#returnLive').onclick=()=>returnCurrent().catch(e=>{$('#viewerStatus').textContent=e.message;});
$('#watchedMap').onchange=e=>reviewMap(e.target.value).catch(err=>{$('#viewerStatus').textContent=err.message;});
$('#nextMap').onclick=nextMap;$('#nextMapSummary').onclick=nextMap;
$('#reviewSummary').onclick=async()=>{const gid=summaryId;$('#technicalDialog').close();try{if(gid!==data?.game?.id)await reviewMap(gid);else{await beginReview();reviewGame=null;if(player.game?.id!==gid)await player.loadGame(data.game,{teams:overrides(data),round:0,autoplay:false});player.pause();player.seek(0);syncFormal();}}catch(e){$('#viewerStatus').textContent=e.message;}};
$('#singleStep').onclick=()=>api('/api/sandbox/'+box+'/control',{step:true});let stopArmed=0;$('#stopSandbox').onclick=()=>{const b=$('#stopSandbox');if(Date.now()-stopArmed>4000){stopArmed=Date.now();b.textContent='再点一次确认结束';b.classList.add('sbh-armed');setTimeout(()=>{if(stopArmed&&Date.now()-stopArmed>=4000){stopArmed=0;b.textContent='结束并保留记录';b.classList.remove('sbh-armed');}},4050);return;}stopArmed=0;b.textContent='结束并保留记录';b.classList.remove('sbh-armed');api('/api/sandbox/'+box+'/control',{stop:true}).then(()=>poll()).catch(e=>{$('#viewerStatus').textContent=e.message;});};$('#pace').onchange=e=>api('/api/sandbox/'+box+'/control',{delayMs:+e.target.value});
$('#replayMode').onclick=async()=>{if(!data?.game)return;modeReplay=true;if(hud)hud.update(data,{replay:true});player.setLive(false);await player.loadGame(data.game,{teams:overrides(data),round:0});$('#viewerStatus').textContent='回放模式 · 可拖动进度条；正在进行的演算保持独立';};$('#resumeLive').onclick=()=>{modeReplay=false;if(hud&&data)hud.update(data,{replay:false});player.setLive(true);last='';poll();};
$('#mapStats').onclick=()=>showSummary(reviewGame?.id||data?.game?.id);$('#closeTechnical').onclick=()=>$('#technicalDialog').close();
if(!formal){
 const dialog=$('#humanIdsDialog'),form=$('#humanIdsForm');
 $('#editHumanPresets').onclick=()=>MobaHumanIds.openProfiles();
 $('#editHumanIds').onclick=()=>{
  if(!data)return;
  $('#humanIdsFields').innerHTML=['A','B'].filter(side=>data.controllers?.[side]==='human').map(side=>MobaHumanIds.fields(side,data.humanIds?.[side]||{})).join('');
  $('#humanIdsError').textContent='';dialog.showModal();
 };
 $('#closeHumanIds').onclick=()=>dialog.close();
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;
  try{
   const ids=MobaHumanIds.validate(MobaHumanIds.read(form));
   const updated=await api('/api/sandbox/'+encodeURIComponent(box)+'/names',{humanIds:ids});
   MobaHumanIds.remember(ids);
   data=updated;
   if(modeReplay&&data.game){const round=player.k,playing=player.playing,hero=player.hero;await player.loadGame(data.game,{teams:overrides(data),round,autoplay:playing});if(hero)player.select(hero);rosterKey=JSON.stringify(overrides(data));}
   else await paint(data);
   syncSandbox(data);dialog.close();
  }catch(error){$('#humanIdsError').textContent=error.message;}
  finally{button.disabled=false;}
 };
}
document.addEventListener('change',e=>{if(e.target.id==='humanSide'){renderKey='';human(data);}});document.addEventListener('submit',async e=>{if(e.target.id!=='humanForm')return;e.preventDefault();if(submitting)return;submitting=true;e.submitter.disabled=true;const side=$('#humanSide').value,orders=[...e.target.querySelectorAll('[data-unit]')].map(el=>{const action=el.querySelector('.action').value,o={unit:el.dataset.unit,action};if(['move','teleport','engage'].includes(action))o.to=[+el.querySelector('.q').value,+el.querySelector('.r').value];if(['attack','capture','heal','control'].includes(action))o.target=el.querySelector('.target').value;if(action==='push')o.lane=el.querySelector('.lane').value;return o;});try{await api('/api/sandbox/'+box+'/input',{side,turn:data.request.turn,orders});renderKey='';await poll();}catch(err){$('#viewerStatus').textContent=err.message;}finally{submitting=false;}});
document.addEventListener('visibilitychange',()=>{if(formal&&document.hidden&&data&&!data.paused&&!data.gameDone)operate({action:'pause',paused:true}).catch(()=>{});});poll();
})();
