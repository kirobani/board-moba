(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const modeNames = {sealed:'正式杯赛',test:'测试杯赛',realtime:'实时正式杯赛'};
  const layout = [
    [['0–0',8,1,'','']],
    [['1–0',4,1,'',''],['0–1',4,1,'','']],
    [['2–0',2,3,'胜者晋级','up'],['1–1',4,1,'',''],['0–2',2,3,'负者淘汰','out']],
    [['2–1',3,3,'胜者晋级','up'],['1–2',3,3,'负者淘汰','out']],
    [['2–2',3,3,'胜者晋级 · 负者淘汰','both']],
  ];
  const swissLines = [
    [1,'0–0',2,'1–0','up'],[1,'0–0',2,'0–1','out'],[2,'1–0',3,'2–0','up'],[2,'1–0',3,'1–1','out'],
    [2,'0–1',3,'1–1','up'],[2,'0–1',3,'0–2','out'],[3,'2–0',4,'2–1','out'],[3,'1–1',4,'2–1','up'],
    [3,'1–1',4,'1–2','out'],[3,'0–2',4,'1–2','up'],[4,'2–1',5,'2–2','out'],[4,'1–2',5,'2–2','up'],
  ];
  const root = $('#cup-main');
  const ident = new URLSearchParams(location.search).get('id');
  const endpoint = '/api/cups' + (ident ? '/'+encodeURIComponent(ident) : '');
  let data, signature, filter = 'sealed', busy = false, fetching = false, player, viewing, revision = 0;

  async function api(url, body) {
    const res = await fetch(url, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {cache:'no-store'});
    const result = await res.json();
    if (!res.ok) throw Error(result.error || '杯赛暂时不可用');
    return result;
  }
  function showError(message, target = '#cup-error') {
    const node = $(target);
    node.hidden = !message;
    node.textContent = message;
  }
  function status(cup) {
    if (cup.verified) return cup.mode==='test' || cup.revealed===8 ? '已完赛 · 核验通过' : '已封存 · 核验通过';
    if (cup.needsAttention || ['technical_hold','verification_hold'].includes(cup.status)) return '技术暂停';
    if (cup.draw && !cup.draw.complete) return '等待抽签';
    if (cup.status==='running' || (cup.mode==='sealed' && cup.settled>0)) return '正在演算';
    if (cup.mode==='sealed') return '等待演算';
    return '准备开赛';
  }
  function home() {
    const visible = data.cups.filter(c => c.mode===filter);
    return `<section class="cup-hero"><div><h1>杯赛</h1><p>16 支队伍 · 三胜晋级 · 八强单败 BO5</p></div><button class="cup-primary" data-create>新建杯赛</button></section>
      <nav class="cup-filters" aria-label="杯赛模式">${Object.entries(modeNames).map(([id,name])=>
        `<button class="cup-filter" data-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join('')}</nav>
      <section class="cup-list" aria-label="${modeNames[filter]}">${visible.map(c=>`<a class="cup-tile" href="?id=${encodeURIComponent(c.id)}">
        <span><em>${c.settled}/${c.total}</em>${status(c)}</span><strong>${esc(c.name)}</strong><span>进入赛程 →</span></a>`).join('') || `<p class="cup-empty">还没有${modeNames[filter]}。</p>`}</section>`;
  }
  function team(id) {
    const t = data.teams[id];
    const mark = `<span class="logo cup-logo cup-logo-initial" aria-hidden="true">${esc(t.region.slice(0, 2))}</span>`;
    return `<span class="cup-team">${mark}<b>${esc(t.name)}</b><small>#${esc(t.slot)}</small></span>`;
  }
  function pools() {
    const basis = data.seedBasis;
    return `<section class="cup-section" id="cup-pools"><div class="cup-section-head"><h2>种子池</h2></div>
      <div class="cup-pools">${[1,2,3,4].map(pool=>`<section class="cup-pool"><h3>${pool} 号池</h3><ul>${Object.values(data.teams).filter(t=>t.pool===pool)
        .sort((a,b)=>(b.rating??-Infinity)-(a.rating??-Infinity)).map(t=>`<li>${team(t.id)}<span class="cup-rating">${esc(t.rating??'未收录')}</span></li>`).join('')}</ul></section>`).join('')}</div>
      <p class="cup-seed-source">种子评分来自 <a href="${esc(basis.url)}" target="_blank" rel="noopener noreferrer">${esc(basis.name)} ${esc(basis.version)}</a>（${esc(basis.date)}）。未收录型号排在本赛区评分队伍之后。</p></section>`;
  }
  function mapActions(f,wave) {
    const games = Array.from({length:wave?.revealed ? f.games??0 : 0},(_,index)=>{
      const map=index+1;
      const report=wave?.revealed ? `<button class="cup-mini" data-postgame="${f.id}" data-map="${map}">第 ${map} 局赛后</button>` : '';
      return `<button class="cup-mini" data-watch="${f.id}" data-map="${map}">第 ${map} 局回放</button>${report}`;
    }).join('');
    const watch = wave?.drawn && !wave.revealed && data.mode!=='test' && (wave.complete || data.mode==='realtime')
      ? `<button class="cup-mini" data-focus-table="${f.id}">焦点桌观战</button>` : '';
    return games||watch?`<div class="cup-map-actions">${watch}${games}</div>`:'';
  }
  function card(f, wave, label) {
    const heading = `${f.star ? '<i aria-label="精彩对局">★</i>' : ''}${esc(label)}`;
    const flags = f.status==='technical_hold' ? ' · 技术暂停' : f.status==='running' ? ' · 演算中' : '';
    const teams = f.teams?.map((id,i)=>`<li class="${id && f.winner===id?'cup-win':''}${latestSeat(f,i)?' cup-seat-new':''}">${id?team(id):'<span class="cup-seat-empty">席位待定</span>'}<span class="cup-score">${f.score?.[i]??'·'}</span></li>`).join('');
    return `<article class="cup-match" data-bracket="${f.id}"${teams?'':' data-placeholder'}>
      <h4><span>${heading}</span><span>BO${f.bestOf}${flags}</span></h4><ul>${teams||'<li>席位待定</li><li>席位待定</li>'}</ul>
      ${mapActions(f,wave)}</article>`;
  }
  function latestSeat(f, side) {
    return data.draw?.last?.fixture===f.id && data.draw.last.side===side && !f.winner;
  }
  function swissPair(f,wave) {
    if (!f) return '<li class="cup-pair cup-pair-pending" aria-label="待抽签"><span></span><small>VS</small><span></span></li>';
    const [a,b]=f.teams;
    const side = (id,index) => `<span class="cup-pair-side${id && f.winner===id?' cup-pair-win':''}${latestSeat(f,index)?' cup-seat-new':''}">${id?team(id):'<span class="cup-seat-empty">待抽签</span>'}</span>`;
    const score = f.winner ? f.score.join('–') : 'VS';
    const middle = `<span class="cup-pair-middle">${f.star?'<i aria-label="精彩对局">★</i>':''}<b>${score}</b></span>`;
    const body = `${side(a,0)}${middle}${side(b,1)}`;
    const actions = mapActions(f,wave);
    const status = {running:'演算中',technical_hold:'技术暂停'}[f.status];
    const className = 'cup-pair'+(f.winner?' cup-pair-settled':'');
    return `<li data-swiss-pair="${f.id}">${actions?
      `<details data-pair-actions="${f.id}"><summary class="${className}" aria-label="${esc(data.teams[a].name)} 对 ${esc(data.teams[b].name)}${f.winner?' '+score:''}，查看观赛操作">${body}</summary>${actions}</details>`:
      `<div class="${className}"${status?` title="${status}"`:''}>${body}</div>`}</li>`;
  }
  function swiss(current) {
    const flow = layout.map((column,index)=> {
      const id = 'R'+(index+1), wave = data.waves.find(w=>w.id===id);
      return `<section class="cup-flow-col"><h3>第 ${index+1} 轮</h3><div>${column.map(([record,count,bo,tag,tone])=>{
        const group = wave?.fixtures.filter(f=>f.record===record);
        const rows = Array.from({length:count},(_,i)=>swissPair(group?.[i],wave)).join('');
        return `<article class="cup-node${wave?'':' cup-node-pending'}" data-round="${id}" data-record="${record}" data-tone="${tone}">
          <h4><strong>${record}</strong><small>BO${bo}</small></h4><ul>${rows}</ul>${tag?`<p>${tag}</p>`:''}</article>`;
      }).join('')}</div></section>`;
    }).join('');
    return `<section class="cup-section" id="cup-swiss"><div class="cup-section-head"><div><h2>瑞士轮</h2><p>绿色走胜者，粉色走负者。<span class="cup-scroll-hint">赛程图可以左右滑动。</span></p></div>${current.stage==='swiss'&&!data.draw?controls(current):''}</div>
      <nav class="cup-rounds" aria-label="跳至轮次">${layout.map((_,i)=>`<button data-goto-round="${i+1}" type="button">第 ${i+1} 轮</button>`).join('')}</nav>
      <div class="cup-scroll" data-scroll="swiss" tabindex="0" aria-label="瑞士轮赛程图"><div class="cup-flow"><canvas aria-hidden="true"></canvas>${flow}</div></div></section>`;
  }
  function knockouts(current) {
    let output = '';
    for (const [id,count,label] of [['GF',1,'决赛'],['SF',2,'半决赛'],['QF',4,'八强赛']]) {
      const wave = data.waves.find(w=>w.id===id);
      for (let i=1;i<=count;i++) {
        const f = wave?.fixtures[i-1]||{id:`${id}-${i}`,bestOf:5};
        output += card(f,wave,label+(count>1?' '+i:''));
      }
    }
    return `<section class="cup-section" id="cup-knockouts"><div class="cup-section-head"><div><h2>淘汰赛</h2><p>八强赛 → 半决赛 → 决赛 · 全程 BO5</p></div>${current.stage==='knockout'&&!data.draw?controls(current):''}</div>
      <div class="cup-scroll" data-scroll="bracket" tabindex="0" aria-label="淘汰赛签表"><div class="cup-bracket"><canvas aria-hidden="true"></canvas>${output}</div></div>
      ${data.champion?`<p class="cup-champion">冠军　<b>${esc(data.teams[data.champion].name)}</b></p>`:''}</section>`;
  }
  function controls(current) {
    return `<div class="cup-actions">${data.canStart?`<button class="cup-primary" data-op="start" data-target="${current.id}">开始${current.stage==='swiss'?'第 '+current.id.slice(1)+' 轮':'本轮'}</button>`:''}
      ${data.canReveal?`<button class="cup-primary" data-op="reveal" data-target="${current.id}">揭晓并进入复盘</button>`:''}</div>`;
  }
  async function openReview(wave) {
    try {
      const review = await api(endpoint + '/review/' + encodeURIComponent(wave));
      const panel = $('#cup-review-dialog');
      panel.querySelector('h2').textContent = review.title + ' · 赛后复盘';
      const lines = review.lines.map(line => {
        const row = document.createElement('p');
        const name = document.createElement('strong');
        name.textContent = line.name + ' ';
        row.append(name, line.text);
        return row;
      });
      panel.querySelector('[data-review-lines]').replaceChildren(...lines);
      if (!panel.open) panel.showModal();
    } catch (error) {
      showError(error.message);
    }
  }
  function reviewArchive() {
    const rounds=data.waves.filter(w=>w.complete && w.revealed);
    return rounds.length ? `<section class="cup-section" aria-label="已揭晓轮次复盘"><div class="cup-section-head"><h2>赛后复盘</h2><div class="cup-actions">${rounds.map(w=>`<button class="cup-mini" data-round-review="${w.id}" type="button">${esc(w.stage==='swiss'?'第 '+w.id.slice(1)+' 轮':w.title)}</button>`).join('')}</div></div></section>` : '';
  }
  function drawBoard(wave) {
    const round = Number(wave.id.slice(1));
    const groups = wave.stage==='swiss' ? layout[round-1].map(([key,count])=>
      [key,count,wave.fixtures.filter(f=>f.record===key)]) : wave.id==='QF' ?
      [['3–0 对 3–2',2,wave.fixtures.filter(f=>['QF-1','QF-3'].includes(f.id))],
       ['混合组',2,wave.fixtures.filter(f=>['QF-2','QF-4'].includes(f.id))]] :
      [[null,{SF:2,GF:1}[wave.id],wave.fixtures]];
    return `<div class="cup-draw-board" aria-label="本轮抽签席位">${groups.map(([record,count,fixtures])=>
      `<div class="cup-draw-group">${record?`<h3>${record}</h3>`:''}<ul>${Array.from({length:count},(_,i)=>{
        const f = fixtures[i];
        const slots = f?.teams??[null,null];
        return `<li>${slots.map((id,side)=>`<span${f&&latestSeat(f,side)?' class="cup-seat-new"':''}>${id?team(id):'<small class="cup-seat-empty">待抽签</small>'}</span>`).join('<b class="cup-draw-versus">VS</b>')}</li>`;
      }).join('')}</ul></div>`).join('')}</div>`;
  }
  function drawDesk(current) {
    const draw = data.draw;
    if (!draw) return '';
    const fixed = ['SF','GF'].includes(draw.wave);
    const labels = {'3–0':'3–0 晋级队','3–2':'3–2 抽两队',mixed:'3–1 队伍 + 剩余 3–2 队伍',qualified:'晋级队伍'};
    const label = id => id.startsWith('pool-') ? `${id.slice(-1)} 号池` : labels[id] || id;
    const tip = draw.wave==='R1' ? '1 号池对 4 号池，2 号池对 3 号池。同赛区首轮回避。' :
      draw.wave==='QF' ? '先从 3–2 抽两队对阵 3–0。剩下的一队并入混合袋。' :
      fixed ? '沿签表落位，逐队揭晓晋级席位。' : '同战绩组内配对，回避已交手的队伍。';
    const pockets = draw.pockets.map(p=>`<button type="button" class="cup-pocket" data-op="draw" data-target="${draw.wave}" data-pocket="${esc(p.id)}" data-step="${draw.step}" ${p.id===draw.nextPocket?'aria-current="step"':'disabled'}>
      <i aria-hidden="true"></i><b>${esc(label(p.id))}</b><small>${p.id===draw.nextPocket?'下一签 · ':''}${p.blocked?'等待 3–2 袋抽完':p.remaining?`剩 ${p.remaining} 队`:'抽完了'}</small></button>`).join('');
    const last = draw.last && `<a class="cup-draw-ticket" href="${current.stage==='swiss'?'#cup-swiss':'#cup-knockouts'}" data-draw-seat="${esc(draw.last.fixture)}">
      <span>${esc(label(draw.last.pocket))} · ${esc(draw.last.fixture)} · ${draw.last.side===0?'席位 1':'席位 2'}</span>${team(draw.last.team)}<small>在签表上查看 ↓</small></a>`;
    return `<section class="cup-section cup-draw" id="cup-draw"><div class="cup-section-head"><div><h2>${fixed?'晋级席位':'抽签台'} · ${esc(draw.title)}</h2><p>${draw.complete?'本轮签表已就绪。':`${tip} 点高亮口袋，每桌先左后右，依次落位。`}</p></div>${controls(current)}</div>
      <div class="cup-draw-body"><div class="cup-pockets" aria-label="${fixed?'晋级口袋':'抽签口袋'}">${pockets}</div>
      <div class="cup-draw-latest" aria-live="polite">${last||'<p>点一个口袋抽出第一支队伍。</p>'}</div></div>${drawBoard(current)}</section>`;
  }
  function detail() {
    const current = data.waves.at(-1);
    return `<section class="cup-hero"><div><a class="cup-kicker" href="/cup.html">← ${modeNames[data.mode]}</a><h1>${esc(data.name)}</h1><p>${status(data)} · 16 队</p></div>
      <div class="cup-progress"><strong>${data.settled}</strong> / ${data.total} 场<progress value="${data.settled}" max="${data.total}" aria-label="已完成场次"></progress>${data.mode==='test'?'赛事进度':`已揭晓 ${data.revealed} / 8 轮`}</div></section>
      ${data.needsAttention?'<p class="cup-empty">演算已暂停，比赛记录已保留。</p>':''}${drawDesk(current)}${reviewArchive()}${pools()}${swiss(current)}${knockouts(current)}`;
  }

  function wires(host, edges, vertical) {
    const canvas = host.querySelector('canvas'), scale = window.devicePixelRatio || 1;
    const box = host.getBoundingClientRect();
    canvas.width = Math.round(box.width*scale);
    canvas.height = Math.round(box.height*scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale,scale);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (const [from,to,tone] of edges) {
      const a = host.querySelector(from)?.getBoundingClientRect(), b = host.querySelector(to)?.getBoundingClientRect();
      if (!a || !b) continue;
      const ax=(vertical?(a.left+a.right)/2:a.right)-box.left, ay=(vertical?a.top:(a.top+a.bottom)/2)-box.top;
      const bx=(vertical?(b.left+b.right)/2:b.left)-box.left, by=(vertical?b.bottom:(b.top+b.bottom)/2)-box.top;
      ctx.strokeStyle = {up:'#87aa67',out:'#b47279',knockout:'#839659'}[tone];
      ctx.beginPath(); ctx.moveTo(ax,ay);
      if (vertical) { const mid=(ay+by)/2; ctx.lineTo(ax,mid); ctx.lineTo(bx,mid); }
      else { const mid=(ax+bx)/2; ctx.lineTo(mid,ay); ctx.lineTo(mid,by); }
      ctx.lineTo(bx,by); ctx.stroke();
    }
  }
  const sw = (round,record)=>`[data-round="R${round}"][data-record="${record}"]`;
  const ko = id=>`[data-bracket="${id}"]`;
  function draw() {
    const flow = $('.cup-flow'), bracket = $('.cup-bracket');
    if (flow) wires(flow,swissLines.map(([r,s,rr,ss,tone])=>[sw(r,s),sw(rr,ss),tone]),false);
    if (bracket) wires(bracket,[['QF-1','SF-1'],['QF-2','SF-1'],['QF-3','SF-2'],['QF-4','SF-2'],['SF-1','GF-1'],['SF-2','GF-1']]
      .map(([a,b])=>[ko(a),ko(b),'knockout']),true);
  }
  function paint() {
    const key = JSON.stringify([data,filter]);
    if (signature===key) return;
    const firstPaint = signature===undefined;
    signature = key;
    const offsets = new Map([...root.querySelectorAll('[data-scroll]')].map(el=>[el.dataset.scroll,el.scrollLeft]));
    const expanded = new Set([...root.querySelectorAll('[data-pair-actions][open]')].map(el=>el.dataset.pairActions));
    root.innerHTML = ident ? detail() : home();
    for (const el of root.querySelectorAll('[data-scroll]')) el.scrollLeft = offsets.get(el.dataset.scroll)||0;
    for (const el of root.querySelectorAll('[data-pair-actions]')) el.open = expanded.has(el.dataset.pairActions);
    root.setAttribute('aria-busy','false');
    updateNav();
    if (!ident) paintPicker(data.cups);
    requestAnimationFrame(()=>{
      draw();
      if (firstPaint) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    });
  }
  async function refresh() {
    if (busy || fetching) return;
    fetching = true;
    const requested = revision;
    try {
      const next=await api(endpoint);
      if (!busy && requested===revision) {
        data=next;
        paint();
      }
    }
    catch (error) { showError(error.message); }
    finally { fetching = false; }
  }

  const picker = $('#cup-picker');
  function paintPicker(cups) {
    picker.innerHTML = '<option value="">选择杯赛</option>'+cups.map(c=>
      `<option value="${esc(c.id)}">${esc(c.name)} · ${modeNames[c.mode]}</option>`).join('');
    picker.value = ident || '';
    picker.hidden = !cups.length;
  }
  picker.addEventListener('change',()=>{
    if (picker.value) location.href='/cup.html?id='+encodeURIComponent(picker.value);
  });
  function updateNav() {
    const target = ident ? location.hash || (data?.draw?'#cup-draw':'#cup-pools') : '/cup.html';
    for (const link of document.querySelectorAll('[data-cup-nav]')) {
      link.hidden = (!ident && link.hasAttribute('data-cup-detail')) || (link.hash==='#cup-draw'&&!data?.draw);
      if (link.getAttribute('href')===target) link.setAttribute('aria-current',ident?'location':'page');
      else link.removeAttribute('aria-current');
    }
  }

  const dialog = $('#cup-replay');
  const surface = $('#cup-watch-surface'), fullscreenButton = $('#cup-watch-fullscreen');
  const watchStatus = $('#cup-watch-status');
  const playerHost = $('#cup-player'), reportHost = $('#cup-postgame');
  const statsButton = $('#cup-show-stats'), boardButton = $('#cup-show-player'), nextButton = $('#cup-next-map');
  function openTable(fixture, map, mode) {
    const match = data.waves.flatMap(w=>w.fixtures).find(f=>f.id===fixture);
    $('#cup-watch-title').textContent = match.teams.map(id=>data.teams[id].name).join(' vs ');
    viewing = {fixture,map,mode};
    player?.pause();
    playerHost.hidden = true;
    reportHost.hidden = true;
    reportHost.replaceChildren();
    for (const button of [statsButton,boardButton,nextButton]) button.hidden=true;
    watchStatus.textContent = '';
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    return viewing;
  }
  function mountPlayer() {
    if (player) return player;
    player = MobaBroadcast.mount(playerHost,{bridge:false,embed:true,liveReview:true});
    const finish = ({id}) => {
      const view = viewing;
      if (view?.mode==='replay' && view.gameId===id && !view.finished) {
        view.finished=true;
        loadPostgame(view);
      }
    };
    player.on('finished',event=>{if (player.u>=1) finish(event);});
    player.on('drained',finish);
    return player;
  }
  async function loadPostgame(view, open=false) {
    if (open) {
      player?.pause();
      playerHost.hidden = true;
      reportHost.hidden = false;
      statsButton.hidden = true;
      boardButton.textContent = view.mode==='report' ? '观看回放' : '返回棋盘';
      boardButton.hidden = false;
      if (!view.rendered) reportHost.textContent = '正在读取赛后数据…';
      dialog.scrollTop = 0;
    } else {
      statsButton.hidden = false;
    }
    const path = `${endpoint}/postgame/${view.fixture}/${view.map}${view.proof?'?proof='+encodeURIComponent(view.proof):''}`;
    view.reportRequest ||= api(path);
    try {
      const {technical,series,hasNext,nextCursor} = await view.reportRequest;
      if (view!==viewing) return;
      const names = technical.mvp.winners.map(p=>p.displayName).join('、');
      watchStatus.textContent = `第 ${view.map} 局结束 · ${names?`MVP ${names}`:'本局无 MVP'}`;
      view.nextCursor=nextCursor;
      nextButton.hidden = !hasNext || view.mode==='live'&&!nextCursor;
      if (!reportHost.hidden && !view.rendered) {
        view.rendered=true;
        const seriesScore = series ? `<p class="cup-series-result">系列赛比分　${series.teams.map((id,i)=>`${esc(data.teams[id].name)} ${series.score[i]}`).join('　–　')}</p>` : '';
        reportHost.innerHTML = seriesScore + MobaStats.panel(technical,series?.pom);
        if (view.watchedFrames) {
          const chart=reportHost.querySelector('.tech-economy');
          MobaEconomyCurve.mount(chart,view.watchedFrames,{A:technical.teams.A.name,B:technical.teams.B.name});
          chart.dataset.economyState='ready';
        } else MobaStats.attachEconomy(reportHost,`${endpoint}/replay/${view.fixture}/${view.map}`,technical);
      }
    } catch (error) {
      view.reportRequest=null;
      if (view!==viewing) return;
      watchStatus.textContent = error.message;
      statsButton.hidden=false;
      reportHost.replaceChildren();
    }
  }
  async function replay(fixture,map=1) {
    const view = openTable(fixture,map,'replay');
    watchStatus.textContent = `第 ${map} 局回放`;
    try {
      const result = await api(`${endpoint}/replay/${fixture}/${map}`);
      if (view!==viewing) return;
      view.gameId=result.game.id;
      playerHost.hidden = false;
      mountPlayer().setLive(false);
      player.setSpeed(1);
      await player.loadGame(result.game,{teams:result.teams});
    } catch(error) { if (view===viewing) watchStatus.textContent = error.message; }
  }
  function live(fixture,map=1,cursor='') {
    const view = openTable(fixture,map,'live');
    let game, proof;
    watchStatus.textContent = '等待本桌开始演算…';
    const poll = async () => {
      if (view!==viewing || !dialog.open) return;
      try {
        if (!proof && (!game || player.k===game.frames.length-1 && player.u>=.8 && (player.playing || game.result))) {
          const progress=new URLSearchParams({game:map,cursor});
          const result = await api(`${endpoint}/live/${fixture}?${progress}`);
          if (view!==viewing || !dialog.open) return;
          if (result.waiting) {
            if (result.done) {watchStatus.textContent='本桌演算结束';return;}
          } else {
            cursor=result.cursor;
            proof=result.proof;
            if (result.game.frames.length && game) {
              game.frames.push(...result.game.frames);
              game.result = result.game.result;
              player.appendGame(game);
            } else if (result.game.frames.length) {
              game=result.game;
              playerHost.hidden=false;
              mountPlayer().setLive(true,{progressive:true});
              player.setSpeed(1);
              await player.loadGame(game,{teams:result.teams});
              if (view!==viewing || !dialog.open) return;
              watchStatus.textContent=`第 ${map} 局 · 焦点桌实况`;
            }
          }
        }
        if (proof && game && player.k>=game.frames.length-1 && player.u>=1) {
          player.pause();
          view.proof=proof;
          view.watchedFrames=game.frames;
          loadPostgame(view);
          return;
        }
        setTimeout(poll,game&&player.playing?110:350);
      } catch (error) { if (view===viewing) watchStatus.textContent = error.message; }
    };
    poll();
  }

  statsButton.onclick = ()=>loadPostgame(viewing,true);
  boardButton.onclick = ()=>{
    if (viewing.mode==='report') {replay(viewing.fixture,viewing.map);return;}
    playerHost.hidden=false;
    reportHost.hidden=true;
    boardButton.hidden=true;
    statsButton.hidden=false;
  };
  nextButton.onclick = ()=>{
    const {fixture,map,mode,nextCursor}=viewing;
    if (mode==='live') live(fixture,map+1,nextCursor);
    else replay(fixture,map+1);
  };

  let nativeFullscreen=false;
  function syncFullscreen() {
    const native=document.fullscreenElement===surface;
    if (nativeFullscreen&&!native) dialog.removeAttribute('data-expanded');
    nativeFullscreen=native;
    const expanded=document.fullscreenElement===surface || dialog.hasAttribute('data-expanded');
    fullscreenButton.textContent=expanded?'退出全屏':'全屏观战';
    fullscreenButton.setAttribute('aria-pressed',String(expanded));
    if (player?.game) requestAnimationFrame(()=>player.renderMarks());
  }
  fullscreenButton.onclick=async ()=>{
    if (document.fullscreenElement===surface) await document.exitFullscreen();
    else if (dialog.hasAttribute('data-expanded')) dialog.removeAttribute('data-expanded');
    else {
      dialog.scrollTo(0,0);
      surface.scrollTo(0,0);
      dialog.setAttribute('data-expanded','');
      try { await surface.requestFullscreen(); }
      catch { /* The dialog already fills the browser viewport. */ }
    }
    syncFullscreen();
  };
  document.addEventListener('fullscreenchange',syncFullscreen);

  document.addEventListener('click',async event=> {
    const ticket = event.target.closest('[data-draw-seat]');
    if (ticket) {
      const id = ticket.dataset.drawSeat;
      const seat = $(`[data-swiss-pair="${id}"], [data-bracket="${id}"]`);
      if (seat) {event.preventDefault();seat.scrollIntoView({block:'center',inline:'center'});}
      return;
    }
    const button = event.target.closest('button');
    if (!button) return;
    const key = button.dataset;
    if (key.close) {$('#'+key.close).close();return;}
    if (key.create!==undefined) {$('#cup-create').showModal();return;}
    if (key.filter) {filter=key.filter;paint();return;}
    if (key.gotoRound) {
      const scroll = $('[data-scroll="swiss"]');
      const box = $(`.cup-node[data-round="R${key.gotoRound}"]`);
      scroll.scrollLeft += box.getBoundingClientRect().left - scroll.getBoundingClientRect().left - 12;
      return;
    }
    if (key.watch) {replay(key.watch,Number(key.map));return;}
    if (key.postgame) {loadPostgame(openTable(key.postgame,Number(key.map),'report'),true);return;}
    if (key.roundReview) {openReview(key.roundReview);return;}
    if ((!key.op&&!key.focusTable) || busy) return;
    busy = true; revision++; button.disabled = true; showError('');
    try {
      data = await api(endpoint+'/action', {action:key.op||'focus',target:key.target||key.focusTable,pocket:key.pocket,step:key.step===undefined?undefined:Number(key.step)});
      paint();
      if (key.op==='reveal') openReview(key.target);
      if (key.pocket) {
        const next = [...root.querySelectorAll('.cup-pocket:not(:disabled)')];
        (next.find(b=>b.dataset.pocket===key.pocket)||next[0]||$('#cup-draw .cup-primary'))?.focus({preventScroll:true});
      }
      if (key.focusTable) {
        const wave = data.waves.at(-1);
        if (data.mode==='realtime' && data.canStart) {
          data = await api(endpoint+'/action',{action:'start',target:wave.id});
          paint();
        }
        live(key.focusTable);
      }
    } catch(error) {showError(error.message);}
    finally {busy=false;button.disabled=false;}
  });
  $('#cup-form').addEventListener('submit',async event=> {
    event.preventDefault();
    const form = event.target, submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    showError('','#cup-form-error');
    try {
      const made = await api('/api/cups',Object.fromEntries(new FormData(form)));
      location.href = '?id='+encodeURIComponent(made.id);
    } catch(error) {showError(error.message,'#cup-form-error');submit.disabled=false;}
  });
  dialog.addEventListener('close',()=>{
    viewing=null;player?.pause();
    if (document.fullscreenElement===surface) document.exitFullscreen().catch(()=>{});
    dialog.removeAttribute('data-expanded');syncFullscreen();
  });
  root.addEventListener('toggle',draw,true);
  window.addEventListener('resize',draw);
  window.addEventListener('hashchange',updateNav);
  updateNav();
  if (ident) api('/api/cups').then(({cups})=>paintPicker(cups)).catch(()=>{});
  refresh();
  setInterval(refresh,2000);
})();
