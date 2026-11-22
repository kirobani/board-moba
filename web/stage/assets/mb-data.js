/* MobaBroadcast · data layer
 * Normalizes official full replay records, slim sample records and compact display bundles
 * into one read-only game model. Nothing here simulates or re-scores a match.
 */
(function (root) {
  'use strict';
  const MB = root.MobaBroadcast = root.MobaBroadcast || {};

  // ---- public engine constants (hex-moba-contest, read from public/engine.cjs) ----
  const LANES = ['top', 'mid', 'bottom'];
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
  const HOME = { A: [-3, 3], B: [3, -3] };
  const FOUNTAIN = { A: [-4, 4], B: [4, -4] };
  const PATHS = {
    top: [[-3, 3], [-3, 2], [-3, 1], [-3, 0], [-2, -1], [-1, -2], [0, -3], [1, -3], [2, -3], [3, -3]],
    mid: [[-3, 3], [-2, 2], [-1, 1], [0, 0], [1, -1], [2, -2], [3, -3]],
    bottom: [[-3, 3], [-2, 3], [-1, 3], [0, 3], [1, 2], [2, 1], [3, 0], [3, -1], [3, -2], [3, -3]],
  };
  const CELLS = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 3) CELLS.push([q, r]);
  CELLS.push(FOUNTAIN.A.slice(), FOUNTAIN.B.slice());
  const key = p => p[0] + ',' + p[1];
  const dist = (a, b) => { const q = a[0] - b[0], r = a[1] - b[1]; return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); };
  const ROLE_CN = { top: '上路', jungle: '打野', mid: '中路', adc: '射手', support: '辅助' };
  const ROLE_SHORT = { top: '上', jungle: '野', mid: '中', adc: '射', support: '辅' };
  const LANE_CN = { top: '上路', mid: '中路', bottom: '下路' };
  const ACTION_CODES = ['wait', 'move', 'attack', 'heal', 'control', 'recall', 'capture', 'push', 'engage', 'teleport'];
  const ACTION_CN = { wait: '待命', move: '移动', attack: '攻击', spell: '法术', reap: '收割', heal: '治疗', control: '控制', recall: '回城', capture: '夺取', push: '推进', engage: '开团', teleport: '传送' };
  const DEFAULT_CONFIG = { maxTurns: 360, laneLock: 40, engageUnlockRound: 21, teleportUnlockRound: 31, engageCooldown: 10, teleportCooldown: 20 };

  MB.C = { LANES, ROLES, HOME, FOUNTAIN, PATHS, CELLS, ROLE_CN, ROLE_SHORT, LANE_CN, ACTION_CN, ACTION_CODES, key, dist };

  // ---- roster / display names ("队名.ID") ----
  function roster() { return MB.roster || root.MOBA_BROADCAST_ROSTER || { teams: {}, baselines: {}, roles: ROLE_CN }; }
  function participantFromPath(p) {
    if (typeof p !== 'string') return null;
    const s = p.replace(/\\/g, '/');
    let m = s.match(/\/frozen\/([^/]+)\/submission\//); if (m) return m[1];
    m = s.match(/\/policies\/([a-z_0-9]+)\.cjs$/); if (m) return 'baseline:' + m[1];
    return null;
  }
  // Returns {participant, team, players:{role:id}, baseline, policy}
  function teamInfo(label, override) {
    const R = roster();
    let info = null;
    if (label && R.teams[label]) info = { ...R.teams[label], players: { ...R.teams[label].players }, baseline: false };
    else if (label && R.baselines && R.baselines[label]) info = { ...R.baselines[label], players: {}, baseline: true };
    else if (label && /^baseline:/.test(label)) info = { participant: label, team: '基准队', policy: label.slice(9), players: {}, baseline: true };
    else info = { participant: label || null, team: label || '未知队伍', players: {}, baseline: false, unknown: true };
    if (override && typeof override === 'object') {
      if (override.participant && override.participant !== label) return teamInfo(override.participant, { ...override, participant: undefined });
      if (override.team) info.team = String(override.team);
      if (override.region) info.region = String(override.region);
      if (override.players) info.players = { ...info.players, ...override.players };
      if (override.policy) info.policy = override.policy;
      if (override.baseline) info.baseline = true;
    }
    return info;
  }
  function playerName(info, role) {
    if (!info) return ROLE_CN[role] || role;
    if (info.baseline) return info.team + '.' + (ROLE_CN[role] || role);
    const id = info.players && info.players[role];
    return info.team + '.' + (id || ROLE_CN[role] || role);
  }
  MB.teamInfo = teamInfo; MB.playerName = playerName; MB.participantFromPath = participantFromPath;

  // ---- fetching (same-origin only) ----
  function sameOriginURL(url) {
    const u = new URL(url, root.location.href);
    if (u.origin !== root.location.origin) throw new Error('只允许同源数据：' + u.origin + ' ≠ ' + root.location.origin);
    return u;
  }
  async function gunzip(buf) {
    if (typeof DecompressionStream === 'undefined') throw new Error('此浏览器不支持 DecompressionStream，无法解压 .gz 回放；请提供未压缩 JSON 或使用较新的浏览器。');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  async function bytesToJSON(buf) {
    let b = new Uint8Array(buf);
    if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await gunzip(buf));
    return JSON.parse(new TextDecoder('utf-8').decode(b));
  }
  async function fetchJSON(url, opts) {
    const u = sameOriginURL(url);
    const res = await fetch(u.href, { credentials: 'same-origin', signal: opts && opts.signal });
    if (!res.ok) throw new Error('加载失败 HTTP ' + res.status + '：' + u.pathname);
    return bytesToJSON(await res.arrayBuffer());
  }
  MB.fetchJSON = fetchJSON; MB.bytesToJSON = bytesToJSON; MB.sameOriginURL = sameOriginURL;

  // ---- normalization ----
  const clone = x => JSON.parse(JSON.stringify(x));
  MB.heroPower = function (hero, config, healing = hero.role === 'support') {
    const stat = healing || hero.role === 'support' ? hero.heal : hero.damage;
    if (Number.isFinite(stat)) return stat;
    if (Number.isFinite(hero.power) && hero.power > 0) return hero.power;
    const {initialGold = 0, growthPerGold = 0.005, growthCurve} = config || {};
    const earned = Math.max(0, (hero.gold ?? (hero.goldMicros || 0) / 1e6) - initialGold);
    const early = Math.min(earned, growthCurve?.threshold ?? earned);
    const factor = growthCurve ? 1 + early * growthCurve.attack[0] + (earned - early) * growthCurve.attack[1]
      : 1 + earned * growthPerGold;
    return Math.floor((hero.role === 'adc' ? 105 : 70) * factor + 1e-9);
  };
  function heroBase(id) { return { id, team: id[0], role: id.slice(2) }; }

  function normFullFrame(f, i) {
    return {
      index: i, turn: f.turn != null ? f.turn : i, mapTurn: f.mapTurn != null ? f.mapTurn : f.turn, phase: f.phase || 'map',
      heroes: f.heroes.map(h => ({
        id: h.id, team: h.team, role: h.role, p: h.p.slice(), hp: h.hp, maxHP: h.maxHP,
        damage:h.damage, heal:h.heal, gold: h.gold != null ? h.gold : (h.goldMicros || 0) / 1e6, alive: !!h.alive, respawnAt: h.respawnAt,
        stunUntil: h.stunUntil || 0, spellReady: h.spellReady, reapReady: h.reapReady, attackReady: h.attackReady, utilityReady: h.utilityReady, engageReady: h.engageReady,
        teleportReady: h.teleportReady, engageRecoveryUntil: h.engageRecoveryUntil || 0, engagementId: h.engagementId || null,
        kills: h.kills || 0, deaths: h.deaths || 0, income: h.income || null,
      })),
      buildings: f.buildings.map(b => ({ id: b.id, team: b.team, kind: b.kind, lane: b.lane, tier: b.tier, p: b.p.slice(), hp: b.hp, maxHP: b.maxHP })),
      camps: f.camps.map(c => ({ id: c.id, kind: c.kind, regionTeam: c.regionTeam, p: c.p.slice(), hp: c.hp, maxHP: c.maxHP, alive: c.alive !== false && c.hp > 0, spawnAt: c.spawnAt == null ? null : c.spawnAt, goldPool: c.goldPool == null ? null : c.goldPool, announcement: c.announcement || null, captures: c.captures || null })),
      lanes: clone(f.lanes), teams: clone(f.teams),
      engagements: (f.engagements || []).map(e => ({ id: e.id, cells: e.cells || [], centers: e.centers || [], members: e.members || [], initiators: e.initiators || [], deadline: e.deadline, openedAt: e.openedAt, initialCount: e.initialCount })),
      orders: { A: (f.orders && f.orders.A) || [], B: (f.orders && f.orders.B) || [] },
      events: (f.events || []).map(e => ({ ...e })),
      battle: f.battle ? clone(f.battle) : null,
      result: f.result || null,
      randomAttackOrder: f.config && f.config.randomAttackOrder !== undefined ? f.config.randomAttackOrder : undefined,
    };
  }

  function decodeCompactEvent(e, ids) {
    const I = n => (typeof n === 'number' && n >= 0 ? ids[n] : null), T = n => (n === 0 ? 'A' : 'B'), W = n => (n === -1 || n == null ? null : n === 0 ? 'A' : 'B'), L = n => LANES[n];
    const isHero = id => !!id && /^[AB]_(top|mid|adc|support|jungle)$/.test(id);
    switch (e[0]) {
      case 0: return { kind: 'hit', source: I(e[1]), target: I(e[2]), damage: e[3], attackType: isHero(I(e[2])) ? 'hero' : 'capture' };
      case 1: return { kind: 'kill', target: I(e[1]), team: T(e[2]), killer: I(e[3]), respawnAt: e[4], awards: null };
      case 2: return { kind: 'camp', target: I(e[1]), team: T(e[2]), gold: e[3] };
      case 3: return { kind: 'ancient', target: I(e[1]), team: T(e[2]), gold: e[3], tied: !!e[4] };
      case 4: return { kind: 'tower', target: I(e[1]), team: T(e[2]), gold: e[3] };
      case 5: return { kind: 'heal', source: I(e[1]), target: I(e[2]), amount: e[3] };
      case 6: return { kind: 'control', source: I(e[1]), target: I(e[2]), success: !!e[3] };
      case 7: return { kind: 'recall', unit: I(e[1]) };
      case 8: return { kind: 'recall_fail', unit: I(e[1]) };
      case 9: return { kind: 'ancient_progress', target: I(e[1]), counts: { A: e[2], B: e[3] }, damage: e[4] };
      case 10: return { kind: 'invalid', unit: I(e[1]), reason: e[2] };
      case 11: return { kind: 'protected', source: I(e[1]), target: I(e[2]) };
      case 12: return { kind: 'base_cap', target: I(e[1]), raw: e[2], applied: e[3] };
      case 13: return { kind: 'fountain', unit: I(e[1]) };
      case 14: return { kind: 'death', target: I(e[1]), respawnAt: e[2] };
      case 15: return { kind: 'push_contest', lane: L(e[1]), counts: { A: e[2], B: e[3] }, powers: { A: e[4], B: e[5] }, winner: W(e[6]) };
      case 16: return { kind: 'mid_expand', lane: L(e[1]), team: T(e[2]), from: e[3], to: e[4] };
      case 17: return { kind: 'line_shift', lane: L(e[1]), team: T(e[2]), from: e[3], to: e[4] };
      case 18: return { kind: 'push_follow', unit: I(e[1]), from: e[2], to: e[3] };
      case 19: return { kind: 'push_retreat', unit: I(e[1]), from: e[2], to: e[3] };
      case 20: return { kind: 'push_damage', target: I(e[1]), team: T(e[2]), damage: e[3], raw: e[4], lane: L(e[5]), protected: !!e[6] };
      case 21: return { kind: 'push_edge', lane: L(e[1]), team: T(e[2]) };
      case 22: return { kind: 'final_start', order: e.slice(1).map(I) };
      case 23: return { kind: 'final_action', unit: I(e[1]), round: e[2], personalTurn: e[3] };
      case 24: return { kind: 'final_hit', source: I(e[1]), target: I(e[2]), damage: e[3] };
      case 25: return { kind: 'final_kill', source: I(e[1]), target: I(e[2]) };
      case 26: return { kind: 'final_heal', source: I(e[1]), target: I(e[2]), amount: e[3] };
      case 27: return { kind: 'final_control', source: I(e[1]), target: I(e[2]) };
      case 28: return { kind: 'final_wait', unit: I(e[1]), reason: e[2] };
      case 29: return { kind: 'support_attack', source: I(e[1]), power: e[2] };
      case 30: return { kind: 'final_end', winner: T(e[1]) };
      case 31: return { kind: 'final_pending' };
      case 32: return { kind: 'final_aoe', source: I(e[1]) };
      case 40: return { kind: 'engage_start', engagement: e[1], initialCount: e[2], openedAt: e[3], deadline: e[4], members: e[5].map(I), initiators: e[6].map(I) };
      case 41: return { kind: 'engage_cast', source: I(e[1]), engagement: e[2], center: e[3], deadline: e[4] };
      case 42: return { kind: 'engage_join', unit: I(e[1]), engagement: e[2] };
      case 43: return { kind: 'engage_cancel', unit: I(e[1]), action: e[2], reason: e[3] };
      case 44: return { kind: 'engage_end', engagement: e[1], reason: e[2], winner: W(e[3]), recoveryTurn: e[4], cooldownReady: e[5], initiators: e[6].map(I) };
      case 45: return { kind: 'engage_merge', engagement: e[1], deadline: e[2], simultaneous: !!e[3] };
      case 46: return { kind: 'engage_hold', unit: I(e[1]), engagement: e[2], lane: L(e[3]) };
      case 47: return { kind: 'engage_aoe', source: I(e[1]), engagement: e[2], targets: e[3].map(I) };
      case 48: return { kind: 'teleport', unit: I(e[1]), target: I(e[2]), from: e[3], to: e[4], readyAt: e[5] };
      case 50: return { kind: 'ancient_notice', target: I(e[1]), spawnAt: e[2], noticeAt: e[3], maxHP: e[4], goldPool: e[5], cycle: e[6] };
      case 51: return { kind: 'ancient_spawn', target: I(e[1]), maxHP: e[2], goldPool: e[3], cycle: e[4] };
      case 52: return { kind: 'attack_order', order: e[1].map(I) };
      case 53: return { kind: 'attack_cancelled', unit: I(e[1]), reason: e[2], target: I(e[3]) };
      case 54: return { kind: 'move_escape', source: I(e[1]), target: I(e[2]), probability: e[3], success: !!e[4], from: e[5], to: e[6] };
      default: return { kind: 'unknown', code: e[0], raw: e };
    }
  }

  function normCompactFrame(f, i, g, ids) {
    const heroIds = g.heroIds, terrain = g.terrain;
    const blds = terrain.filter(t => t.kind === 'base' || t.kind === 'tower'), camps = terrain.filter(t => t.kind === 'normal' || t.kind === 'ancient');
    const heroes = heroIds.map((id, n) => {
      const h = f.h[n], s = (f.s && f.s[n]) || [0, 1, 1], kd = (f.kd && f.kd[n]) || [0, 0, 0], es = (f.es && f.es[n]) || [0, 0, 0, 0];
      return { ...heroBase(id), p: [h[0], h[1]], hp: h[2], maxHP: h[3], gold: h[4], power: h[5], alive: !!h[6], respawnAt: h[7] == null ? null : h[7],
        stunUntil: s[0], utilityReady: s[1], attackReady: s[2], kills: kd[0], deaths: kd[1],
        engageReady: es[0], engageRecoveryUntil: es[1], engagementId: es[2] || null, teleportReady: f.tp ? f.tp[n] : null, towerDamage: f.td ? f.td[n] : null, income: null };
    });
    const orders = { A: [], B: [] };
    (f.o || []).forEach((o, n) => {
      const id = heroIds[n]; if (!id) return;
      const action = ACTION_CODES[o[0]] || 'wait', x = { unit: id, action };
      if (action === 'push') x.lane = o[1];
      else if (typeof o[1] === 'number') x.target = ids[o[1]];
      else if (Array.isArray(o[1])) x.to = o[1];
      orders[id[0]].push(x);
    });
    const tm = (f.t || []).map(t => ({ kills: t[0], towers: t[1], ancients: t[2], gold: t[3], campCaptures: t[4], income: { lane: t[5], normal: t[6], ancient: t[7], tower: t[8], kill: t[9] } }));
    const bt = f.bt;
    const obj = arr => Object.fromEntries(heroIds.map((id, n) => [id, arr ? arr[n] : 0]));
    return {
      index: i, turn: i, mapTurn: f.m, phase: f.phase || 'map', heroes,
      buildings: blds.map((b, n) => ({ id: b.id, team: b.team, kind: b.kind, lane: b.lane, tier: b.tier, p: b.p.slice(), hp: f.b[n], maxHP: b.maxHP })),
      camps: camps.map((c, n) => { const x = f.c[n] || [0, 0, c.maxHP, null, null]; return { id: c.id, kind: c.kind, regionTeam: c.regionTeam || (c.team) || null, p: c.p.slice(), hp: x[0], maxHP: x[2], alive: x[0] > 0, spawnAt: x[1] || null, goldPool: x[3] == null ? null : x[3], announcement: x[4] || null, captures: null }; }),
      lanes: { top: { indices: f.u[0] }, mid: { indices: f.u[1] }, bottom: { indices: f.u[2] } },
      teams: { A: tm[0] || { kills: 0, towers: 0, ancients: 0 }, B: tm[1] || { kills: 0, towers: 0, ancients: 0 } },
      engagements: (f.eg || []).map(e => ({ id: e.id, cells: e.c || [], centers: e.p || [], initialCount: e.n, openedAt: e.start, deadline: e.end, members: (e.m || []).map(n => ids[n]), initiators: (e.j || []).map(n => ids[n]) })),
      orders,
      events: (f.e || []).map(e => decodeCompactEvent(e, ids)),
      laneAwards: f.l ? Object.fromEntries(heroIds.map((id, n) => [id, f.l[n] || 0])) : null,
      battle: bt ? { order: bt.order.map(n => ids[n]), actor: bt.actor >= 0 ? ids[bt.actor] : null, round: bt.round, actions: bt.actions, personalTurns: obj(bt.personal), aoeReady: obj(bt.aoe), controlReady: obj(bt.control), skip: obj(bt.skip) } : null,
      result: null,
    };
  }

  // Adds diff-derived facts that compact frames omit. Every synthetic event carries basis:'diff' or 'inferred'.
  function deriveEvents(frames, source, start = 1) {
    for (let i = Math.max(1,start); i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      const hasMove = new Set(b.events.filter(e => e.kind === 'move').map(e => e.unit));
      const warped = new Set(b.events.filter(e => ['teleport', 'recall', 'push_follow', 'push_retreat'].includes(e.kind)).map(e => e.unit));
      b.heroes.forEach((h, n) => {
        const o = a.heroes[n];
        if (!o) return;
        if (!o.alive && h.alive) b.events.push({ kind: 'respawn', unit: h.id, p: h.p.slice(), basis: 'diff' });
        else if (source === 'compact' && o.alive && h.alive && key(o.p) !== key(h.p) && !hasMove.has(h.id) && !warped.has(h.id) && b.phase === 'map')
          b.events.push({ kind: 'move', unit: h.id, from: o.p.slice(), to: h.p.slice(), basis: 'diff' });
      });
      if (source === 'compact') {
        // Mid AOE cell: compact drops the 'aoe' event; infer it from the mid's attack order with a cell target plus at least one hero hit.
        for (const t of ['A', 'B']) for (const o of b.orders[t]) {
          if (o.action === 'attack' && o.unit.endsWith('_mid') && Array.isArray(o.to) && b.events.some(e => e.kind === 'hit' && e.source === o.unit && e.attackType === 'hero'))
            b.events.push({ kind: 'aoe', source: o.unit, p: o.to.slice(), basis: 'inferred' });
        }
        // Stun: compact drops 'stun'; the stunUntil field is the recorded state.
        b.heroes.forEach((h, n) => { const o = a.heroes[n]; if (o && o.alive && o.stunUntil >= b.mapTurn && b.phase === 'map') b.events.push({ kind: 'stun', unit: h.id, basis: 'diff' }); });
      }
    }
  }

  // Cumulative derived assists per frame, same rule as the host's role-impact-v1 analyze() 'assistsDerived':
  // a kill credits each ally of the killer (killer excluded, once per kill) who, within the window
  // (3 frames on the map, 30 final-battle actions), dealt effective (overkill-capped) damage to the victim,
  // successfully controlled the victim, or healed the killer. Logs reset for the victim on each kill.
  // Result: frames[k].assists = {heroId: count up to and including frame k}; heroes[].assists mirrors it.
  const assistStates = new WeakMap();
  function deriveAssists(game, incremental = false) {
    const frames = game.frames, ids = game.heroIds, prior = incremental && assistStates.get(game), team = prior ? prior.team : {};
    for (const h of frames[0].heroes) team[h.id] = h.team;
    const isHero = u => Object.prototype.hasOwnProperty.call(team, u);
    const dmg = prior ? prior.dmg : {}, ctl = prior ? prior.ctl : {}, heal = prior ? prior.heal : {}, cum = prior ? prior.cum : {};
    if (!prior) for (const u of ids) { dmg[u] = {}; ctl[u] = {}; heal[u] = {}; cum[u] = 0; }
    const stamp = f => { f.assists = { ...cum }; for (const h of f.heroes) h.assists = cum[h.id]; };
    if (!prior) { frames[0].killCredits = []; stamp(frames[0]); }
    for (let index = prior ? prior.count : 1; index < frames.length; index++) {
      const frame = frames[index], prev = frames[index - 1], events = frame.events;
      frame.killCredits = [];
      const final = frame.phase === 'final_battle', window = final ? 30 : 3;
      const before = {}, now = {};
      for (const h of prev.heroes) before[h.id] = h;
      for (const h of frame.heroes) now[h.id] = h;
      const hp = {};
      for (const u of ids) hp[u] = +before[u].hp;
      if (events.some(e => e.kind === 'final_start')) for (const u of ids) hp[u] = +now[u].maxHP;
      else for (const u of ids) if (!before[u].alive && now[u].alive) hp[u] = +before[u].maxHP;
      const rao = frame.randomAttackOrder !== undefined ? frame.randomAttackOrder : true;
      const simultaneous = !rao && !final, grouped = {};
      if (simultaneous) for (const e of events) {
        if (e.kind === 'heal' && e.target in hp) hp[e.target] += +(e.amount || 0);
        if (e.kind === 'hit' && isHero(e.target)) grouped[e.target] = (grouped[e.target] || 0) + +(e.damage || 0);
      }
      for (const [eventIndex, e] of events.entries()) {
        const kind = e.kind, source = e.source || e.unit, target = e.target;
        if (e.basis) continue; // viewer-synthesized (diff/inferred) events are not engine events
        if ((kind === 'heal' || kind === 'final_heal') && isHero(source) && isHero(target)) {
          const amount = Math.max(0, +(e.amount || 0));
          if (!simultaneous) hp[target] = (hp[target] || 0) + amount;
          if (amount > 0 && source !== target) heal[target][source] = index;
        }
        if ((kind === 'hit' || kind === 'final_hit') && isHero(source) && isHero(target) && team[source] !== team[target]) {
          const raw = Math.max(0, +(e.damage || 0));
          let effective;
          if (kind === 'final_hit') effective = raw;
          else if (simultaneous) effective = raw * Math.min(1, Math.max(0, hp[target]) / Math.max(grouped[target] || 0, 1e-12));
          else { effective = Math.min(raw, Math.max(0, hp[target])); hp[target] = Math.max(0, hp[target] - effective); }
          if (effective > 0) dmg[target][source] = index;
        }
        if ((kind === 'control' || kind === 'final_control') && isHero(source) && isHero(target) && e.success !== false) ctl[target][source] = index;
        if ((kind === 'kill' || kind === 'final_kill') && isHero(target)) {
          const killer = e.killer || e.source;
          if (isHero(killer)) {
            const allied = team[killer], assist = new Set();
            for (const log of [dmg[target], ctl[target], heal[killer]]) for (const u in log) if (index - log[u] <= window && team[u] === allied && u !== killer) assist.add(u);
            for (const u of assist) cum[u]++;
            frame.killCredits.push({eventIndex, killer, target, assistants: [...assist].sort()});
          }
          dmg[target] = {}; ctl[target] = {}; heal[target] = {};
        }
      }
      stamp(frame);
    }
    assistStates.set(game,{team,dmg,ctl,heal,cum,count:frames.length});
  }
  // Current-frame economy: per-hero gold minus same-role opponent, and A total minus B total.
  function economy(frame) {
    const gold = {}, total = { A: 0, B: 0 };
    for (const h of frame.heroes) { gold[h.id] = h.gold || 0; total[h.team] += h.gold || 0; }
    const lane = {};
    for (const h of frame.heroes) { const opp = (h.team === 'A' ? 'B_' : 'A_') + h.role; lane[h.id] = { self: gold[h.id], opponent: gold[opp] || 0, opponentId: opp, diff: gold[h.id] - (gold[opp] || 0) }; }
    return { lane, total, diff: total.A - total.B };
  }
  MB.deriveAssists = deriveAssists; MB.economy = economy;
  MB.appendFullFrames = function(game, rawFrames, meta) {
    if (game.source !== 'full') throw Error('实时追加需要完整帧');
    const start=game.frames.length, added=rawFrames.map((f,i)=>normFullFrame(f,start+i));
    game.frames.push(...added);
    deriveAssists(game,true);deriveEvents(game.frames,game.source,start);
    for (const key of ['turns','mapTurns','battleActions']) if(meta[key]!=null)game[key]=meta[key];
    game.result=meta.result||game.frames.at(-1).result||null;
    if(game.result)game.frames.at(-1).result=game.result;
    return added;
  };

  function finish(game) {
    const f0 = game.frames[0];
    game.heroIds = f0.heroes.map(h => h.id);
    game.terrain = { buildings: f0.buildings.map(b => ({ ...b })), camps: f0.camps.map(c => ({ ...c })) };
    game.config = { ...DEFAULT_CONFIG, ...(game.config || {}) };
    if (!game.result) game.result = game.frames[game.frames.length - 1].result || null;
    const last = game.frames[game.frames.length - 1];
    if (!last.result && game.result) last.result = game.result;
    deriveAssists(game);
    deriveEvents(game.frames, game.source);
    game.teams = {
      A: teamInfo(game.labels.A, game.teamOverrides && game.teamOverrides.A),
      B: teamInfo(game.labels.B, game.teamOverrides && game.teamOverrides.B),
    };
    game.name = id => { if (!id) return '?'; const t = id[0], role = id.slice(2); return playerName(game.teams[t], role); };
    game.schema = 'moba-broadcast/1';
    return game;
  }

  function detect(input) {
    if (!input || typeof input !== 'object') return 'invalid';
    if (Array.isArray(input.games)) return 'compact-bundle';
    if (Array.isArray(input.frames) && input.frames.length) {
      const f = input.frames[0];
      if (f && Array.isArray(f.heroes)) return 'full';
      if (f && Array.isArray(f.h)) return 'compact-game';
    }
    if (Array.isArray(input) && input[0] && Array.isArray(input[0].heroes)) return 'frames';
    if (input.game) return 'wrapped';
    return 'invalid';
  }

  // normalize(input, {match, labels, teams}) -> game model
  function normalize(input, opts) {
    opts = opts || {};
    const kind = detect(input);
    if (kind === 'wrapped') return normalize(input.game, { ...opts, teams: opts.teams || input.teams, labels: opts.labels || input.labels, match: opts.match || input.match });
    if (kind === 'invalid') throw new Error('无法识别的对局数据：需要 frames[]（完整帧）或 compact games[]（显示帧）。');
    let game;
    const teamsOv = opts.teams || null;
    const labelFromTeams = s => teamsOv && teamsOv[s] && (teamsOv[s].participant || null);
    if (kind === 'compact-bundle') {
      const g = opts.match ? input.games.find(x => x.id === opts.match) : input.games[0];
      if (!g) throw new Error('compact 数据中没有对局 ' + opts.match + '；可选：' + input.games.map(x => x.id).join(', '));
      return normalize(g, opts);
    }
    if (kind === 'compact-game') {
      const ids = input.heroIds.concat(input.terrain.map(t => t.id));
      game = { id: input.id, seed: input.seed, source: 'compact', config: input.config, result: input.result, turns: input.turns, mapTurns: input.mapTurns,
        frames: input.frames.map((f, i) => normCompactFrame(f, i, input, ids)) };
      game.labels = { A: (opts.labels && opts.labels.A) || labelFromTeams('A') || (input.labels && input.labels.A), B: (opts.labels && opts.labels.B) || labelFromTeams('B') || (input.labels && input.labels.B) };
    } else {
      const rec = kind === 'frames' ? { frames: input } : input;
      game = { id: rec.id || opts.match || null, seed: rec.seed, source: 'full', config: rec.config || (rec.frames[0] && rec.frames[0].config), result: rec.result, turns: rec.turns, mapTurns: rec.mapTurns,
        frames: rec.frames.map(normFullFrame), provenance: rec.provenance || null };
      game.labels = {
        A: (opts.labels && opts.labels.A) || labelFromTeams('A') || (rec.labels && rec.labels.A) || participantFromPath(rec.A && rec.A.path),
        B: (opts.labels && opts.labels.B) || labelFromTeams('B') || (rec.labels && rec.labels.B) || participantFromPath(rec.B && rec.B.path),
      };
    }
    game.teamOverrides = teamsOv;
    if (!game.frames.length) throw new Error('对局没有任何帧');
    return finish(game);
  }
  MB.normalize = normalize; MB.detect = detect; MB.decodeCompactEvent = decodeCompactEvent;
})(typeof window !== 'undefined' ? window : globalThis);
