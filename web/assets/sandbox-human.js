/* MobaSandboxHuman · in-scene tactical HUD for human-controlled sandbox sides.
 *   const hud = MobaSandboxHuman.mount({player, api, box, refresh});  hud.update(sandboxPublicState, {replay});
 * Reads only the public sandbox request/observation. Orders keep the original API shape {side,turn,orders};
 * the backend and original engine remain the authority on legality.
 */
(function (root) {
  'use strict';
  const MB = root.MobaBroadcast, C = MB.C, GEO = MB.geom;
  const { key, dist, CELLS, PATHS, FOUNTAIN, ROLE_CN, ROLE_SHORT, ACTION_CN, LANE_CN } = C;
  const SIDE_CN = { A: '蓝方', B: '红方' };
  const ORDER = ['move', 'attack', 'spell', 'reap', 'capture', 'push', 'heal', 'control', 'recall', 'teleport', 'engage', 'coach_engage', 'wait'];
  const actionName = a => a === 'coach_engage' ? '教练开团' : ACTION_CN[a] || a;
  const ROLE_SEQ = ['top', 'jungle', 'mid', 'adc', 'support'];
  const ACOL = { move: '#e8f0ff', attack: '#ff4d4d', spell:'#e18aff',reap:'#ffb84d', capture: '#6dff7a', push: '#ffe066', heal: '#59f08a', control: '#c77dff', recall: '#7ff3ff', teleport: '#b48cff', engage: '#ffb627', coach_engage:'#fcdd83', wait: '#8890a6' };
  const HINT = { move: '点地图上发光的相邻格', attack: '点射程内的敌方英雄', spell:'选择两个相邻格组成的法术区域',reap:'点射程内的敌方英雄进行收割', capture: '点脚下的野怪/远古', push: '点要推进的兵线', heal: '点射程内的友方英雄', control: '点同格敌方英雄', teleport: '点己方存活防御塔', engage: '点有敌方英雄的开团中心' };
  const LANE_KEYS = new Set(); for (const l of C.LANES) for (const p of PATHS[l]) LANE_KEYS.add(key(p)); LANE_KEYS.add(key(FOUNTAIN.A)); LANE_KEYS.add(key(FOUNTAIN.B));
  const isLane = p => LANE_KEYS.has(key(p));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pt = p => '(' + p[0] + ',' + p[1] + ')';
  const spellSize = obs => obs.ruleset === 's16' ? 3 : 2;
  const spellFits = (option, selected) => option.cells && selected.every(k => option.cells.some(p => key(p) === k));
  const iconFor = action => action === 'coach_engage' ? 'engage' : action;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const hexPts = (p, r) => { const [x, y] = GEO.cellXY(p), s = r || GEO.S - 3; return [0, 1, 2, 3, 4, 5].map(i => { const a = Math.PI / 3 * i; return (x + s * Math.cos(a)).toFixed(1) + ',' + (y + s * Math.sin(a)).toFixed(1); }).join(' '); };

  function heroName(game, id) { try { return game ? game.name(id) : id; } catch (e) { return id; } }
  function shortHero(id) { return SIDE_CN[id[0]] + ROLE_CN[id.slice(2)]; }
  function entityName(game, obs, id) {
    if (/^[AB]_(top|mid|adc|support|jungle)$/.test(id)) return shortHero(id);
    if (id === 'ancient_upper') return '远古·上'; if (id === 'ancient_lower') return '远古·下';
    let m = id.match(/^([AB])_(top|mid|bottom)_(inner|outer)$/); if (m) return SIDE_CN[m[1]] + LANE_CN[m[2]] + (m[3] === 'outer' ? '外塔' : '内塔');
    m = id.match(/^([AB])_camp_(\d+)$/); if (m) return SIDE_CN[m[1]] + '野区营地' + m[2];
    return id;
  }
  function orderText(game, obs, o) {
    if (!o) return '待命';
    const a = actionName(o.action);
    if (o.target) return a + '·' + entityName(game, obs, o.target);
    if (o.lane) return a + '·' + (LANE_CN[o.lane] || o.lane);
    if (o.to) return a + pt(o.to);
    if (o.cells) return a+'·'+o.cells.map(pt).join(' + ');
    if (o.action === 'spell') return a + '·全体敌人';
    return a;
  }

  // Legal target options for one hero/action from the public observation (mirrors engine.cjs checks).
  function options(obs, h, a) {
    const final = obs.phase === 'final_battle';
    const enemies = obs.heroes.filter(t => t.alive && t.team !== h.team), allies = obs.heroes.filter(t => t.alive && t.team === h.team);
    const hero = (t, action) => ({ id: t.id, cell: t.p, order: { action, target: t.id }, label: shortHero(t.id), team: t.team, role: t.role });
    if (final) {
      const d = obs.finalDecision || {};
      if (a === 'attack' || a==='reap') return enemies.map(t => hero(t,a));
      if (a==='spell') return [{all:true,order:{action:'spell'},label:'全体存活敌人（法术）'}];
      if (a === 'heal') return allies.map(t => hero(t, 'heal'));
      if (a === 'control') return enemies.filter(t => !(obs.battle && obs.battle.skip && obs.battle.skip[t.id])).map(t => hero(t, 'control'));
      void d; return null;
    }
    const same = t => !!h.engagementId && h.engagementId === t.engagementId;
    const eng = h.engagementId ? (obs.engagements || []).find(e => e.id === h.engagementId) : null;
    const inEng = p => !!eng && (eng.cells || []).some(c => key(c) === key(p));
    switch (a) {
      case 'move': return CELLS.filter(p => dist(p, h.p) === 1).map(p => ({ cell: p, order: { action: 'move', to: [p[0], p[1]] }, label: '移动到' + pt(p) }));
      case 'attack': {
        if (h.role === 'support') return [];
        return enemies.filter(t => same(t) || (dist(t.p, h.p) <= 1 && (isLane(h.p) || !isLane(t.p)))).map(t => hero(t, 'attack'));
      }
      case 'spell': {
        const area = (h.spellTargets || []).map(cells => ({cells, order:{action:'spell',cells:cells.map(p=>p.slice())},
          label:cells.map(pt).join(' + '),has:enemies.some(t=>cells.some(p=>key(p)===key(t.p)))}));
        if (obs.ruleset === 's16' && h.spellEngagementTargets?.length) {
          area.unshift({all:true,order:{action:'spell'},label:'命中同场团战的所有敌人'});
        }
        return area;
      }
      case 'reap': return (h.reapTargets||[]).map(id=>enemies.find(t=>t.id===id)).filter(Boolean).map(t=>hero(t,'reap'));
      case 'capture': return obs.camps.filter(c => c.alive !== false && c.hp > 0 && key(c.p) === key(h.p) && !(h.role === 'support' && c.kind === 'normal')).map(c => ({ id: c.id, cell: c.p, order: { action: 'capture', target: c.id }, label: entityName(null, obs, c.id) + (c.kind === 'ancient' ? ' 耐久' + c.hp : '') }));
      case 'push': return (h.pushLanes || []).map(l => { const f = (obs.fronts || []).find(f => f.team === h.team && f.lane === l); return { lane: l, cell: f ? f.frontP : h.p, order: { action: 'push', lane: l }, label: '推进' + LANE_CN[l] }; });
      case 'heal': return allies.filter(t => same(t) || dist(t.p, h.p) <= 1).map(t => hero(t, 'heal'));
      case 'control': return enemies.filter(t => same(t) || dist(t.p, h.p) <= (obs.ruleset === 's16' ? 1 : 0)).map(t => hero(t, 'control'));
      case 'teleport': return (h.teleportTargets || []).map(id => { const b = obs.buildings.find(x => x.id === id); return b && { id, cell: b.p, order: { action: 'teleport', to: [b.p[0], b.p[1]] }, label: '传送到' + entityName(null, obs, id) }; }).filter(Boolean);
      case 'coach_engage':
      case 'engage': { const R = obs.config?.engageTargetRange ?? 1; return CELLS.filter(p => dist(p, h.p) <= R && enemies.some(t => key(t.p) === key(p))).map(p => ({ cell: p, order: { action: a, to: [p[0], p[1]] }, label: '开团中心' + pt(p), area: true, has: true })); }
      default: return null;
    }
  }
  function actionsFor(obs, h) {
    if (obs.phase === 'final_battle') return (obs.finalDecision && obs.finalDecision.actor === h.id ? obs.finalDecision.legalActions || [] : []).slice();
    return ORDER.filter(a => (h.allowedActions || []).includes(a) || (a === 'coach_engage' && h.coachEngageAvailable));
  }
  function actors(obs, side) {
    if (!obs) return [];
    if (obs.phase === 'final_battle') { const d = obs.finalDecision; return d && d.team === side ? obs.heroes.filter(h => h.id === d.actor) : []; }
    if (obs.phase !== 'map') return [];
    return obs.heroes.filter(h => h.team === side && h.alive && (h.allowedActions || []).length).sort((a, b) => ROLE_SEQ.indexOf(a.role) - ROLE_SEQ.indexOf(b.role));
  }

  class HUD {
    constructor(o) {
      this.player = o.player; this.api = o.api; this.box = o.box; this.refresh = o.refresh || (() => {});
      this.drafts = {}; this.coach = {}; this.sent = {}; this.turn = null; this.side = null; this.sel = {}; this.pending = null; this.pickCell = null;
      this.spellPick = [];
      this.msg = null; this.submitting = false; this.data = null; this.replay = false; this.lastKey = ''; this.lastOv = '';
      const center = this.player.q('.mb-center'), wrap = this.player.q('.mb-stagewrap');
      this.dock = document.createElement('section'); this.dock.className = 'sbh-dock'; this.dock.setAttribute('aria-label', '人类指挥台');
      wrap.after(this.dock); void center;
      this.svg = document.createElementNS(SVGNS, 'svg'); this.svg.setAttribute('class', 'sbh-overlay'); this.svg.setAttribute('viewBox', '0 0 ' + GEO.W + ' ' + GEO.H); this.svg.setAttribute('aria-hidden', 'true');
      this.host = this.player.q('.mb-stagehost'); this.host.appendChild(this.svg);
      this.dock.addEventListener('click', e => this.onClick(e));
      this.svg.addEventListener('click', e => { const t = e.target.closest('[data-pick]'); if (!t) return; e.stopPropagation(); this.pickAt(t.getAttribute('data-pick')); });
      const sync = () => { const p = this.player.renderer.pix, s = this.svg.style; for (const k of ['left', 'top', 'width', 'height']) if (s[k] !== p.style[k]) s[k] = p.style[k]; this._raf = requestAnimationFrame(sync); };
      sync();
    }
    // ---------- state ----------
    mode() {
      const d = this.data || {}, req = d.request || {};
      if (this.replay) return 'replay';
      if (!['queued', 'running'].includes(d.status) || req.done) return 'ended';
      if (!req.waiting || !(req.teams || []).length) return d.control && d.control.paused ? 'paused' : 'running';
      return 'command';
    }
    sides() { const req = (this.data || {}).request || {}; return this.mode() === 'command' ? (req.teams || []).filter(t => req.observations && req.observations[t]) : []; }
    submitted(side) { const d = this.data || {}; return (d.submittedSides || []).includes(side) || !!this.sent[this.turn + '|' + side]; }
    obs() { const req = (this.data || {}).request || {}; return this.side && req.observations ? req.observations[this.side] : null; }
    draft(side) { const k = this.turn + '|' + (side || this.side); return this.drafts[k] || (this.drafts[k] = {}); }
    update(d, opt) {
      this.data = d; this.replay = !!(opt && opt.replay);
      const req = d.request || {};
      const turn = req.waiting ? req.turn : null;
      if (turn !== this.turn) { if (turn !== null || this.mode() !== 'command') { this.drafts = {}; this.coach = {}; this.sent = {}; this.resetPick(); this.sel = {}; if (this.msg && this.msg.tone !== 'bad') this.msg = null; } this.turn = turn; }
      const sides = this.sides();
      if (!sides.includes(this.side)) this.side = sides.find(s => !this.submitted(s)) || sides[0] || null;
      const units = actors(this.obs(), this.side);
      if (!units.some(h => h.id === this.sel[this.side])) { this.sel[this.side] = units[0] ? units[0].id : null; this.resetPick(); }
      this.render();
    }
    hero() { const o = this.obs(); return o ? o.heroes.find(h => h.id === this.sel[this.side]) : null; }
    canEdit() { return this.mode() === 'command' && this.side && !this.submitted(this.side) && !this.submitting; }
    resetPick() { this.pending = null; this.pickCell = null; this.spellPick = []; }
    hint() {
      if (this.pending === 'spell' && this.obs()?.phase === 'map') {
        return '依次点击互相连通的格子（' + this.spellPick.length + '/' + spellSize(this.obs()) + '）';
      }
      if (this.pending === 'coach_engage') return '选择开团中心；教练指令覆盖该英雄本回合行动';
      if (this.obs()?.ruleset === 's16' && this.pending === 'control') return '点同格或相邻格的敌方英雄';
      if (this.obs()?.ruleset === 's16' && this.pending === 'teleport') return '点己方基地或防御塔原位置';
      return HINT[this.pending] || '';
    }
    // ---------- interaction ----------
    onClick(e) {
      const b = e.target.closest('button[data-k]'); if (!b || b.disabled) return;
      const k = b.dataset.k, v = b.dataset.v;
      if (k === 'side') { if (this.side !== v) { this.side = v; this.resetPick(); this.msg = null; const u = actors(this.obs(), v); if (!u.some(h => h.id === this.sel[v])) this.sel[v] = u[0] ? u[0].id : null; } }
      else if (!this.canEdit()) return;
      else if (k === 'hero') { this.sel[this.side] = v; this.resetPick(); }
      else if (k === 'act') this.chooseAction(v);
      else if (k === 'tgt') this.applyOption(+v);
      else if (k === 'undo') { delete this.draft()[this.sel[this.side]]; this.resetPick(); }
      else if (k === 'undo-coach') { delete this.coach[this.side]; this.resetPick(); }
      else if (k === 'reset') { const kk = this.turn + '|' + this.side; this.drafts[kk] = {}; delete this.coach[this.side]; this.resetPick(); this.msg = { tone: 'warn', text: SIDE_CN[this.side] + '草稿已清空，未安排的英雄按待命' }; }
      else if (k === 'alt') this.altCoord();
      else if (k === 'submit') { this.submit(); return; }
      this.render();
    }
    chooseAction(a) {
      const h = this.hero(); if (!h) return;
      const list = options(this.obs(), h, a);
      this.resetPick(); this.msg = null;
      if (list === null) { this.draft()[h.id] = { action: a }; this.advance(); return; }
      if (!list.length) return;
      this.pending = a; this.pickCell = null;
      if (list.length === 1 && (list[0].all || ['capture', 'push'].includes(a))) this.applyOption(0);
    }
    curOptions() { const h = this.hero(); return h && this.pending ? options(this.obs(), h, this.pending) || [] : []; }
    applyOption(i) {
      const h = this.hero(), o = this.curOptions()[i]; if (!h || !o) return;
      if (o.order.action === 'coach_engage') this.coach[this.side] = {unit:h.id,...o.order};
      else { this.draft()[h.id] = { ...o.order }; this.advance(); }
      this.msg = null; this.resetPick();
    }
    advance() { // jump to the next hero without an order, keeping the flow quick on touch screens
      const units = actors(this.obs(), this.side), dr = this.draft(), cur = units.findIndex(h => h.id === this.sel[this.side]);
      for (let n = 1; n <= units.length; n++) { const h = units[(cur + n) % units.length]; if (!dr[h.id]) { this.sel[this.side] = h.id; return; } }
    }
    pickAt(cellKey) {
      if (!this.canEdit() || !this.pending) return;
      if (this.pending === 'spell' && this.obs().phase === 'map') {
        const selected = this.spellPick.includes(cellKey) ? this.spellPick.filter(k => k !== cellKey) : [...this.spellPick, cellKey];
        const i = this.curOptions().findIndex(o => spellFits(o, selected));
        if (i < 0) return;
        this.spellPick = selected;
        if (selected.length === spellSize(this.obs())) this.applyOption(i);
        this.render();
        return;
      }
      const list = this.curOptions(), idx = list.map((o, i) => [o, i]).filter(([o]) => o.id || o.lane ? key(o.cell) === cellKey : (o.cells?o.cells.some(c=>key(c)===cellKey):o.cell && key(o.cell) === cellKey) && !o.all);
      const fin = this.obs().phase === 'final_battle';
      const hits = fin ? list.map((o, i) => [o, i]).filter(([o]) => o.id === cellKey) : idx;
      if (hits.length === 1) this.applyOption(hits[0][1]);
      else if (hits.length > 1) { this.pickCell = cellKey; this.msg = { tone: 'warn', text: '该格有 ' + hits.length + ' 个可选目标，请在下方选择' }; }
      this.render();
    }
    altCoord() {
      const q = +this.dock.querySelector('.sbh-q').value, r = +this.dock.querySelector('.sbh-r').value;
      const i = this.curOptions().findIndex(o => o.order.to && o.order.to[0] === q && o.order.to[1] === r);
      if (i < 0) { this.msg = { tone: 'bad', text: '坐标 ' + pt([q, r]) + ' 不是当前动作的合法目标' }; return; }
      this.applyOption(i);
    }
    orders(side) {
      const dr = this.draft(side);
      return actors((this.data.request.observations || {})[side], side).map(h => ({ unit: h.id, ...(dr[h.id] || { action: 'wait' }) }));
    }
    async submit() {
      if (!this.canEdit()) return;
      const side = this.side, turn = this.turn, orders = this.orders(side);
      this.submitting = true; this.msg = { tone: 'lock', text: '正在提交' + SIDE_CN[side] + '第 ' + turn + ' 回合指令…' }; this.render();
      try {
        await this.api('/api/sandbox/' + encodeURIComponent(this.box) + '/input', { side, turn, orders, coach:this.coach[side] });
        this.sent[turn + '|' + side] = orders; delete this.drafts[turn + '|' + side];
        const other = this.sides().find(s => s !== side && !this.submitted(s));
        this.msg = { tone: 'ok', text: SIDE_CN[side] + '第 ' + turn + ' 回合已提交并锁定' + (other ? ' · 请' + SIDE_CN[other] + '下令' : '') };
        if (other) { this.side = other; this.resetPick(); }
      } catch (err) { this.msg = { tone: 'bad', text: '提交失败：' + (err && err.message || err) + '（草稿已保留）' }; }
      finally { this.submitting = false; this.lastKey = ''; this.render(); }
      try { await this.refresh(); } catch (e) { /* poll reports its own errors */ }
    }
    // ---------- rendering ----------
    statusLine() {
      const m = this.mode(), d = this.data || {}, req = d.request || {};
      if (m === 'replay') return { tone: 'lock', text: '回放模式 · 指挥台已锁定，不会发送真实指令；点“返回实时”继续操作' };
      if (m === 'ended') return d.interrupted ? { tone: 'warn', text: d.message || '对局连接已断开 · 已保留画面，可回放或新建沙盒' } : { tone: 'lock', text: '对局已结束 · 指挥台已锁定，可进入回放查看' };
      if (m === 'paused') return { tone: 'warn', text: '演算已暂停 · 可“继续演算”或“单步演算”' };
      if (m === 'running') return { tone: 'lock', text: Object.values(d.controllers || {}).includes('human') ? '程序方行动中 / 原引擎结算中，下个人类回合到达后自动开放指挥台' : '本沙盒没有人类控制方' };
      if (this.msg) return this.msg;
      const obs = this.obs(), side = this.side;
      if (this.submitted(side)) { const other = this.sides().find(s => !this.submitted(s)); return { tone: 'ok', text: SIDE_CN[side] + '已提交并锁定 · ' + (other ? '等待' + SIDE_CN[other] + '提交' : '等待原引擎结算') }; }
      if (obs && obs.phase === 'final_battle') { const fd = obs.finalDecision || {}; return { tone: 'warn', text: '最终决战 · 轮到 ' + shortHero(fd.actor) + ' 出手（第' + fd.round + '轮）' + (fd.forcedWait ? ' · 本次只能待命' : '') }; }
      if (!actors(obs, side).length) return { tone: 'warn', text: SIDE_CN[side] + '本回合没有可行动英雄（阵亡/受控），可直接提交待命' };
      const p = this.pending ? this.hint() : '选英雄 → 选行动 → 点地图目标';
      return { tone: 'info', text: (d.control && d.control.paused ? '演算已暂停：提交后仍会结算本回合 · ' : '') + p };
    }
    render() {
      const m = this.mode(), obs = this.obs(), side = this.side, h = this.hero(), units = actors(obs, side), dr = side ? this.draft(side) : {};
      const opts = this.curOptions(), st = this.statusLine();
      const keyNow = JSON.stringify([m, this.turn, side, (this.data || {}).submittedSides, (this.data || {}).humanIds, this.sent, dr, this.coach, this.sel, this.pending, this.pickCell, this.spellPick, st, this.submitting, obs && obs.turn, obs && obs.finalDecision && obs.finalDecision.actor]);
      this.renderOverlay(m, obs, h, opts, dr);
      if (keyNow === this.lastKey) return; this.lastKey = keyNow;
      const focus = document.activeElement && this.dock.contains(document.activeElement) ? document.activeElement.dataset.k + ':' + document.activeElement.dataset.v : null;
      const game = this.player.game, edit = this.canEdit(), sides = this.sides(), turn = this.turn;
      this.dock.dataset.side = side || 'A'; this.dock.classList.toggle('sbh-lock', !edit);
      const tabs = sides.map(s => { const done = this.submitted(s), n = Object.keys(this.draft(s)).length, total = actors(this.data.request.observations[s], s).length; return `<button class="sbh-side${s === side ? ' on' : ''}${done ? ' done' : ''}" data-k="side" data-v="${s}" data-team="${s}" aria-pressed="${s === side}" aria-label="切换到${SIDE_CN[s]}（${s}）${done ? '，已提交' : '，已安排' + n + '/' + total}">${SIDE_CN[s]} ${s}<em>${done ? '已提交✓' : n + '/' + total}</em></button>`; }).join('');
      let html = `<div class="sbh-top"><span class="sbh-title">指挥台<small>${m === 'command' ? '第 ' + turn + ' 回合' + (obs && obs.phase === 'final_battle' ? ' · 最终决战' : '') : ''}</small></span>${sides.length ? `<div class="sbh-sides" role="group" aria-label="控制方">${tabs}</div>` : ''}<div class="sbh-msg" data-tone="${st.tone}" role="status" aria-live="polite">${esc(st.text)}</div></div>`;
      if (m === 'command' && obs) {
        const sent = this.sent[turn + '|' + side];
        const shown = obs.phase === 'final_battle' ? units : obs.heroes.filter(x => x.team === side).sort((a, b) => ROLE_SEQ.indexOf(a.role) - ROLE_SEQ.indexOf(b.role));
        html += `<div class="sbh-heroes${shown.length === 1 ? ' solo' : ''}" role="group" aria-label="${SIDE_CN[side]}英雄">` + shown.map(x => {
          const can = units.some(u => u.id === x.id), o = sent ? (sent.find(s => s.unit === x.id) || null) : dr[x.id], ratio = x.maxHP ? Math.max(0, x.hp / x.maxHP) : 0;
          const stun = x.alive && obs.phase === 'map' && !can ? '受控' : '';
          const onlyWait = can && obs.phase === 'map' && actionsFor(obs, x).join() === 'wait';
          const ordTxt = !x.alive ? '阵亡' + (x.respawnAt ? '·R' + x.respawnAt + '复活' : '') : stun || (o ? orderText(game, obs, o) : onlyWait ? '受控·仅可待命' : '待命（未安排）');
          const healing = x.role === 'support' && !obs.finalDecision?.supportSolo;
          const power = (healing ? '治疗 ' : '攻击 ') + MB.heroPower(x, obs.config, healing);
          const label = `${shortHero(x.id)} ${heroName(game, x.id)} · 生命 ${Math.round(x.hp)}/${x.maxHP} · ${power}${obs.phase === 'map' ? ' · 位置' + pt(x.p) : ''} · ${ordTxt}`;
          return `<button class="sbh-hero${this.sel[side] === x.id && can ? ' on' : ''}${x.alive ? '' : ' dead'}" data-k="hero" data-v="${x.id}" ${can && edit ? '' : 'disabled'} aria-pressed="${this.sel[side] === x.id}" aria-label="${esc(label)}" title="${esc(label)}"><canvas data-por="${x.role}|${x.team}" width="12" height="12"></canvas><span class="sbh-hn"><b>${ROLE_SHORT[x.role]}</b><span class="sbh-player-id">${esc(heroName(game, x.id))}</span></span><span class="sbh-hp" aria-hidden="true"><i class="${ratio > .6 ? '' : ratio > .3 ? 'md' : 'lo'}" style="width:${(ratio * 100).toFixed(1)}%"></i></span><span class="sbh-power">${esc(power)}</span><span class="sbh-ho${o ? ' set' : ''}" style="--ac:${o ? ACOL[o.action] : '#444'}">${o ? `<canvas data-ico="${o.action}" width="7" height="7"></canvas>` : ''}<span>${esc(ordTxt)}</span></span>${obs.phase === 'map' ? `<span class="sbh-pos" aria-hidden="true">${pt(x.p)}</span>` : ''}</button>`;
        }).join('') + '</div>';
        if (h && !this.submitted(side)) {
          const acts = actionsFor(obs, h);
          html += `<div class="sbh-acts" role="group" aria-label="${esc(shortHero(h.id))}可用行动">` + acts.map(a => {
            const list = options(obs, h, a), none = list && !list.length, cur = dr[h.id] && dr[h.id].action === a;
            const note = none ? '无目标' : list ? (list.length === 1 && (list[0].all || ['capture', 'push'].includes(a)) ? (list[0].all ? '全体敌人' : list[0].label.slice(0, 6)) : list.length + '个目标') : a === 'recall' && obs.phase === 'map' && !h.recallAllowed ? '可能失败' : '即刻生效';
            return `<button class="sbh-act${this.pending === a || (cur && !this.pending) ? ' on' : ''}" data-k="act" data-v="${a}" style="--ac:${ACOL[a]}" ${none || !edit ? 'disabled' : ''} aria-pressed="${this.pending === a || !!cur}" aria-label="${esc(actionName(a) + '：' + (none ? '当前没有合法目标' : note))}"><canvas data-ico="${iconFor(a)}" width="7" height="7"></canvas>${actionName(a)}<small>${esc(note)}</small></button>`;
          }).join('') + '</div>';
          let tg = '';
          if (this.pending) {
            const list = this.pending === 'spell' && this.spellPick.length ? opts.map((o, i) => [o, i]).filter(([o]) => spellFits(o, this.spellPick)) : this.pickCell ? opts.map((o, i) => [o, i]).filter(([o]) => (o.cells?o.cells.some(c=>key(c)===this.pickCell):(o.cell && key(o.cell) === this.pickCell)) || o.id === this.pickCell) : opts.map((o, i) => [o, i]);
            tg = `<span class="sbh-tlabel">${actionName(this.pending)}目标</span><span class="sbh-hint">${esc(this.hint())} · 也可直接选组合</span>` + list.slice(0, 12).map(([o, i]) => `<button class="sbh-tgt${o.team ? (o.team === side ? ' ally' : ' enemy') : ''}" data-k="tgt" data-v="${i}" aria-label="${esc(actionName(this.pending) + '：' + o.label)}">${o.role ? `<canvas data-por="${o.role}|${o.team}" width="12" height="12"></canvas>` : ''}${esc(o.label)}</button>`).join('');
          } else if (dr[h.id]) tg = `<span class="sbh-tlabel">已安排</span><span class="sbh-hint">${esc(shortHero(h.id) + '：' + orderText(game, obs, dr[h.id]))}</span><button class="sbh-clear" data-k="undo" aria-label="撤销${esc(shortHero(h.id))}的指令">撤销此英雄</button>`;
          else tg = `<span class="sbh-hint">${esc(shortHero(h.id))} 尚未安排 · 不安排则按待命</span>`;
          html += `<div class="sbh-targets">${tg}</div>`;
          if (this.pending && opts.some(o => o.order.to)) html += `<details class="sbh-alt"><summary>备用：输入坐标</summary><label>q <input class="sbh-q" type="number" min="-4" max="4" value="${h.p[0]}" aria-label="目标 q 坐标"></label><label>r <input class="sbh-r" type="number" min="-4" max="4" value="${h.p[1]}" aria-label="目标 r 坐标"></label><button data-k="alt" data-v="">设为目标</button></details>`;
        }
        const coach = this.coach[side];
        if (coach) html += `<div class="sbh-targets">教练 · ${esc(shortHero(coach.unit) + ' ' + orderText(game, obs, coach))}${edit ? '<button class="sbh-clear" data-k="undo-coach">撤销教练指令</button>' : ''}</div>`;
        const n = units.filter(u => dr[u.id]).length;
        html += `<div class="sbh-foot"><span class="sbh-sum">${this.submitted(side) ? SIDE_CN[side] + '本回合指令已锁定' : `已安排 <b>${n}</b>/${units.length} 名 · 其余按待命`}</span>${this.submitted(side) ? '' : `<button class="sbh-reset" data-k="reset" ${edit && (n || coach) ? '' : 'disabled'} aria-label="清空${SIDE_CN[side]}全部草稿">清空草稿</button>`}<button class="sbh-submit" data-k="submit" ${edit ? '' : 'disabled'} aria-label="提交${SIDE_CN[side]}第${turn}回合指令">${this.submitting ? '提交中…' : this.submitted(side) ? '已提交 ✓' : '提交' + SIDE_CN[side] + '本回合 ▶'}</button></div>`;
      }
      this.dock.innerHTML = html;
      this.dock.querySelectorAll('canvas[data-por]').forEach(c => { const [r, t] = c.dataset.por.split('|'); c.getContext('2d').drawImage(MB.sprite(r, t), 0, 0); });
      this.dock.querySelectorAll('canvas[data-ico]').forEach(c => c.getContext('2d').drawImage(MB.sprite(c.dataset.ico, null), 0, 0));
      if (focus) { const [k, v] = focus.split(':'); const el = this.dock.querySelector(`[data-k="${k}"]${v !== 'undefined' ? `[data-v="${v}"]` : ''}`); if (el && !el.disabled) el.focus(); }
    }
    renderOverlay(m, obs, h, opts, dr) {
      const key2 = JSON.stringify([m, obs && obs.turn, this.side, h && h.id, this.pending, this.pickCell, this.spellPick, dr, this.submitted(this.side), obs && obs.phase]);
      if (key2 === this.lastOv) return; this.lastOv = key2;
      const svg = this.svg; svg.innerHTML = '';
      if (m !== 'command' || !obs || !h) return;
      const final = obs.phase === 'final_battle';
      const posOf = x => final ? GEO.arenaXY(x.id || x) : GEO.cellXY(x.p || x);
      const add = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
      // planned orders preview (whole side), current hero emphasised
      if (!final) for (const u of actors(obs, this.side)) {
        const o = dr[u.id]; if (!o) continue; let to = null;
        if (o.to) to = o.to; else if (o.target) { const t = [...obs.heroes, ...obs.camps, ...obs.buildings].find(x => x.id === o.target); to = t && t.p; } else if (o.lane) { const f = (obs.fronts || []).find(f => f.team === u.team && f.lane === o.lane); to = f && f.frontP; }
        if(o.cells) for(const cell of o.cells)add('polygon',{points:hexPts(cell),class:'cell has',style:'--ac:'+ACOL.spell});
        const a = GEO.cellXY(u.p);
        if (to && key(to) !== key(u.p)) { const b = GEO.cellXY(to); add('line', { x1: a[0], y1: a[1] - 4, x2: b[0], y2: b[1] - 4, class: 'plan' + (u.id === h.id ? ' cur' : ''), style: '--ac:' + ACOL[o.action] }); add('rect', { x: b[0] - 3, y: b[1] - 7, width: 6, height: 6, fill: ACOL[o.action], stroke: '#05060c' }); }
        const tag = add('text', { x: a[0] + 8, y: a[1] - 14 - ROLE_SEQ.indexOf(u.role) * 0, class: 'tag' }); tag.textContent = ROLE_SHORT[u.role] + '·' + (ACTION_CN[o.action] || '');
      }
      // selected hero
      const hp = posOf(h); add('rect', { x: hp[0] - (final ? 16 : 11), y: hp[1] - (final ? 16 : 16), width: final ? 32 : 22, height: final ? 34 : 24, class: 'selhero' });
      if (!this.pending) return;
      const ac = ACOL[this.pending];
      if (final) {
        for (const o of opts) { if (o.all) continue; const p = GEO.arenaXY(o.id), g = add('g', { class: 'sbh-hit', 'data-pick': o.id, style: '--ac:' + ac }); add('circle', { cx: p[0], cy: p[1], r: 18, class: 'cell has' }, g); add('circle', { cx: p[0], cy: p[1], r: 21, class: 'ring' }, g); }
        return;
      }
      const cells = new Map();
      for (const o of opts) { if (o.all || (this.pending === 'spell' && !spellFits(o, this.spellPick))) continue; for(const c of (o.cells||[o.cell]).filter(Boolean)){const k=key(c);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(o);} }
      for (const [k, list] of cells) {
        const p = k.split(',').map(Number), g = add('g', { class: 'sbh-hit', 'data-pick': k, style: '--ac:' + ac });
        add('polygon', { points: hexPts(p), class: 'cell' + (list.some(o => o.has || o.id || o.lane) ? ' has' : '') + (this.pickCell === k || this.spellPick.includes(k) ? ' pick' : '') }, g);
        if (list.some(o => o.area)) add('polygon', { points: hexPts(p, GEO.S * 2.7), class: 'area' }, g);
        const t = add('text', { x: GEO.cellXY(p)[0], y: GEO.cellXY(p)[1] + 16, 'text-anchor': 'middle', class: 'tag' }, g);
        t.textContent = this.pending === 'spell' ? (this.spellPick.includes(k) ? '✓ ' + (this.spellPick.indexOf(k) + 1) : '') : list[0].lane ? LANE_CN[list[0].lane] : list.length > 1 ? list.length + '个目标' : this.pending === 'move' ? '移动' : list[0].id ? (list[0].role ? ROLE_SHORT[list[0].role] : '目标') : actionName(this.pending);
      }
    }
  }
  root.MobaSandboxHuman = { mount: o => new HUD(o), options, actors, actionsFor };
})(typeof window !== 'undefined' ? window : globalThis);
