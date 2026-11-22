/* MobaBroadcast · narration
 * Turns recorded events (and, where a fact is not recorded, adjacent-frame differences) into
 * the "what happened this round" feed. Each item states its basis:
 *   record   = raw engine event / recorded order
 *   diff     = difference between two adjacent recorded frames
 *   inferred = combination of recorded facts (e.g. compact AOE cell from order + hits)
 *   rule     = public rule constant (unlock rounds etc.)
 */
(function (root) {
  'use strict';
  const MB = root.MobaBroadcast = root.MobaBroadcast || {};
  const { ROLE_CN, LANE_CN, ACTION_CN, ROLES, key } = MB.C;
  const BASIS_CN = { record: '记录', diff: '帧差', inferred: '推断', rule: '规则' };
  const REASON_CN = {
    'hero-target': '目标不在攻击范围', utility: '治疗/控制条件不满足', 'attack-cell': '攻击格不合法', move: '移动格不合法', action: '指令不合法',
    'attack-cooldown': '攻击冷却中', 'capture-same-cell': '需与营地同格', 'capture-target': '营地不可夺取', 'support-normal': '辅助不能夺取普通野怪',
    'support-attack': '辅助不能攻击英雄', duplicate: '重复指令按待命', 'push-position-or-lane': '不在本方推进位', 'teleport-friendly-living-tower': '传送目标须为己方存活塔',
    'teleport-unavailable': '传送不可用', 'dead-before-attack': '出手前已阵亡', 'target-died-before-attack': '目标已先阵亡', recovery: '整理回合只能待命或回城',
    engaged: '团战中不能执行', 'round-limit': '到达回合上限', 'team-wipe': '一方团灭', voluntary: '主动待命', 'aoe-cooldown': 'AOE冷却待命', controlled: '被控制',
    'final-target': '目标无效', 'final-action': '动作无效', 'final-duplicate': '重复指令', 'final-no-position': '决战不能指定坐标', 'final-aoe-all-targets': '中路AOE不能指定目标',
    'final-utility-target': '辅助目标无效', 'final-control-cooldown': '控制冷却中',
    'one-side': '只剩一方参团者存活', 'engage-both-teams-required': '开团区域需同时有双方英雄', 'engage-enemy-center-required': '开团中心需有敌方英雄', 'engage-center': '开团中心不合法', 'engage-unavailable': '开团不可用（未解锁/冷却/不是打野）',
    'utility-target': '治疗/控制目标无效', 'control-cooldown': '控制冷却中', 'no-position': '不能指定坐标', 'aoe-all-targets': '中路AOE不能指定目标', target: '目标无效',
  };
  Object.assign(REASON_CN, {spell:'法术目标或冷却不合法',reap:'收割目标或冷却不合法','spell-cooldown':'法术冷却中','reap-cooldown':'收割冷却中','spell-all-targets':'决战法术自动攻击全体敌人','reap-target':'收割目标无效'});
  const reasonCN = r => REASON_CN[r] || (r && String(r).replace(/^engage-/, '开团：')) || '未注明';
  const pt = p => (Array.isArray(p) ? '(' + p[0] + ',' + p[1] + ')' : '');

  function placeName(game, id) {
    if (!id) return '?';
    if (id === 'ancient_upper') return '远古·上';
    if (id === 'ancient_lower') return '远古·下';
    const t = game.teams[id[0]] ? game.teams[id[0]].team : id[0];
    let m = id.match(/^([AB])_base$/); if (m) return t + '基地';
    m = id.match(/^([AB])_(top|mid|bottom)_(inner|outer)$/); if (m) return t + '·' + LANE_CN[m[2]] + (m[3] === 'outer' ? '外塔' : '内塔');
    m = id.match(/^([AB])_camp_(\d+)$/); if (m) return t + '野区营地' + m[2];
    if (/^[AB]_(top|mid|adc|support|jungle)$/.test(id)) return game.name(id);
    return id;
  }
  function teamName(game, t) { return t && game.teams[t] ? game.teams[t].team : (t || '—'); }
  const isHero = id => !!id && /^[AB]_(top|mid|adc|support|jungle)$/.test(id);
  const fmt = n => (n == null ? '?' : Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  const awardSum = e => (e.awards ? e.awards.reduce((n, a) => n + a.amount, 0) : e.gold != null ? e.gold : null);

  function teamIncome(f, t) {
    const hs = f.heroes.filter(h => h.team === t);
    if (hs.length && hs[0].income) { const o = { lane: 0, normal: 0, ancient: 0, tower: 0, kill: 0 }; for (const h of hs) for (const k in o) o[k] += h.income[k] || 0; return o; }
    return (f.teams[t] && f.teams[t].income) || null;
  }
  const teamGold = (f, t) => f.heroes.filter(h => h.team === t).reduce((n, h) => n + (h.gold || 0), 0);
  MB.teamGold = teamGold; MB.teamIncome = teamIncome;

  function phaseInfo(game, k) {
    const f = game.frames[k], c = game.config;
    if (f.phase === 'final_pending') return { code: 'final_pending', label: '决战入场', detail: '地图阶段' + c.maxTurns + '回合结束，等待最终决战' };
    if (f.phase === 'final_battle') return { code: 'final', label: '最终决战', detail: f.battle ? '第' + f.battle.round + '轮 · 第' + f.battle.actions + '次行动' : '' };
    const m = f.mapTurn, tags = [];
    if (k === 0) return { code: 'start', label: '开局', detail: '第0回合 · 双方在泉水' };
    if (m <= c.laneLock) tags.push('分路期 ≤' + c.laneLock);
    else tags.push('自由期');
    if (m < c.engageUnlockRound) tags.push('开团' + c.engageUnlockRound + '回合解锁');
    if (m < c.teleportUnlockRound) tags.push('传送' + c.teleportUnlockRound + '回合解锁');
    if (f.engagements.length) tags.push(f.engagements.length + '场团战进行中');
    if (m >= c.maxTurns - 30) tags.push('距' + c.maxTurns + '回合 ' + (c.maxTurns - m));
    return { code: m <= c.laneLock ? 'lane' : 'open', label: m <= c.laneLock ? '分路期' : '自由期', detail: tags.join(' · ') };
  }

  function orderTarget(game, f, o) {
    switch (o.action) {
      case 'move': return '→' + pt(o.to);
      case 'push': return LANE_CN[o.lane] || o.lane || '';
      case 'capture': return placeName(game, o.target);
      case 'attack': return o.target ? game.name(o.target) : o.to ? '格' + pt(o.to) : '';
      case 'spell': return o.cells ? o.cells.map(pt).join(' + ') : '全体存活敌人';
      case 'reap': return game.name(o.target);
      case 'heal': case 'control': return game.name(o.target);
      case 'engage': return '中心' + pt(o.to);
      case 'teleport': { const b = f.buildings.find(b => key(b.p) === key(o.to || [99, 99])); return (b ? placeName(game, b.id) : '') + pt(o.to); }
      default: return '';
    }
  }

  function orderOutcome(f, o) {
    const ev = f.events, u = o.unit;
    const inv = ev.find(e => e.kind === 'invalid' && e.unit === u);
    if (inv) return { ok: false, text: '无效：' + reasonCN(inv.reason) };
    if (ev.some(e => e.kind === 'stun' && e.unit === u)) return { ok: false, text: '受控，未执行' };
    const can = ev.find(e => e.kind === 'engage_cancel' && e.unit === u);
    if (can) return { ok: false, text: '被团战取消（' + reasonCN(can.reason) + '）' };
    const ac = ev.find(e => e.kind === 'attack_cancelled' && e.unit === u);
    if (ac) return { ok: false, text: '攻击取消：' + reasonCN(ac.reason) };
    switch (o.action) {
      case 'recall': return ev.some(e => e.kind === 'recall' && e.unit === u) ? { ok: true, text: '成功' } : ev.some(e => e.kind === 'recall_fail' && e.unit === u) ? { ok: false, text: '失败' } : null;
      case 'teleport': return ev.some(e => e.kind === 'teleport' && e.unit === u) ? { ok: true, text: '落地' } : null;
      case 'engage': return ev.some(e => e.kind === 'engage_cast' && e.source === u) ? { ok: true, text: '开团成功' } : null;
      case 'spell': case 'reap':
      case 'attack': {
        const esc = ev.find(e => e.kind === 'move_escape' && e.source === u);
        if (esc && esc.success) return { ok: false, text: '目标闪避' };
        const d = ev.filter(e => (e.kind === 'hit' || e.kind === 'final_hit') && e.source === u && isHero(e.target)).reduce((n, e) => n + e.damage, 0);
        return d > 0 ? { ok: true, text: '伤害' + fmt(d) } : null;
      }
      case 'heal': { const h = ev.find(e => (e.kind === 'heal' || e.kind === 'final_heal') && e.source === u); return h ? { ok: true, text: '+' + fmt(h.amount) } : null; }
      case 'control': return ev.some(e => (e.kind === 'control' || e.kind === 'final_control') && e.source === u) ? { ok: true, text: '命中' } : null;
      case 'capture': return ev.some(e => e.kind === 'hit' && e.source === u && e.attackType === 'capture') ? { ok: true, text: '计数' } : null;
      case 'move': return ev.some(e => e.kind === 'move' && e.unit === u) ? { ok: true, text: '' } : null;
      default: return null;
    }
  }

  // Build the per-round feed. Returns {headline, items:[...]} with items sorted by weight within sections.
  function round(game, k) {
    const f = game.frames[k], prev = k > 0 ? game.frames[k - 1] : null, N = id => game.name(id), P = id => placeName(game, id), T = t => teamName(game, t);
    const items = [];
    const add = (cat, w, text, o) => items.push({ cat, w, text, basis: (o && o.basis) || 'record', units: (o && o.units) || [], cells: (o && o.cells) || [], team: (o && o.team) || null, sec: (o && o.sec) || 'key', k });
    const ev = f.events;
    const basisOf = e => e.basis || 'record';

    // phase & rule milestones
    if (k === 0) add('phase', 50, '开局：双方十名英雄位于各自泉水；A方 ' + T('A') + ' 在左下，B方 ' + T('B') + ' 在右上', { basis: 'record' });
    if (prev && f.phase === 'map') {
      const c = game.config, m = f.mapTurn;
      if (m === c.engageUnlockRound) add('phase', 40, '第' + m + '回合起打野可以开团', { basis: 'rule' });
      if (m === c.teleportUnlockRound) add('phase', 40, '第' + m + '回合起上路可以传送', { basis: 'rule' });
      if (m === c.laneLock + 1) add('phase', 40, '前' + c.laneLock + '回合分路限制结束', { basis: 'rule' });
    }

    // aggregate hits by source->target
    const hitAgg = new Map();
    for (const e of ev) {
      if (e.kind === 'hit' && ['hero','spell','reap'].includes(e.attackType)) {
        const kk = e.source + '>' + e.target; const a = hitAgg.get(kk) || { s: e.source, t: e.target, d: 0, n: 0, basis: basisOf(e) }; a.d += e.damage; a.n++; hitAgg.set(kk, a);
      }
    }
    const aoeBy = new Map(ev.filter(e => e.kind === 'aoe').map(e => [e.source, e]));
    const aoeDone = new Set();
    for (const a of hitAgg.values()) {
      const aoe = aoeBy.get(a.s);
      if (aoe) {
        if (aoeDone.has(a.s)) continue; aoeDone.add(a.s);
        const hs = [...hitAgg.values()].filter(x => x.s === a.s);
        add('damage', 30, N(a.s) + ' 中路AOE轰击' + pt(aoe.p) + '：' + hs.map(x => N(x.t) + ' -' + fmt(x.d)).join('、'), { units: [a.s, ...hs.map(x => x.t)], cells: [aoe.p], basis: aoe.basis === 'inferred' ? 'inferred' : 'record', sec: 'fight' });
      } else add('damage', 20 + Math.min(10, a.d / 100), N(a.s) + ' ' + (ev.some(e=>e.kind==='spell'&&e.source===a.s)?'法术命中':ev.some(e=>e.kind==='reap'&&e.source===a.s)?'收割命中':'攻击') + ' ' + N(a.t) + '，伤害 ' + fmt(a.d), { units: [a.s, a.t], basis: a.basis, sec: 'fight' });
    }
    for (const e of ev) {
      const b = basisOf(e);
      switch (e.kind) {
        case 'spell': add('damage',42,N(e.source)+' 施放法术：双格 '+(e.cells||[]).map(pt).join(' + '),{units:[e.source],cells:e.cells||[],basis:b,sec:'fight'});break;
        case 'reap': add('damage',43,N(e.source)+' 收割 '+N(e.target),{units:[e.source,e.target],basis:b,sec:'fight'});break;
        case 'reap_refresh': add('damage',58,N(e.unit)+' 收割冷却刷新（'+(e.reason==='kill'?'击杀':'助攻')+'）',{units:[e.unit,e.target],basis:b,sec:'fight'});break;
        case 'final_spell': add('final',55,N(e.source)+' 施放法术：全体存活敌人',{units:[e.source],basis:b});break;
        case 'final_reap': add('final',55,N(e.source)+' 收割 '+N(e.target),{units:[e.source,e.target],basis:b});break;
        case 'kill': {
          const as = (f.killCredits.find(c => c.eventIndex === ev.indexOf(e))?.assistants || []).map(N);
          add('kill', 90, N(e.killer) + ' 击杀 ' + N(e.target) + (awardSum(e) != null ? '（+' + fmt(awardSum(e)) + '金）' : '') + (as.length ? '，助攻 ' + as.join('、') : '') + (e.respawnAt ? '；第' + e.respawnAt + '回合复活' : ''), { units: [e.killer, e.target], team: e.team, basis: as.length ? 'inferred' : b }); break;
        }
        case 'death': add('kill', 80, N(e.target) + ' 阵亡（无英雄击杀者）' + (e.respawnAt ? '；第' + e.respawnAt + '回合复活' : ''), { units: [e.target], basis: b }); break;
        case 'tower': add('tower', 85, T(e.team) + ' 摧毁 ' + P(e.target) + (awardSum(e) != null ? '（全队+' + fmt(awardSum(e)) + '金）' : ''), { team: e.team, cells: [bp(f, e.target)], basis: b }); break;
        case 'push_damage': add('tower', 45 + e.damage, T(e.team) + ' 兵线推进打 ' + P(e.target) + ' -' + e.damage + (e.protected ? '（受保护，未生效）' : '') + (e.raw !== e.damage && !e.protected ? '（原始' + e.raw + '）' : ''), { team: e.team, units: e.sources || [], cells: [bp(f, e.target)], basis: b, sec: 'lane' }); break;
        case 'base_cap': add('tower', 50, P(e.target) + ' 受基地保护：本回合伤害 ' + e.raw + ' 封顶为 ' + e.applied, { cells: [bp(f, e.target)], basis: b, sec: 'lane' }); break;
        case 'protected': add('tower', 15, N(e.source) + ' 对 ' + P(e.target) + ' 的行动被保护挡下', { units: [e.source], basis: b, sec: 'lane' }); break;
        case 'push_contest': {
          const w = e.winner; add('lane', 12, LANE_CN[e.lane] + '兵线对抗：' + T('A') + ' ' + e.counts.A + '人(' + fmt(e.powers.A) + ') vs ' + T('B') + ' ' + e.counts.B + '人(' + fmt(e.powers.B) + ') → ' + (w ? T(w) + '占优' : '僵持'), { team: w, units: e.sources ? [...e.sources.A, ...e.sources.B] : [], basis: b, sec: 'lane' }); break;
        }
        case 'line_shift': add('lane', 25, T(e.team) + ' 把' + LANE_CN[e.lane] + '兵线向前推进一格', { team: e.team, basis: b, sec: 'lane', cells: (e.to || []).map(i => MB.C.PATHS[e.lane][i]).filter(Boolean) }); break;
        case 'mid_expand': add('lane', 25, '中路线区由一格扩为两格（' + T(e.team) + '推进）', { team: e.team, basis: b, sec: 'lane' }); break;
        case 'push_edge': add('lane', 10, T(e.team) + ' 的' + LANE_CN[e.lane] + '兵线已推到尽头', { team: e.team, basis: b, sec: 'lane' }); break;
        case 'push_follow': add('lane', 6, N(e.unit) + ' 随兵线前移 ' + pt(e.from) + '→' + pt(e.to), { units: [e.unit], cells: [e.to], basis: b, sec: 'lane' }); break;
        case 'push_retreat': add('lane', 8, N(e.unit) + ' 被兵线逼退 ' + pt(e.from) + '→' + pt(e.to), { units: [e.unit], cells: [e.to], basis: b, sec: 'lane' }); break;
        case 'heal': add('heal', 18, N(e.source) + ' 治疗 ' + N(e.target) + ' +' + fmt(e.amount), { units: [e.source, e.target], basis: b, sec: 'fight' }); break;
        case 'control': add('control', 55, N(e.source) + ' 控制 ' + N(e.target) + '：其下一回合不能行动', { units: [e.source, e.target], basis: b }); break;
        case 'stun': add('control', 14, N(e.unit) + ' 处于受控，本回合不能行动', { units: [e.unit], basis: b, sec: 'fight' }); break;
        case 'move_escape': add('damage', 28, N(e.source) + ' 追击 ' + N(e.target) + '：经济闪避概率 ' + Math.round(e.probability * 100) + '%，' + (e.success ? '闪避成功，攻击落空' : '闪避失败，攻击命中'), { units: [e.source, e.target], basis: b, sec: 'fight' }); break;
        case 'attack_cancelled': add('damage', 12, N(e.unit) + ' 的攻击取消：' + reasonCN(e.reason), { units: [e.unit], basis: b, sec: 'fight' }); break;
        case 'attack_order': if (e.order && e.order.length > 1) add('damage', 3, '攻击结算顺序（随机种子决定）：' + e.order.map(N).join(' → '), { units: e.order, basis: b, sec: 'fight' }); break;
        case 'recall': add('travel', 35, N(e.unit) + ' 回城成功：回到泉水并满血', { units: [e.unit], basis: b }); break;
        case 'recall_fail': add('travel', 30, N(e.unit) + ' 回城失败（引擎判定不满足安全条件）', { units: [e.unit], basis: b }); break;
        case 'teleport': add('travel', 60, N(e.unit) + ' 传送 ' + pt(e.from) + ' → ' + P(e.target) + pt(e.to) + '；冷却至第' + e.readyAt + '回合', { units: [e.unit], cells: [e.from, e.to], basis: b }); break;
        case 'fountain': add('travel', 5, N(e.unit) + ' 在泉水回满生命', { units: [e.unit], basis: b, sec: 'fight' }); break;
        case 'respawn': add('travel', 22, N(e.unit) + ' 已在泉水复活', { units: [e.unit], basis: 'diff' }); break;
        case 'camp': add('jungle', 26, T(e.team) + ' 拿下 ' + P(e.target) + (awardSum(e) != null ? '（+' + fmt(awardSum(e)) + '金）' : '') + (e.tied ? '（平手随机归属）' : ''), { team: e.team, units: (e.awards || []).map(a => a.id), cells: [cp(f, e.target)], basis: b }); break;
        case 'ancient': add('jungle', 88, T(e.team) + ' 夺下 ' + P(e.target) + (awardSum(e) != null ? '（全队+' + fmt(awardSum(e)) + '金）' : '') + (e.tied ? '（同计数平手，随机归属）' : ''), { team: e.team, units: (e.awards || []).map(a => a.id), cells: [cp(f, e.target)], basis: b }); break;
        case 'ancient_progress': add('jungle', 32, P(e.target) + ' 夺取计数 ' + T('A') + ' ' + e.counts.A + ' : ' + e.counts.B + ' ' + T('B') + (e.damage ? '，耐久 -' + e.damage : '，未达2计数不扣耐久'), { units: e.sources || [], cells: [cp(f, e.target)], basis: b }); break;
        case 'ancient_notice': add('jungle', 58, P(e.target) + ' 公告：第' + e.spawnAt + '回合刷新，耐久' + e.maxHP + '，奖金' + e.goldPool, { cells: [cp(f, e.target)], basis: b }); break;
        case 'ancient_spawn': add('jungle', 62, P(e.target) + ' 已刷新：耐久' + e.maxHP + '，奖金' + e.goldPool, { cells: [cp(f, e.target)], basis: b }); break;
        case 'engage_cast': add('engage', 75, N(e.source) + ' 在' + pt(e.center) + '开团！团战#' + e.engagement + '最迟第' + e.deadline + '回合结束', { units: [e.source], cells: [e.center], basis: b }); break;
        case 'engage_start': add('engage', 70, '团战#' + e.engagement + ' 开始：' + e.initialCount + '人参团（' + e.members.map(N).join('、') + '）', { units: e.members, cells: e.centers || [], basis: b }); break;
        case 'engage_join': add('engage', 30, N(e.unit) + ' 加入团战#' + e.engagement, { units: [e.unit], basis: b }); break;
        case 'engage_merge': add('engage', 40, '团战合并为#' + e.engagement + '，截止第' + e.deadline + '回合' + (e.simultaneous ? '（同回合双开）' : ''), { basis: b }); break;
        case 'engage_aoe': add('engage', 45, N(e.source) + ' 团内AOE波及 ' + e.targets.map(N).join('、'), { units: [e.source, ...e.targets], basis: b, sec: 'fight' }); break;
        case 'engage_hold': add('engage', 10, N(e.unit) + ' 因在团战#' + e.engagement + '中而原地顶住' + LANE_CN[e.lane] + '兵线', { units: [e.unit], basis: b, sec: 'lane' }); break;
        case 'engage_cancel': add('engage', 8, N(e.unit) + ' 的' + (ACTION_CN[e.action] || e.action) + '被取消：' + reasonCN(e.reason), { units: [e.unit], basis: b, sec: 'orders' }); break;
        case 'engage_end': add('engage', 68, '团战#' + e.engagement + ' 结束：' + (e.winner ? T(e.winner) + '胜' : '无胜者') + '（' + reasonCN(e.reason) + '），第' + e.recoveryTurn + '回合为整理回合', { team: e.winner, units: e.members || [], basis: b }); break;
        case 'invalid': add('invalid', 6, N(e.unit) + ' 指令无效：' + reasonCN(e.reason), { units: [e.unit], basis: b, sec: 'orders' }); break;
        case 'final_pending': add('phase', 95, '地图阶段第' + game.config.maxTurns + '回合结算完毕，没有基地被摧毁 → 进入最终决战', { basis: b }); break;
        case 'final_start': add('final', 94, '最终决战开始，固定出手顺序：' + e.order.map(N).join(' → '), { units: e.order, basis: b }); break;
        case 'final_action': add('final', 40, N(e.unit) + ' 行动（第' + e.round + '轮，个人第' + e.personalTurn + '次）', { units: [e.unit], basis: b }); break;
        case 'final_hit': add('final', 50, N(e.source) + ' → ' + N(e.target) + ' 伤害 ' + fmt(e.damage), { units: [e.source, e.target], basis: b }); break;
        case 'final_aoe': add('final', 52, N(e.source) + ' 释放中路AOE，攻击全部存活敌人', { units: [e.source], basis: b }); break;
        case 'final_kill': {
          const as = (f.killCredits.find(c => c.eventIndex === ev.indexOf(e))?.assistants || []).map(N);
          add('kill', 92, N(e.source) + ' 在决战中击杀 ' + N(e.target) + '（不复活）' + (as.length ? '，助攻 ' + as.join('、') : ''), { units: [e.source, e.target], basis: as.length ? 'inferred' : b }); break;
        }
        case 'final_heal': add('heal', 45, N(e.source) + ' 治疗 ' + N(e.target) + ' +' + fmt(e.amount), { units: [e.source, e.target], basis: b }); break;
        case 'final_control': add('control', 55, N(e.source) + ' 控制 ' + N(e.target) + '：跳过其下一次行动', { units: [e.source, e.target], basis: b }); break;
        case 'final_wait': add('final', 30, N(e.unit) + ' 待命（' + reasonCN(e.reason) + '）', { units: [e.unit], basis: b }); break;
        case 'support_attack': add('final', 20, N(e.source) + ' 己方只剩辅助，以治疗量 ' + fmt(e.power) + ' 进行攻击', { units: [e.source], basis: b }); break;
        case 'final_end': add('result', 100, T(e.winner) + ' 赢得最终决战', { team: e.winner, basis: b }); break;
        default: break;
      }
    }
    // income + economy diff
    const inc = { A: 0, B: 0 }, incN = { A: 0, B: 0 };
    let incomeRecorded = false;
    for (const e of ev) if (e.kind === 'income') { incomeRecorded = true; for (const a of e.awards) { inc[e.team] += a.amount; incN[e.team]++; } }
    if (!incomeRecorded && f.laneAwards) for (const h of f.heroes) { const a = f.laneAwards[h.id] || 0; if (a > 0) { inc[h.team] += a; incN[h.team]++; } }
    for (const t of ['A', 'B']) if (inc[t] > 0) add('econ', 9, T(t) + ' 线上收入 +' + fmt(inc[t]) + '（' + incN[t] + '份分路奖励）', { team: t, units: f.heroes.filter(h => h.team === t).map(h => h.id), basis: incomeRecorded ? 'record' : 'diff', sec: 'lane' });
    if (prev) {
      for (const t of ['A', 'B']) {
        const d = teamGold(f, t) - teamGold(prev, t);
        if (Math.abs(d) >= 0.05) {
          const ia = teamIncome(f, t), ib = teamIncome(prev, t), parts = [];
          const L = { lane: '分路', normal: '野怪', ancient: '远古', tower: '塔', kill: '击杀' };
          if (ia && ib) for (const x in L) { const v = (ia[x] || 0) - (ib[x] || 0); if (v >= 0.05) parts.push(L[x] + '+' + fmt(v)); }
          add('econ', 7, T(t) + ' 经济 +' + fmt(d) + '，合计 ' + fmt(teamGold(f, t)) + (parts.length ? '（' + parts.join(' ') + '）' : ''), { team: t, basis: 'diff', sec: 'lane' });
        }
      }
    }
    // moves summary
    const mv = { A: 0, B: 0 }; let mvBasis = 'record';
    for (const e of ev) if (e.kind === 'move') { mv[e.unit[0]]++; if (e.basis) mvBasis = e.basis; }
    for (const t of ['A', 'B']) if (mv[t]) add('move', 4, T(t) + ' ' + mv[t] + '名英雄移动一步', { team: t, units: ev.filter(e => e.kind === 'move' && e.unit[0] === t).map(e => e.unit), basis: mvBasis, sec: 'orders' });

    // orders (recorded)
    const orders = [];
    for (const t of ['A', 'B']) {
      const list = f.orders[t] || [];
      for (const role of ROLES) {
        const id = t + '_' + role, o = list.find(x => x.unit === id), h = f.heroes.find(x => x.id === id);
        if (!o) { if (f.phase === 'map' && k > 0 && h && prev && prev.heroes.find(x => x.id === id).alive) orders.push({ unit: id, action: 'none' }); continue; }
        orders.push(o);
      }
    }
    for (const o of orders) {
      if (o.action === 'none') { items.push({ cat: 'order', w: 1, text: N(o.unit) + ' · 未提交指令（按待命）', basis: 'record', units: [o.unit], cells: [], team: o.unit[0], sec: 'orders', k, order: o }); continue; }
      const out = orderOutcome(f, o);
      items.push({ cat: 'order', w: 2, text: N(o.unit) + ' · ' + (ACTION_CN[o.action] || o.action) + (orderTarget(game, f, o) ? ' ' + orderTarget(game, f, o) : ''), outcome: out, basis: 'record', units: [o.unit].concat(o.target && isHero(o.target) ? [o.target] : []), cells: o.to ? [o.to] : [], team: o.unit[0], sec: 'orders', k, order: o });
    }
    // result
    if (f.result && (k === game.frames.length - 1)) {
      const r = f.result; add('result', 100, r.winner ? T(r.winner) + ' 获胜（' + (r.reason === 'base' ? '摧毁敌方基地' : r.reason === 'final-battle' ? '最终决战胜出' : r.reason) + '）' : '平局', { team: r.winner, basis: 'record' });
    }
    items.sort((a, b) => b.w - a.w);
    const head = items.find(x => x.sec === 'key') || items.find(x => x.sec === 'fight') || items[0];
    return { headline: head ? head.text : '本回合无记录事件', headItem: head || null, items };
  }
  function bp(f, id) { const b = f.buildings.find(b => b.id === id); return b ? b.p : null; }
  function cp(f, id) { const c = f.camps.find(c => c.id === id); return c ? c.p : null; }

  // Whole-match key moments for the timeline + "全场要闻" list.
  function keyEvents(game) {
    const out = [], T = t => teamName(game, t), N = id => game.name(id), P = id => placeName(game, id);
    let firstBlood = true;
    game.frames.forEach((f, k) => {
      const add = (cat, w, text, o) => out.push({ k, cat, w, text, team: (o && o.team) || null, units: (o && o.units) || [], cells: (o && o.cells) || [], basis: (o && o.basis) || 'record', turn: f.phase === 'map' ? f.mapTurn : null });
      for (const e of f.events) {
        switch (e.kind) {
          case 'kill': add('kill', firstBlood ? 3 : 1, (firstBlood ? '一血！' : '') + N(e.killer) + ' 击杀 ' + N(e.target), { team: e.team, units: [e.killer, e.target] }); firstBlood = false; break;
          case 'final_kill': add('kill', 2, '决战：' + N(e.source) + ' 击杀 ' + N(e.target), { team: e.source[0], units: [e.source, e.target] }); break;
          case 'tower': add('tower', 3, T(e.team) + ' 摧毁 ' + P(e.target), { team: e.team, cells: [bp(f, e.target)] }); break;
          case 'ancient': add('jungle', 3, T(e.team) + ' 夺下 ' + P(e.target), { team: e.team, cells: [cp(f, e.target)] }); break;
          case 'ancient_spawn': add('jungle', 1, P(e.target) + ' 刷新（耐久' + e.maxHP + ' 奖金' + e.goldPool + '）', { cells: [cp(f, e.target)] }); break;
          case 'engage_cast': add('engage', 2, N(e.source) + ' 开团 #' + e.engagement, { team: e.source[0], units: [e.source], cells: [e.center] }); break;
          case 'engage_end': add('engage', 2, '团战#' + e.engagement + ' 结束：' + (e.winner ? T(e.winner) + '胜' : '无胜者'), { team: e.winner }); break;
          case 'teleport': add('travel', 1, N(e.unit) + ' 传送至 ' + P(e.target), { team: e.unit[0], units: [e.unit], cells: [e.to] }); break;
          case 'control': add('control', 1, N(e.source) + ' 控制 ' + N(e.target), { team: e.source[0], units: [e.source, e.target] }); break;
          case 'final_pending': add('phase', 3, '360回合结束 → 最终决战', {}); break;
          case 'final_start': add('final', 3, '最终决战开始', {}); break;
          case 'final_end': add('result', 4, T(e.winner) + ' 赢得最终决战', { team: e.winner }); break;
          default: break;
        }
      }
      if (f.result && k === game.frames.length - 1) add('result', 4, (f.result.winner ? T(f.result.winner) + ' 获胜' : '平局') + '（' + (f.result.reason === 'base' ? '摧毁基地' : '最终决战') + '）', { team: f.result.winner });
    });
    return out;
  }

  MB.story = { round, keyEvents, phaseInfo, placeName, teamName, orderTarget, orderOutcome, BASIS_CN, reasonCN };
})(typeof window !== 'undefined' ? window : globalThis);
