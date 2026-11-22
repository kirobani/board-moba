/* MobaBroadcast · player shell + public API
 *   const p = MobaBroadcast.mount(el, {bridge:true});
 *   p.loadGame(gameJson, {teams, match});      // full frames / slim / compact bundle / compact game
 *   await p.loadUrl('/same-origin/replay.json.gz', {match});
 * Playback is read-only: pause/seek/speed never touch the recorded result.
 */
(function (root) {
  'use strict';
  const MB = root.MobaBroadcast;
  const { ROLES, ROLE_CN, ROLE_SHORT, ACTION_CN } = MB.C;
  const SCRIPT_BASE = (function () { try { const s = document.currentScript && document.currentScript.src; return s ? new URL('../', s).href : new URL('./', root.location.href).href; } catch (e) { return './'; } })();
  MB.base = SCRIPT_BASE;
  MB.version = '1.0.0';
  const CAT = {
    result: ['胜', '#ffd447'], phase: ['阶', '#8fa3ff'], kill: ['杀', '#ff4d6a'], engage: ['团', '#ffb627'], tower: ['塔', '#ff9f43'], jungle: ['野', '#6dff7a'],
    travel: ['行', '#7ff3ff'], control: ['控', '#c77dff'], heal: ['疗', '#59f08a'], damage: ['伤', '#ff6b6b'], lane: ['线', '#ffe066'], econ: ['金', '#ffd447'],
    order: ['令', '#a9b4d6'], invalid: ['误', '#8a90a6'], final: ['决', '#ff9ff3'], move: ['步', '#e8f0ff'],
  };
  const SECTIONS = [['key', '要点'], ['fight', '交战与治疗'], ['lane', '兵线·塔·经济'], ['orders', '本回合指令（已记录）']];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmt = n => (n == null ? '—' : Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
  // signed gold difference: explicit +/−, ±0 when it rounds to zero
  const sgn = d => { const r = Math.round(d); if (r === 0) return '±0'; const a = Math.abs(r); return (r > 0 ? '+' : '−') + (a >= 1000 ? (a / 1000).toFixed(1) + 'k' : a); };
  const sgnFull = d => { const r = Math.round(d); return r === 0 ? '±0' : (r > 0 ? '+' : '−') + Math.abs(r).toLocaleString('en-US'); };
  const kdaRatio = (k, d, a) => ((k + a) / Math.max(1, d)).toFixed(2);
  const ASSIST_NOTE = '助攻A为公开事件推导（role-impact-v1，与赛后技术数据同口径）：受害者被击杀前3个地图回合/30个决战行动内对其造成有效伤害、成功控制，或治疗击杀者的同队其他英雄，每次击杀计1次。';
  const MOTION_KEY = 'hex-moba-reduced-motion-v2';
  // The viewer opens with full round animation and remembers an explicit choice.
  const savedReduced = () => { try { return root.localStorage.getItem(MOTION_KEY) === '1'; } catch (e) { return false; } };
  const saveReduced = value => { try { root.localStorage.setItem(MOTION_KEY, value ? '1' : '0'); } catch (e) { /* Storage may be unavailable; playback still works. */ } };

  class Player {
    constructor(el, opts) {
      this.el = el; this.opts = Object.assign({ bridge: false, embed: false, samples: null, speed: 1 }, opts || {});
      this.listeners = {}; this.game = null; this.k = 0; this.u = 1; this.playing = false; this.speed = this.opts.speed || 1;
      this.filter = { team: 'all', role: 'all' }; this.hero = null; this.feedSel = null; this.tab = 'round'; this.finishedSent = false; this.resultShown = false;
      this.settings = { crt: this.opts.crt || 'soft', reduced: this.opts.reduced != null ? !!this.opts.reduced : savedReduced(), names: this.opts.names || 'all', icons: true, reports: true };
      this.build();
      this.el.classList.toggle('mb-live',!!this.opts.live);
      this.el.classList.toggle('mb-reviewable',!!this.opts.liveReview);
      this.renderer = new MB.Renderer(this.q('.mb-stagehost'), { onPick: id => this.select(id === this.hero ? null : id), tipFor: id => this.tipFor(id) });
      this.renderer.apply(this.settings);
      this.syncSettingsUI();
      this.el.classList.toggle('mb-reduced-alerts',this.settings.reduced);
      this._raf = 0; this._last = 0; this.loop = this.loop.bind(this); this._raf = requestAnimationFrame(this.loop);
      this._onKey = e => this.onKey(e); root.addEventListener('keydown', this._onKey);
      if (this.opts.bridge) this.enableBridge();
      this.showStatus('loading', '等待对局数据…');
    }
    q(s) { return this.el.querySelector(s); }
    on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); return this; }
    off(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); return this; }
    emit(type, detail) {
      for (const fn of this.listeners[type] || []) { try { fn(detail); } catch (e) { console.error(e); } }
      try { this.el.dispatchEvent(new CustomEvent('moba:' + type, { detail, bubbles: true })); } catch (e) { /* ignore */ }
      if (this.opts.bridge && root.parent && root.parent !== root) { try { root.parent.postMessage({ type: 'moba:' + type, ...detail }, root.location.origin); } catch (e) { /* ignore */ } }
    }

    // ---------- DOM ----------
    build() {
      const el = this.el; el.classList.add('mb-root'); if (this.opts.embed) el.classList.add('mb-embed');
      el.innerHTML = `
<header class="mb-head">
  <div class="mb-brand">HEX·MOBA<span>像素观赛台</span></div>
  <div class="mb-matchinfo"><b class="mb-title">—</b><span class="mb-sub"></span></div>
  <div class="mb-headtools">
    <label class="mb-pickwrap">对局 <select class="mb-pick" aria-label="选择样例对局"></select></label>
    <label class="mb-btn mb-import" title="导入本地回放 JSON 或 .json.gz">导入<input type="file" accept=".json,.gz,application/json,application/gzip" hidden></label>
  </div>
</header>
<div class="mb-score" aria-label="比分">
  <div class="mb-sc mb-scA"><span class="mb-scname"></span><span class="mb-scstats"></span></div>
  <div class="mb-scmid"><div class="mb-kills"><b class="mb-kA">0</b><i>击杀</i><b class="mb-kB">0</b></div><div class="mb-gdiff" aria-live="off"><i>经济差</i><b class="mb-gdlead">—</b><small class="mb-gdab"></small></div><div class="mb-goldbar"><span class="mb-gA"></span><span class="mb-gB"></span></div><div class="mb-phase"><span class="mb-phasechip"></span><span class="mb-phasedet"></span></div></div>
  <div class="mb-sc mb-scB"><span class="mb-scname"></span><span class="mb-scstats"></span></div>
</div>
<main class="mb-main">
  <aside class="mb-teams" aria-label="队伍详情"><section class="mb-team mb-teamA"></section><section class="mb-team mb-teamB"></section><p class="mb-kdanote">K/D/A = 击杀/阵亡/<u>助攻</u>（助攻为公开事件推导，悬停查看口径与KDA比值）。对位 = 本人当前金币 − 对方同位置当前金币。</p></aside>
  <section class="mb-center">
    <div class="mb-announcement-slot"><span class="mb-announcement-placeholder">战场快报 · 击杀 / 破塔 / 远古</span><section class="mb-big-announcement" aria-label="战场公告" aria-live="off" hidden></section></div>
    <div class="mb-stagewrap">
      <div class="mb-stagehost"></div>
      <div class="mb-roundbadge"><b class="mb-rnum">R0</b><span class="mb-rsub"></span></div>
      <div class="mb-legend" aria-label="指令图例"></div>
      <div class="mb-combat-hud"><aside class="mb-alert-log" aria-label="击杀与目标战报" hidden></aside></div>
      <div class="mb-status" hidden><div class="mb-statusbox"><b class="mb-stitle"></b><p class="mb-smsg"></p></div></div>
      <div class="mb-result" hidden></div>
    </div>
    <div class="mb-caption" role="status"><span class="mb-capr">R0</span><span class="mb-capt">—</span></div>
    <div class="mb-transport">
      <div class="mb-btns">
        <button class="mb-b mb-first" title="回到开局 (Home)" aria-label="回到开局">⏮</button>
        <button class="mb-b mb-prev" title="上一回合 (←)" aria-label="上一回合">◀</button>
        <button class="mb-b mb-play" title="播放/暂停 (空格)" aria-label="播放">▶</button>
        <button class="mb-b mb-next" title="下一回合 (→)" aria-label="下一回合">▶|</button>
        <button class="mb-b mb-last" title="跳到末帧 (End)" aria-label="跳到末帧">⏭</button>
        <div class="mb-speed" role="group" aria-label="倍速"></div>
      </div>
      <div class="mb-timeline"><canvas class="mb-marks" aria-hidden="true"></canvas><input class="mb-seek" type="range" min="0" max="0" value="0" step="1" aria-label="时间轴"><div class="mb-progress"><span class="mb-counter">0 / 0</span><span class="mb-pct"></span></div></div>
    </div>
    <div class="mb-settings">
      <label>CRT <select class="mb-crtsel" aria-label="CRT效果"><option value="off">关闭</option><option value="soft">柔和</option><option value="strong">强烈</option></select></label>
      <label class="mb-chk"><input type="checkbox" class="mb-reduce">减少动态</label>
      <label>名牌 <select class="mb-namesel" aria-label="场上名牌"><option value="all">全部</option><option value="focus">仅选中</option><option value="off">隐藏</option></select></label>
      <label class="mb-chk"><input type="checkbox" class="mb-icons" checked>指令图标</label>
      <label class="mb-chk"><input type="checkbox" class="mb-reports" checked>画面战报</label>
      <label>队伍 <select class="mb-teamsel" aria-label="队伍筛选"><option value="all">全部</option><option value="A">A</option><option value="B">B</option></select></label>
      <label>角色 <select class="mb-rolesel" aria-label="角色筛选"><option value="all">全部</option>${ROLES.map(r => `<option value="${r}">${ROLE_CN[r]}</option>`).join('')}</select></label>
    </div>
  </section>
  <aside class="mb-feed" aria-label="回合播报">
    <section class="mb-economy" aria-label="实时经济差曲线"></section>
    <div class="mb-tabs" role="tablist"><button class="mb-tab on" data-tab="round" role="tab">这一回合发生了什么</button><button class="mb-tab" data-tab="match" role="tab">全场要闻</button></div>
    <div class="mb-feedbody" tabindex="0"></div>
    <div class="mb-basis">依据：<span class="mb-bz rec">记录</span>原始事件/指令 <span class="mb-bz diff">帧差</span>相邻帧差分 <span class="mb-bz inf">推断</span>由记录组合 <span class="mb-bz rule">规则</span>公开规则</div>
  </aside>
</main>`;
      const sp = this.q('.mb-speed');
      for (const s of [0.5, 1, 2, 4, 8]) { const b = h('button', 'mb-b mb-sp' + (s === this.speed ? ' on' : ''), s + '×'); b.dataset.speed = s; b.onclick = () => this.setSpeed(s); sp.appendChild(b); }
      this.q('.mb-play').onclick = () => this.toggle();
      this.q('.mb-prev').onclick = () => this.step(-1);
      this.q('.mb-next').onclick = () => this.step(1);
      this.q('.mb-first').onclick = () => { this.pause(); this.seek(0); };
      this.q('.mb-last').onclick = () => { this.pause(); this.seek(this.n() - 1); };
      const seek = this.q('.mb-seek');
      seek.oninput = () => { this.pause(); this.seek(+seek.value); };
      this.q('.mb-crtsel').onchange = e => this.setSettings({ crt: e.target.value });
      this.q('.mb-reduce').onchange = e => this.setSettings({ reduced: e.target.checked });
      this.q('.mb-namesel').onchange = e => this.setSettings({ names: e.target.value });
      this.q('.mb-icons').onchange = e => this.setSettings({ icons: e.target.checked });
      this.q('.mb-reports').onchange = e => this.setSettings({ reports: e.target.checked });
      this.q('.mb-teamsel').onchange = e => this.setFilter({ team: e.target.value });
      this.q('.mb-rolesel').onchange = e => this.setFilter({ role: e.target.value });
      for (const t of this.el.querySelectorAll('.mb-tab')) t.onclick = () => { this.tab = t.dataset.tab; this.el.querySelectorAll('.mb-tab').forEach(x => x.classList.toggle('on', x === t)); this.renderFeed(true); };
      this.q('.mb-import input').onchange = async e => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        this.showStatus('loading', '读取本地文件 ' + file.name + ' …');
        try { const data = await MB.bytesToJSON(await file.arrayBuffer()); await this.loadGame(data, {}); }
        catch (err) { this.fail(err); }
        e.target.value = '';
      };
      this.q('.mb-pick').onchange = e => { const v = e.target.value; if (v && this.opts.onPick) this.opts.onPick(v); };
      // legend of order icons
      const lg = this.q('.mb-legend');
      for (const a of ['move', 'attack', 'spell', 'reap', 'capture', 'push', 'heal', 'control', 'recall', 'teleport', 'engage', 'wait']) {
        const item = h('span', 'mb-lgi'); const c = MB.sprite(a, null); const cv = document.createElement('canvas'); cv.width = 7; cv.height = 7; cv.getContext('2d').drawImage(c, 0, 0); item.appendChild(cv); item.appendChild(document.createTextNode(ACTION_CN[a])); lg.appendChild(item);
      }
      this.q('.mb-marks').addEventListener('click', e => { const r = e.target.getBoundingClientRect(); const v = (e.clientX - r.left) / r.width; this.pause(); this.seek(Math.round(v * this.lastVisible())); });
    }
    syncSettingsUI() {
      this.q('.mb-crtsel').value = this.settings.crt; this.q('.mb-reduce').checked = this.settings.reduced; this.q('.mb-namesel').value = this.settings.names; this.q('.mb-icons').checked = this.settings.icons; this.q('.mb-reports').checked = this.settings.reports;
    }
    setSamples(list, current) {
      const sel = this.q('.mb-pick'); sel.innerHTML = '';
      for (const s of list) { const o = h('option', null, esc(s.title || s.id)); o.value = s.id; if (s.id === current) o.selected = true; sel.appendChild(o); }
      if (current && !list.some(s => s.id === current)) { const o = h('option', null, esc(current + '（外部数据）')); o.value = ''; o.selected = true; sel.appendChild(o); }
      this.q('.mb-pickwrap').hidden = !list.length;
    }

    // ---------- loading ----------
    showStatus(kind, msg, title) {
      const st = this.q('.mb-status'); st.hidden = false; st.dataset.kind = kind;
      this.q('.mb-stitle').textContent = title || (kind === 'error' ? '无法加载对局' : '载入中');
      this.q('.mb-smsg').innerHTML = esc(msg).replace(/\n/g, '<br>');
    }
    hideStatus() { this.q('.mb-status').hidden = true; }
    fail(err) {
      const msg = (err && err.message) || String(err);
      this.showStatus('error', msg + '\n\n可用方式：?data=<同源JSON或.json.gz>&match=<对局ID>，或点“导入”选择本地回放文件，或从“对局”下拉选择内置真实样例。');
      this.emit('error', { message: msg });
    }
    async loadUrl(url, opts) {
      opts = opts || {};
      this.pause(); this.showStatus('loading', '正在加载 ' + url + ' …');
      try {
        const data = await MB.fetchJSON(url);
        return await this.loadGame(data, opts);
      } catch (err) { this.fail(err); throw err; }
    }
    async loadGame(input, opts) {
      opts = opts || {};
      let game;
      try {
        game = MB.normalize(input, opts);
        if ((!game.labels.A || !game.labels.B) && game.id) {
          const m = await MB.matchInfo(game.id).catch(() => null);
          if (m) game = MB.normalize(input, { ...opts, labels: m.labels });
        }
      } catch (err) { this.fail(err); throw err; }
      this.game = game; this.k = 0; this.u = 1; this.hero = null; this.feedSel = null; this.finishedSent = false; this.resultShown = false;
      this.watched = 0;
      this.keyEvents = MB.story.keyEvents(game);
      this.roundCache = new Map();
      this.renderer.setGame(game);
      this.hideStatus(); this.q('.mb-result').hidden = true;
      const seek = this.q('.mb-seek'); seek.max = String(this.lastVisible()); seek.value = '0';
      this.renderHeader(); this.renderMarks();
      this.economyChart = root.MobaEconomyCurve.mount(this.q('.mb-economy'), game.frames, {A: game.teams.A.team, B: game.teams.B.team, live: true, compact: true});
      this.highlights = new MB.Highlights(this);
      const start = Math.max(0, Math.min(game.frames.length - 1, opts.round != null ? +opts.round : 0));
      const summary = this.summary();
      this.emit('ready', summary);
      this._loadingLive=true;this.seek(start);this._loadingLive=false;
      if (opts.autoplay) this.play();
      return summary;
    }
    summary() {
      const g = this.game; if (!g) return null;
      return { id: g.id, source: g.source, frames: g.frames.length, labels: { ...g.labels }, teams: { A: g.teams.A.team, B: g.teams.B.team }, players: Object.fromEntries(g.heroIds.map(id => [id, g.name(id)])), result: g.result ? { ...g.result } : null, note: '结果来自已保存的对局记录；观看不会重算比赛或积分。' };
    }
    appendGame(input) {
      if (!this.game || input.id!==this.game.id) throw Error('只能追加当前对局');
      const start=this.n();
      if(input.frames.length<start)throw Error('已播帧不能回退');
      const added=MB.appendFullFrames(this.game,input.frames.slice(start),input);
      if(added.length){
        this.economyChart.append(added);this.keyEvents=MB.story.keyEvents(this.game);
        this.highlights.data=MB.highlights.index(this.game);
        if (!this.opts.progressive) {this.q('.mb-seek').max=String(this.n()-1);this.renderMarks();}
        this.finishedSent=false;this.resultShown=false;this._streamDrained=null;
      }
      return added.length;
    }
    followStream(active) {
      if(!active){if(this.playing||this.following)this.pause();return;}
      if(this.following&&this.playing)return;
      this.following=true;this.playing=true;this._last=performance.now();
      this.q('.mb-play').textContent='❚❚';this.q('.mb-play').setAttribute('aria-label','暂停');
      this.q('.mb-caption').setAttribute('aria-live','off');
    }
    seekStream(index){this._loadingLive=true;this.seek(index);this._loadingLive=false;}

    // ---------- transport ----------
    n() { return this.game ? this.game.frames.length : 0; }
    lastVisible() { return this.opts.progressive ? this.watched : Math.max(0,this.n()-1); }
    play() { if (!this.game || (this.opts.live&&!this.opts.liveReview)) return; if(this.opts.progressive&&(!this.game.result||this.watched<this.n()-1)){this.followStream(true);return;} this._streamDrained=null; if(this.opts.live)this.emit('review',{index:this.k}); if (this.k >= this.n() - 1) { this.seek(0); } this.playing = true; if (this.u >= 1) { this.k = Math.min(this.n() - 1, this.k + 1); this.u = 0; this.afterSeek(); } this._last = performance.now(); this.q('.mb-play').textContent = '❚❚'; this.q('.mb-play').setAttribute('aria-label', '暂停'); this.q('.mb-caption').setAttribute('aria-live', 'off'); }
    pause() { this.playing = false; this.following=false; const b = this.q('.mb-play'); if (b) { b.textContent = '▶'; b.setAttribute('aria-label', '播放'); } const c = this.q('.mb-caption'); if (c) c.setAttribute('aria-live', 'polite'); }
    toggle() { this.playing ? this.pause() : this.play(); }
    setSpeed(s) { this.speed = s; this.el.querySelectorAll('.mb-sp').forEach(b => b.classList.toggle('on', +b.dataset.speed === s)); }
    step(d) {
      if (!this.game || (this.opts.live&&!this.opts.liveReview)) return; this.pause();
      if(this.opts.live)this.emit('review',{index:Math.max(0,Math.min(this.lastVisible(),this.k+d))});
      const k = Math.max(0, Math.min(this.lastVisible(), this.k + d));
      if (d > 0 && k !== this.k) { this.k = k; this.u = this.settings.reduced ? 1 : 0; this.stepAnim = true; this._last = performance.now(); this.afterSeek(); }
      else this.seek(k);
    }
    seek(k) { if (!this.game || (this.opts.live&&!this.opts.liveReview&&!this._loadingLive)) return; this.k = Math.max(0, Math.min(this.lastVisible(), k | 0)); this.u = 1; this.stepAnim = false; this._streamDrained=null; if(this.opts.live&&!this._loadingLive)this.emit('review',{index:this.k}); this.afterSeek(); }
    setLive(value,{progressive=false}={}) {
      this.opts.live=!!value;
      this.opts.progressive=!!value&&progressive;
      this.pause();
      this.el.classList.toggle('mb-live',this.opts.live);
      this.el.classList.toggle('mb-progressive',this.opts.progressive);
      this.q('[data-tab="match"]').textContent=this.opts.progressive?'已播要闻':'全场要闻';
      const last=this.q('.mb-last');
      last.title=this.opts.progressive?'跳到已播末尾 (End)':'跳到末帧 (End)';
      last.setAttribute('aria-label',this.opts.progressive?'跳到已播末尾':'跳到末帧');
    }
    afterSeek() {
      if (this.opts.progressive && this.k>this.watched) {
        this.watched=this.k;
        this.q('.mb-seek').max=String(this.watched);
        this.renderMarks();
      }
      this.q('.mb-seek').value = String(this.k);
      this.feedSel = null;
      this.renderRound();
      const f = this.game.frames[this.k];
      this.emit('round', { id: this.game.id, index: this.k, turn: f.turn, mapTurn: f.mapTurn, phase: f.phase, frames: this.n() });
      if (this.k === this.n() - 1 && !this.finishedSent) { this.finishedSent = true; this.emit('finished', { id: this.game.id, index: this.k, result: this.game.result ? { ...this.game.result } : null, note: '仅表示播放到末帧；不代表重新计算比赛或积分更新。' }); }
    }
    loop(now) {
      this._raf = requestAnimationFrame(this.loop);
      if (!this.game) return;
      const dt = Math.min(100, now - (this._last || now)); this._last = now;
      const dur = (this.game.frames[this.k].phase === 'map' ? 1000 : 1300) / this.speed;
      if (this.playing) {
        this.u += dt / (dur * 0.8);
        if (this.settings.reduced) this.u = Math.max(this.u, 1);
        if (this.u >= 1.25) {
          if (this.k < this.n() - 1) { this.k++; this.u = this.settings.reduced ? 1 : 0; this.afterSeek(); }
          else {
            this.u=1.25;
            if(this.opts.live&&this.following&&!this.game.result){ /* Wait at the buffer edge without restarting animation. */ }
            else {
              this.u=1;this.pause();
              const key=this.game.id+':'+this.n();
              if(this._streamDrained!==key){this._streamDrained=key;this.emit('drained',{id:this.game.id,index:this.k});}
            }
          }
        }
      } else if (this.stepAnim) { this.u += dt / (900 * 0.8); if (this.u >= 1) { this.u = 1; this.stepAnim = false; } }
      if (this.k === this.n() - 1 && this.u >= 0.95 && !this.resultShown) { this.resultShown = true; this.showResult(); }
      this.renderer.draw(this.k, Math.min(1, this.u), now, this.viewSel());
    }
    viewSel() {
      const sel = { hero: this.hero, cells: null, focus: null };
      const focus = new Set();
      if (this.feedSel) { (this.feedSel.units || []).forEach(u => focus.add(u)); sel.cells = (this.feedSel.cells || []).filter(Boolean); }
      if (this.hero) focus.add(this.hero);
      if (this.filter.team !== 'all' || this.filter.role !== 'all') for (const id of this.game.heroIds) if (this.matchFilter(id)) focus.add(id);
      if (focus.size) sel.focus = focus;
      return sel;
    }
    matchFilter(id) { return (this.filter.team === 'all' || id[0] === this.filter.team) && (this.filter.role === 'all' || id.slice(2) === this.filter.role); }
    setFilter(f) { Object.assign(this.filter, f); this.q('.mb-teamsel').value = this.filter.team; this.q('.mb-rolesel').value = this.filter.role; this.renderFeed(); this.renderTeams(); }
    setSettings(s) { Object.assign(this.settings, s); if (Object.prototype.hasOwnProperty.call(s, 'reduced')) saveReduced(!!s.reduced); this.renderer.apply(this.settings); this.syncSettingsUI(); this.q('.mb-combat-hud').hidden = !this.settings.reports; this.q('.mb-announcement-slot').hidden = !this.settings.reports; this.el.classList.toggle('mb-reduced-alerts',this.settings.reduced); if (s.reduced) { this.u = 1; this.stepAnim = false; } }
    select(id) { this.hero = id || null; this.renderTeams(); this.renderFeed(); }
    getState() { const f = this.game && this.game.frames[this.k]; return { id: this.game && this.game.id, index: this.k, frames: this.n(), mapTurn: f && f.mapTurn, phase: f && f.phase, playing: this.playing, speed: this.speed, settings: { ...this.settings }, filter: { ...this.filter }, hero: this.hero }; }
    onKey(e) {
      if (!this.game || !this.el.isConnected || (this.opts.live&&!this.opts.liveReview)) return;
      if (e.target?.closest('.economy-curve')) return;
      const ae = document.activeElement; if (ae && ae !== document.body && !this.el.contains(ae)) return;
      const tag = (e.target && e.target.tagName) || ''; if (/INPUT|SELECT|TEXTAREA/.test(tag) && e.target.type !== 'range') return;
      if (e.key === ' ') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'Home') { this.pause(); this.seek(0); }
      else if (e.key === 'End') { this.pause(); this.seek(this.n() - 1); }
      else if (e.key === 'Escape') { this.q('.mb-result').hidden = true; this.select(null); }
    }
    destroy() { cancelAnimationFrame(this._raf); root.removeEventListener('keydown', this._onKey); if (this._onMsg) root.removeEventListener('message', this._onMsg); this.renderer.destroy(); this.el.innerHTML = ''; }

    // ---------- postMessage bridge (same-origin only) ----------
    enableBridge() {
      this._onMsg = e => {
        if (e.origin !== root.location.origin) return;
        const d = e.data; if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
        if (d.type === 'moba:load') { this.loadGame(d.game, { teams: d.teams, match: d.match, labels: d.labels, round: d.round, autoplay: d.autoplay }).catch(() => { }); }
        else if (d.type === 'moba:loadUrl' && typeof d.url === 'string') { this.loadUrl(d.url, { teams: d.teams, match: d.match, round: d.round, autoplay: d.autoplay }).catch(() => { }); }
        else if (d.type === 'moba:play') this.play();
        else if (d.type === 'moba:pause') this.pause();
        else if (d.type === 'moba:seek' && Number.isFinite(d.index)) { this.pause(); this.seek(d.index); }
        else if (d.type === 'moba:settings' && d.settings) this.setSettings(d.settings);
      };
      root.addEventListener('message', this._onMsg);
    }

    // ---------- rendering of panels ----------
    renderHeader() {
      const g = this.game, A = g.teams.A, B = g.teams.B;
      const title = A.team + (A.baseline && A.policy ? '·' + A.policy : '') + '  对  ' + B.team + (B.baseline && B.policy ? '·' + B.policy : '');
      this.q('.mb-title').textContent = title;
      const r = g.result;
      this.q('.mb-sub').textContent = this.opts.progressive ? '' : [g.id, g.seed != null ? 'seed ' + g.seed : null, g.source === 'compact' ? 'compact显示帧' : '完整帧', g.frames.length + '帧'].filter(Boolean).join(' · ');
      this.q('.mb-scA .mb-scname').textContent = A.team; this.q('.mb-scB .mb-scname').textContent = B.team;
      void r;
    }
    renderMarks() {
      const cv = this.q('.mb-marks'), w = Math.max(300, Math.round(cv.clientWidth || 600)), hgt = 18, dpr = root.devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = hgt * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
      const visible = this.lastVisible(), X = k => Math.round((k / Math.max(1, visible)) * (w - 2)) + 1;
      const fr = this.game.frames.slice(0,visible+1), ll = this.game.config.laneLock;
      const iLL = fr.findIndex(f => f.phase === 'map' && f.mapTurn > ll), iF = fr.findIndex(f => f.phase !== 'map');
      g.fillStyle = '#1b2040'; g.fillRect(0, 6, w, 6);
      if (iLL > 0) { g.fillStyle = '#26305e'; g.fillRect(0, 6, X(iLL), 6); }
      if (iF > 0) { g.fillStyle = '#5a2a5e'; g.fillRect(X(iF), 6, w - X(iF), 6); }
      for (const e of this.keyEvents) {
        if (e.k>visible) continue;
        const col = e.cat === 'kill' ? (e.team === 'A' ? '#5fb0ff' : '#ff7a55') : (CAT[e.cat] || CAT.phase)[1];
        const hh = e.cat === 'tower' || e.cat === 'result' || (e.cat === 'jungle' && e.text.includes('夺下')) ? 18 : e.cat === 'kill' ? 10 : 8;
        g.fillStyle = col; g.fillRect(X(e.k), e.cat === 'kill' ? (e.team === 'A' ? 0 : 8) : 9 - hh / 2, e.cat === 'tower' ? 2 : 1, hh);
      }
      cv.style.width = '100%'; cv.style.height = hgt + 'px';
    }
    renderRound() {
      const g = this.game, f = g.frames[this.k];
      const ph = MB.story.phaseInfo(g, this.k);
      const rl = f.phase === 'map' ? 'R' + f.mapTurn : f.phase === 'final_pending' ? '入场' : '决战' + (f.battle ? f.battle.actions : '');
      this.q('.mb-rnum').textContent = rl;
      this.q('.mb-rsub').textContent = ph.label;
      this.q('.mb-phasechip').textContent = ph.label; this.q('.mb-phasechip').dataset.code = ph.code;
      this.q('.mb-phasedet').textContent = ph.detail;
      this.q('.mb-counter').textContent = this.opts.progressive ? (f.phase==='map'?'第 '+f.mapTurn+' 回合':ph.label) : (f.phase === 'map' ? '第 ' + f.mapTurn + ' / ' + g.config.maxTurns + ' 回合' : ph.label + (f.battle ? ' 第' + f.battle.round + '轮' : '')) + ' · 帧 ' + this.k + '/' + this.lastVisible();
      this.q('.mb-pct').textContent = this.opts.progressive ? '' : Math.round(this.k / Math.max(1, this.lastVisible()) * 100) + '%';
      const story = this.roundStory(this.k);
      this.q('.mb-capr').textContent = rl;
      this.q('.mb-capt').textContent = story.headline;
      // scoreboard
      for (const t of ['A', 'B']) {
        const tm = f.teams[t] || {}, gold = MB.teamGold(f, t);
        this.q('.mb-k' + t).textContent = tm.kills || 0;
        this.q('.mb-sc' + t + ' .mb-scstats').innerHTML = `<span title="摧毁防御塔">塔 ${tm.towers || 0}</span><span title="夺取远古">远古 ${tm.ancients || 0}</span><span title="全队经济">金 ${fmt(gold)}</span><span title="基地耐久">基地 ${Math.round((f.buildings.find(b => b.id === t + '_base') || {}).hp || 0)}</span>`;
      }
      const ga = MB.teamGold(f, 'A'), gb = MB.teamGold(f, 'B'), tot = Math.max(1, ga + gb);
      this.q('.mb-gA').style.width = (ga / tot * 100).toFixed(1) + '%'; this.q('.mb-gB').style.width = (gb / tot * 100).toFixed(1) + '%';
      this.q('.mb-goldbar').title = '经济 ' + Math.round(ga) + ' : ' + Math.round(gb);
      const ed = MB.economy(f).diff, er = Math.round(ed), gd = this.q('.mb-gdiff');
      gd.dataset.lead = er > 0 ? 'A' : er < 0 ? 'B' : 'even';
      this.q('.mb-gdlead').textContent = er === 0 ? '持平 ±0' : g.teams[er > 0 ? 'A' : 'B'].team + ' 领先 ' + Math.abs(er).toLocaleString('en-US');
      this.q('.mb-gdab').textContent = 'A−B ' + sgnFull(ed);
      gd.title = '当前帧 A队总金币 ' + Math.round(ga).toLocaleString('en-US') + ' − B队总金币 ' + Math.round(gb).toLocaleString('en-US') + ' = ' + sgnFull(ed);
      this.economyChart.setFrame(this.k);
      this.highlights.render(this.k);
      this.renderTeams(); this.renderFeed();
      if (this.k < this.n() - 1) this.q('.mb-result').hidden = true;
    }
    roundStory(k) { let s = this.roundCache.get(k); if (!s) { s = MB.story.round(this.game, k); this.roundCache.set(k, s); } return s; }
    renderTeams() {
      if (!this.game) return;
      const g = this.game, f = g.frames[this.k], c = g.config;
      for (const t of ['A', 'B']) {
        const box = this.q('.mb-team' + t), info = g.teams[t], tm = f.teams[t] || {};
        const head = `<header><span class="mb-side mb-side${t}">${t}</span><span class="mb-teamname"><b>${esc(info.team)}</b>${info.region ? `<small>#${esc(info.region)}</small>` : ''}</span>${info.baseline ? `<em>公开基准 · ${esc(info.policy || '')}</em>` : ''}</header>`;
        const econ = MB.economy(f);
        const rows = ROLES.map(role => {
          const id = t + '_' + role, hh = f.heroes.find(x => x.id === id); if (!hh) return '';
          const o = (f.orders[t] || []).find(x => x.unit === id), out = o ? MB.story.orderOutcome(f, o) : null;
          const st = [];
          if (!hh.alive) st.push(`<span class="mb-st dead">阵亡${hh.respawnAt && f.phase === 'map' ? ' · R' + hh.respawnAt + '复活' : ''}</span>`);
          if (hh.alive && f.phase === 'map' && hh.stunUntil >= f.mapTurn + 1) st.push('<span class="mb-st stun" title="被控制：直到第' + hh.stunUntil + '回合不能行动">受控至R' + hh.stunUntil + '</span>');
          if (hh.engagementId) st.push('<span class="mb-st eng">团战#' + hh.engagementId + '</span>');
          if (f.phase === 'map' && role === 'top') st.push(hh.teleportReady <= f.mapTurn + 1 ? '<span class="mb-st ok">传送就绪</span>' : '<span class="mb-st cd">传送R' + hh.teleportReady + '</span>');
          if (f.phase === 'map' && role === 'jungle') st.push(hh.engageReady <= f.mapTurn + 1 && f.mapTurn + 1 >= c.engageUnlockRound ? '<span class="mb-st ok">开团就绪</span>' : '<span class="mb-st cd">开团R' + Math.max(hh.engageReady || 0, c.engageUnlockRound) + '</span>');
          const heals = role === 'support' && !(f.phase === 'final_battle' && f.heroes.filter(h => h.team === t && h.alive).length === 1 && hh.alive);
          const power = (heals ? '治疗 ' : '攻击 ') + MB.heroPower(hh, c, heals);
          const ratio = hh.maxHP ? Math.max(0, hh.hp / hh.maxHP) : 0;
          const ln = econ.lane[id], lr = Math.round(ln.diff), as = hh.assists || 0;
          const kdaTitle = 'K/D/A 击杀 ' + hh.kills + ' / 阵亡 ' + hh.deaths + ' / 助攻 ' + as + ' · KDA (K+A)/max(1,D) = ' + kdaRatio(hh.kills, hh.deaths, as) + '\n' + ASSIST_NOTE;
          const ecoTitle = '对位经济差 vs ' + g.name(ln.opponentId) + '：本人 ' + Math.round(ln.self).toLocaleString('en-US') + ' − 对方 ' + Math.round(ln.opponent).toLocaleString('en-US') + ' = ' + sgnFull(ln.diff);
          const ord = o ? `<span class="mb-ord" data-a="${o.action}"><canvas data-icon="${o.action}" width="7" height="7"></canvas>${ACTION_CN[o.action] || o.action} ${esc(MB.story.orderTarget(g, f, o))}${out ? ` <i class="${out.ok ? 'ok' : 'bad'}">${esc(out.text)}</i>` : ''}</span>` : `<span class="mb-ord none">${f.phase === 'map' && this.k > 0 ? '无指令（按待命）' : '—'}</span>`;
          const cls = ['mb-hero', 'mb-r-' + role, this.hero === id ? 'sel' : '', !this.matchFilter(id) && (this.filter.team !== 'all' || this.filter.role !== 'all') ? 'dim' : '', hh.alive ? '' : 'isdead'].join(' ');
          return `<div class="${cls}" data-id="${id}" tabindex="0" role="button" aria-pressed="${this.hero === id}">
<div class="mb-hrow1"><canvas class="mb-port" data-role="${role}" data-team="${t}" width="12" height="12"></canvas><span class="mb-rc">${ROLE_SHORT[role]}</span><b class="mb-hn" title="${esc(g.name(id))}">${esc(g.name(id))}</b><span class="mb-kd" title="${esc(kdaTitle)}" aria-label="${esc(kdaTitle)}">${hh.kills}/${hh.deaths}/<span class="mb-ka">${as}</span></span></div>
<div class="mb-hrow2"><span class="mb-hp"><i style="width:${(ratio * 100).toFixed(1)}%" class="${ratio > .6 ? 'hi' : ratio > .3 ? 'md' : 'lo'}"></i></span><span class="mb-hpn">${Math.round(hh.hp)}/${hh.maxHP}</span><span class="mb-gold">${fmt(hh.gold)}金</span><span class="mb-ediff" data-s="${lr > 0 ? 'up' : lr < 0 ? 'down' : 'even'}" title="${esc(ecoTitle)}" aria-label="${esc(ecoTitle)}"><i>对位</i>${sgn(ln.diff)}</span></div>
<div class="mb-hrow3"><span class="mb-power">${esc(power)}</span>${ord}${st.join('')}</div></div>`;
        }).join('');
        box.innerHTML = head + `<div class="mb-tstats">击杀 <b>${tm.kills || 0}</b> · 塔 <b>${tm.towers || 0}</b> · 远古 <b>${tm.ancients || 0}</b> · 经济 <b>${fmt(MB.teamGold(f, t))}</b></div>` + rows;
        box.querySelectorAll('canvas.mb-port').forEach(cv => { const s = MB.sprite(cv.dataset.role, cv.dataset.team, ''); cv.getContext('2d').drawImage(s, 0, 0); });
        box.querySelectorAll('canvas[data-icon]').forEach(cv => { cv.getContext('2d').drawImage(MB.sprite(cv.dataset.icon, null), 0, 0); });
        box.querySelectorAll('.mb-hero').forEach(r => { r.onclick = () => this.select(this.hero === r.dataset.id ? null : r.dataset.id); r.onkeydown = e => { if (e.key === 'Enter') r.click(); }; });
      }
    }
    renderFeed(scroll) {
      if (!this.game) return;
      const body = this.q('.mb-feedbody');
      const B = { record: ['rec', '记录'], diff: ['diff', '帧差'], inferred: ['inf', '推断'], rule: ['rule', '规则'] };
      const pass = it => {
        if (this.hero) return (it.units || []).includes(this.hero) || (it.team === this.hero[0] && !(it.units || []).length && it.cat !== 'order');
        if (this.filter.team === 'all' && this.filter.role === 'all') return true;
        if ((it.units || []).length) return it.units.some(u => this.matchFilter(u));
        return this.filter.role === 'all' && (!it.team || it.team === this.filter.team);
      };
      if (this.tab === 'round') {
        const st = this.roundStory(this.k), items = st.items.filter(pass);
        let html = '';
        const f = this.game.frames[this.k];
        html += `<div class="mb-fhead">${f.phase === 'map' ? '第 ' + f.mapTurn + ' 回合' : MB.story.phaseInfo(this.game, this.k).label} <small>${items.length}/${st.items.length} 条${this.hero ? ' · 仅 ' + esc(this.game.name(this.hero)) : ''}</small></div>`;
        for (const [sec, title] of SECTIONS) {
          const list = items.filter(x => x.sec === sec); if (!list.length) continue;
          html += `<div class="mb-fsec"><div class="mb-fst">${title}</div>`;
          list.forEach(it => {
            const c = CAT[it.cat] || CAT.phase, b = B[it.basis] || B.record, idx = st.items.indexOf(it);
            html += `<button class="mb-fi${this.feedSel === it ? ' on' : ''}" data-i="${idx}"><span class="mb-chip" style="--c:${c[1]}">${c[0]}</span><span class="mb-ft">${esc(it.text)}${it.outcome ? ` <i class="${it.outcome.ok ? 'ok' : 'bad'}">${esc(it.outcome.text)}</i>` : ''}</span><span class="mb-bz ${b[0]}">${b[1]}</span></button>`;
          });
          html += '</div>';
        }
        if (!items.length) html += '<p class="mb-empty">' + (st.items.length ? '当前筛选下本回合没有相关事件。' : '本回合没有记录事件。') + '</p>';
        body.innerHTML = html;
        body.querySelectorAll('.mb-fi').forEach(b => b.onclick = () => { const it = st.items[+b.dataset.i]; this.feedSel = this.feedSel === it ? null : it; body.querySelectorAll('.mb-fi').forEach(x => x.classList.toggle('on', x === b && !!this.feedSel)); });
      } else {
        const list = this.keyEvents.filter(e=>e.k<=this.lastVisible()&&pass(e));
        let html = `<div class="mb-fhead">${this.opts.progressive?'已播要闻':'全场要闻'} <small>点击跳转回合 · ${list.length} 条</small></div>`;
        let cur = -1;
        list.forEach((e, i) => { if (e.k <= this.k) cur = i; });
        list.forEach((e, i) => {
          const c = CAT[e.cat] || CAT.phase, f = this.game.frames[e.k];
          html += `<button class="mb-fi mb-ke${i === cur ? ' cur' : ''}${e.k > this.k ? ' future' : ''}" data-k="${e.k}"><span class="mb-kr">${f.phase === 'map' ? 'R' + f.mapTurn : '决战'}</span><span class="mb-chip" style="--c:${c[1]}">${c[0]}</span><span class="mb-ft">${esc(e.text)}</span></button>`;
        });
        body.innerHTML = html;
        body.querySelectorAll('.mb-ke').forEach(b => b.onclick = () => { this.pause(); this.seek(+b.dataset.k); });
        const c = body.querySelector('.mb-ke.cur'); if (c && (scroll || this.playing)) c.scrollIntoView({ block: 'nearest' });
      }
    }
    tipFor(id) {
      const g = this.game, f = g.frames[this.k], hh = f.heroes.find(x => x.id === id); if (!hh) return '';
      const o = (f.orders[id[0]] || []).find(x => x.unit === id);
      return `<b class="t${id[0]}">${esc(g.name(id))}</b><br>${ROLE_CN[hh.role]} · HP ${Math.round(hh.hp)}/${hh.maxHP} · ${fmt(hh.gold)}金 · K/D/A ${hh.kills}/${hh.deaths}/${hh.assists || 0}<br>对位经济 ${esc(sgnFull(MB.economy(f).lane[id].diff))} · 位置 (${hh.p[0]},${hh.p[1]})${hh.role==='mid'?' · 法术就绪 '+(f.phase==='final_battle'?'个人T'+(f.battle?.spellReady?.[id]??'—'):'R'+(hh.spellReady??'—')):hh.role==='adc'?' · 收割就绪 '+(f.phase==='final_battle'?'个人T'+(f.battle?.reapReady?.[id]??'—'):'R'+(hh.reapReady??'—')):''}${o ? '<br>指令：' + esc((ACTION_CN[o.action] || o.action) + ' ' + MB.story.orderTarget(g, f, o)) : ''}`;
    }
    showResult() {
      if(this.opts.live)return;
      const g = this.game, r = g.result, box = this.q('.mb-result'); if (!r) return;
      const f = g.frames[this.n() - 1];
      const w = r.winner ? g.teams[r.winner].team : null;
      const rows = t => ROLES.map(role => { const id = t + '_' + role, hh = f.heroes.find(x => x.id === id); return `<tr class="${r.winner === t ? 'win' : ''}"><td><span class="mb-rc">${ROLE_SHORT[role]}</span>${esc(g.name(id))}</td><td title="KDA ${kdaRatio(hh.kills, hh.deaths, hh.assists || 0)}">${hh.kills}/${hh.deaths}/${hh.assists || 0}</td><td>${fmt(hh.gold)}</td></tr>`; }).join('');
      box.innerHTML = `<div class="mb-resbox"><div class="mb-resk">${w ? 'WINNER' : 'DRAW'}</div><h2>${w ? esc(w) + ' 获胜' : '平局'}</h2><p>${r.reason === 'base' ? '摧毁敌方基地' : r.reason === 'final-battle' ? '最终决战胜出' : esc(r.reason)} · 地图 ${f.mapTurn} 回合${f.battle ? ' · 决战 ' + f.battle.actions + ' 次行动' : ''}</p>
<div class="mb-restables"><table><caption class="tA">${esc(g.teams.A.team)}</caption><tr><th>选手</th><th title="A=助攻，公开事件推导">K/D/A</th><th>金</th></tr>${rows('A')}</table><table><caption class="tB">${esc(g.teams.B.team)}</caption><tr><th>选手</th><th title="A=助攻，公开事件推导">K/D/A</th><th>金</th></tr>${rows('B')}</table></div>
<p class="mb-resnote">结果来自已保存的正式对局记录；播放结束不会重算比赛或更新积分。助攻A为公开事件推导（role-impact-v1）。</p><div class="mb-resbtns"><button class="mb-b mb-rclose">关闭</button><button class="mb-b mb-rreplay">从头回放</button></div></div>`;
      box.hidden = false;
      box.querySelector('.mb-rclose').onclick = () => { box.hidden = true; };
      box.querySelector('.mb-rreplay').onclick = () => { box.hidden = true; this.seek(0); this.play(); };
    }
  }

  // ---------- module-level API ----------
  let matchIndex = null;
  MB.matchInfo = async function (id) {
    if (!matchIndex) matchIndex = MB.fetchJSON(new URL('data/matches.json', SCRIPT_BASE).href).then(d => new Map(d.matches.map(m => [m.id, m])));
    return (await matchIndex).get(id) || null;
  };
  MB.samples = async function () { return MB.fetchJSON(new URL('data/samples/index.json', SCRIPT_BASE).href); };
  MB.mount = function (el, opts) { if (typeof el === 'string') el = document.querySelector(el); if (!el) throw new Error('mount: 找不到容器'); return new Player(el, opts); };
  MB.Player = Player;
  MB.roster = root.MOBA_BROADCAST_ROSTER || MB.roster;

  // Standalone boot used by index.html: ?data= &match= &replayBase= &round= &speed= &crt= &reduced= &embed= &autoplay= &names=
  MB.boot = async function (el, extra) {
    const P = new URLSearchParams(root.location.search), cfg = Object.assign({}, root.MOBA_BROADCAST_CONFIG || {}, extra || {});
    const embed = P.get('embed') === '1' || cfg.embed;
    const player = MB.mount(el, { bridge: true, embed, crt: P.get('crt') || cfg.crt, reduced: P.has('reduced') ? P.get('reduced') === '1' : undefined, names: P.get('names') || cfg.names, speed: +(P.get('speed') || cfg.speed || 1) });
    const opt = { match: P.get('match') || undefined, round: P.has('round') ? +P.get('round') : undefined, autoplay: P.get('autoplay') === '1' };
    let samples = { samples: [] };
    try { samples = await MB.samples(); } catch (e) { /* sample index optional */ }
    const go = id => { const u = new URL(root.location.href); u.searchParams.delete('data'); u.searchParams.set('match', id); root.location.href = u.href; };
    player.opts.onPick = go;
    try {
      const data = P.get('data') || cfg.data, replayBase = P.get('replayBase') || cfg.replayBase;
      if (data) { player.setSamples(samples.samples, opt.match || ''); await player.loadUrl(data, opt); }
      else if (opt.match) {
        const s = samples.samples.find(x => x.id === opt.match);
        player.setSamples(samples.samples, opt.match);
        if (s) await player.loadUrl(new URL(s.file, MB.base).href, opt);
        else if (replayBase) await player.loadUrl(replayBase.replace(/\/?$/, '/') + encodeURIComponent(opt.match) + '.json.gz', opt);
        else {
          const m = await MB.matchInfo(opt.match).catch(() => null);
          if(m?.url){await player.loadUrl(m.url,opt);return player;}
          player.fail(new Error(m ? '对局 ' + opt.match + ' 存在于正式记录（' + m.labels.A + ' 对 ' + m.labels.B + '），但本页内置样例未包含其回放帧。主办方可传 ?data=<同源回放URL> 或 ?replayBase=<同源replays目录>。' : '未找到对局 ' + opt.match + '。'));
        }
      } else {
        const id = samples.default || (samples.samples[0] && samples.samples[0].id);
        player.setSamples(samples.samples, id);
        if (!id) throw new Error('没有找到内置样例 data/samples/index.json');
        await player.loadUrl(new URL(samples.samples.find(x => x.id === id).file, MB.base).href, { ...opt, match: id });
      }
    } catch (e) { /* status already shown */ }
    root.mobaPlayer = player;
    return player;
  };
})(typeof window !== 'undefined' ? window : globalThis);
