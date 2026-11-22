/* Recorded-event announcements. No game simulation or objective last-hit invention. */
(function(root){
  'use strict';
  const MB=root.MobaBroadcast;
  const hero=id=>/^[AB]_(top|jungle|mid|adc|support)$/.test(id||'');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const unique=ids=>[...new Set(ids.filter(hero))];
  function index(game){
    const all=[],byFrame=game.frames.map(()=>[]);
    game.frames.forEach((frame,k)=>{
      for(const [eventIndex,e] of frame.events.entries()){
        if(e.basis||!['kill','final_kill','tower','ancient','death'].includes(e.kind))continue;
        let item={key:k+':'+eventIndex,k,eventIndex,kind:e.kind,team:e.team||null,target:e.target,actors:[],assistants:[],attribution:'record'};
        if(e.kind==='kill'||e.kind==='final_kill'){
          const credit=frame.killCredits.find(c=>c.eventIndex===eventIndex);
          const killer=e.killer||e.source;
          if(!hero(killer)||!hero(e.target))continue;
          item={...item,kind:'kill',team:killer[0],actors:[killer],assistants:credit?.assistants||[],attribution:'role-impact-v1'};
        }else if(e.kind==='death'){
          if(!hero(e.target))continue;
          item.kind='death';item.team=e.target[0]==='A'?'B':'A';
        }else{
          const previous=frame.events.slice(0,eventIndex);
          const damage=previous.filter(x=>x.target===e.target&&x.kind===(e.kind==='tower'?'push_damage':'ancient_progress')&&x.damage>0&&!x.protected).at(-1);
          const explicit=e.killer||e.source;
          item.actors=hero(explicit)?[explicit]:unique(damage?.sources||[]).filter(id=>id[0]===e.team);
          item.attribution=item.actors.length===1?'single-finisher':item.actors.length>1?'joint-finish':'not-recorded';
        }
        byFrame[k].push(item);all.push(item);
      }
    });
    return {all,byFrame};
  }
  const round=(game,k)=>game.frames[k].phase==='map'?'R'+game.frames[k].mapTurn:'决战·'+(game.frames[k].battle?.actions??k);
  const label={kill:'击杀',death:'阵亡',tower:'防御塔告破',ancient:'远古已夺取'};
  const glyph={kill:'⚔',death:'×',tower:'塔',ancient:'◆'};
  function describe(game,event){
    const names=event.actors.map(id=>game.name(id));
    const place=MB.story.placeName(game,event.target);
    if(event.kind==='kill')return names[0]+' 击杀 '+game.name(event.target);
    if(event.kind==='death')return game.name(event.target)+' 阵亡';
    const verb=event.kind==='tower'?'摧毁':'夺取';
    return (names.length?names.join('、')+(names.length>1?' 合力':''):game.teams[event.team].team)+' '+verb+' '+place;
  }
  function portrait(id){return hero(id)?`<canvas class="mb-flash-portrait" data-unit="${id}" width="12" height="14" aria-hidden="true"></canvas>`:'';}
  class Highlights{
    constructor(player){this.player=player;this.host=player.q('.mb-combat-hud');this.data=index(player.game);this.lastKey=null;}
    render(k){
      const game=this.player.game,frame=game.frames[k],final=frame.phase==='final_battle',window=final?30:5;
      const recent=this.data.all.filter(e=>e.k<=k&&e.k>=k-window);
      const log=this.host.querySelector('.mb-alert-log'),banner=this.player.q('.mb-big-announcement');
      const key=recent.map(e=>e.key).join('|');
      if(key!==this.lastKey){
        this.lastKey=key;log.hidden=!recent.length;
        log.innerHTML=recent.length?`<div class="mb-alert-heading">战场快报 <small>${recent.length} 条</small></div><div class="mb-alert-cards">${recent.slice().reverse().map(e=>this.card(game,e)).join('')}</div>`:'';
        log.querySelectorAll('canvas[data-unit]').forEach(c=>{const unit=c.dataset.unit;c.getContext('2d').drawImage(MB.sprite(unit.slice(2),unit[0]),0,0);});
      }
      const latest=recent.at(-1),fresh=latest&&k-latest.k<=(final?5:1);
      banner.hidden=!fresh;
      if(fresh){
        const batch=this.data.byFrame[latest.k],batchKey=batch.map(e=>e.key).join('|');
        if(banner.dataset.batch!==batchKey){
          banner.dataset.batch=batchKey;
          banner.dataset.team=batch.every(e=>e.team===batch[0].team)?batch[0].team:'both';
          banner.dataset.kind=batch.length===1?batch[0].kind:'burst';
          const kills=batch.filter(e=>e.kind==='kill').length,towers=batch.filter(e=>e.kind==='tower').length,ancients=batch.filter(e=>e.kind==='ancient').length;
          const headline=batch.length===1?label[batch[0].kind]:[kills?'击杀 ×'+kills:'',towers?'破塔 ×'+towers:'',ancients?'远古 ×'+ancients:''].filter(Boolean).join(' · ')||'战场告急';
          banner.innerHTML=`<div class="mb-announcement-label">${esc(round(game,latest.k))} / BATTLE ALERT</div><strong class="mb-announcement-title">${esc(headline)}</strong><div class="mb-announcement-lines">${batch.slice(0,3).map(e=>`<p data-key="${e.key}">${esc(describe(game,e))}</p>`).join('')}</div>${batch.length>3?`<small>还有 ${batch.length-3} 条，见右侧战报 →</small>`:''}`;
        }
      }else delete banner.dataset.batch;
      this.host.hidden=!this.player.settings.reports;
      this.player.q('.mb-announcement-slot').hidden=!this.player.settings.reports;
    }
    card(game,e){
      const finisher=e.attribution==='joint-finish'?'合力终结':e.attribution==='single-finisher'?'终结者':e.kind==='death'?'无英雄击杀者':e.attribution==='not-recorded'?'终结者未记录':'';
      return `<article class="mb-alert-card" data-key="${e.key}" data-kind="${e.kind}" data-team="${e.team}" data-frame="${e.k}" data-actors="${e.actors.join(',')}" data-assistants="${e.assistants.join(',')}" data-attribution="${e.attribution}" title="${esc(describe(game,e))}"><div class="mb-alert-meta"><b>${glyph[e.kind]} ${label[e.kind]}</b><small>${esc(round(game,e.k))}</small></div><div class="mb-alert-primary">${e.actors.length===1?portrait(e.actors[0]):''}<span>${esc(describe(game,e))}</span>${e.kind==='kill'?portrait(e.target):''}</div>${e.kind==='kill'?`<div class="mb-alert-assists">助攻${e.assistants.length?'*：'+e.assistants.map(id=>esc(game.name(id))).join('、'):'：无'}</div>`:`<div class="mb-alert-assists">${esc(finisher)}</div>`}</article>`;
    }
  }
  MB.highlights={index,describe};MB.Highlights=Highlights;
})(typeof window!=='undefined'?window:globalThis);
