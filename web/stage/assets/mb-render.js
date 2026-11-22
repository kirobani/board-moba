/* MobaBroadcast · pixel renderer
 * Low-res pixel canvas (nearest-neighbour upscaled) + effect canvas (feeds the bloom layer)
 * + device-resolution text overlay so names/numbers stay sharp under the CRT layer.
 * Rendering is a pure function of (frame index k, round progress u); scrubbing never mutates game data.
 */
(function (root) {
  'use strict';
  const MB = root.MobaBroadcast;
  const { CELLS, PATHS, FOUNTAIN, HOME, LANES, ROLES, key, dist, ROLE_SHORT } = MB.C;
  const S = 26, SQ3 = Math.sqrt(3), W = 400, H = 344, OX = 200, OY = 172;
  const cellXY = p => [Math.round(OX + 1.5 * S * p[0]), Math.round(OY + SQ3 * S * (p[1] + p[0] / 2))];
  const CELL_IX = new Map(CELLS.map((p, i) => [key(p), i]));
  const LANE_KEYS = new Set(); for (const l of LANES) for (const p of PATHS[l]) LANE_KEYS.add(key(p));
  const ROLE_ORDER = { top: 0, jungle: 1, mid: 2, adc: 3, support: 4 };

  // ---------- palettes ----------
  const TEAM = {
    A: { b: '#3d8bff', d: '#1d4fa8', l: '#a8d4ff', glow: '#5fb0ff', text: '#8fc6ff', name: 'A' },
    B: { b: '#ff5a3c', d: '#a8281a', l: '#ffc0a8', glow: '#ff7a55', text: '#ffa08a', name: 'B' },
  };
  const COL = { move: '#e8f0ff', attack: '#ff4d4d', spell: '#e18aff', reap: '#ffb84d', capture: '#6dff7a', push: '#ffe066', heal: '#59f08a', control: '#c77dff', recall: '#7ff3ff', teleport: '#b48cff', engage: '#ffb627', wait: '#8890a6', gold: '#ffd447', kill: '#ffffff', invalid: '#9aa0b0', tower: '#ff9f43', dmg: '#ff6b6b', ancient: '#d98cff' };
  MB.COL = COL; MB.TEAM = TEAM;

  // ---------- sprite templates (pixel art) ----------
  const SPR = {
    top: [
      '....kkkk....',
      '...kggggk...',
      '...kgwwgk...',
      '..kkkgggkk..',
      '.kGgkbbbbk..',
      'kGggkbllbbk.',
      'kGgykbbbbbk.',
      'kGggkdbbbk..',
      '.kGgkbbbdk..',
      '..kkkdkkdk..',
      '....kd..dk..',
      '....kk..kk..'],
    jungle: [
      '.k........k.',
      'kEk......kEk',
      '.kEkkkkkkEk.',
      '..kbbbbbbk..',
      '.kbwkbbkwbk.',
      '.kbbbbbbbbk.',
      'kekbddddbkek',
      'keekbbbbkeek',
      '.kkkbbbbkkk.',
      '...kddkddk..',
      '...kdk.kdk..',
      '...kk...kk..'],
    mid: [
      '.....kk.....',
      '....kppk....',
      '...kpppk....',
      '..kppppk.kk.',
      '.kkkkkkkkyyk',
      '..kssssk.kyk',
      '..kskksk..k.',
      '.kbbbbbbk.k.',
      'kbbbllbbbkk.',
      'kbbbbbbbbk..',
      '.kddddddk...',
      '.kdk..kdk...'],
    adc: [
      '....kkk..k..',
      '...khhhk.krk',
      '...ksssk..kr',
      '...kskskk.kr',
      '..kbbbbbkwkr',
      '.kbblbbbbkwr',
      '.kbbbbbbk.wr',
      '..kbbbbk..kr',
      '..kdddk..kr.',
      '..kdkdk..k..',
      '..kk.kk.....',
      '............'],
    support: [
      '..kyyyyk....',
      '...kkkk..ky.',
      '..kwwwwk.kyk',
      '..kswswk..g.',
      '..kssssk..g.',
      '.kbwbbwbk.g.',
      'kbbwwwwbbkg.',
      'kbbbwwbbbkg.',
      '.kbbbbbbk.g.',
      '.kddddddk.g.',
      '..kdk.kdk...',
      '..kk..kk....'],
    tower: [
      '....kkkkkk....',
      '...kllbbllk...',
      '...kbbllbbk...',
      '....kbbbbk....',
      '...kkkkkkkk...',
      '..kkGkgkGkkk..',
      '..kgggggggGk..',
      '..kgGgggGggk..',
      '..kgggbbgggk..',
      '..kggbllbgGk..',
      '..kgggbbgggk..',
      '..kggggggGgk..',
      '.kkGGGGGGGGkk.',
      '.kGGGGGGGGGGk.',
      '.kkkkkkkkkkkk.'],
    rubble: [
      '..............',
      '....k.....k...',
      '...kGk...kgk..',
      '..kgGgk.kgGgk.',
      '.kgggGkkgggGk.',
      '.kkkkkkkkkkkk.'],
    base: [
      '........kkkk........',
      '.......kllllk.......',
      '......klbllblk......',
      '......kbbllbbk......',
      '.......kbbbbk.......',
      '..kk..kkkkkkkk..kk..',
      '..kgk.kgggggGk.kgk..',
      '.kkgkkkgGgGggkkkgkk.',
      '.kgggggggggggggggGk.',
      '.kgGgbbgggggggbbgGk.',
      '.kggbllbgkkkgbllbgk.',
      '.kgGgbbgkbbbkgbbgGk.',
      '.kggggggkbbbkggggGk.',
      '.kGGGGGGkbbbkGGGGGk.',
      '.kkkkkkkkkkkkkkkkkk.'],
    camp: [
      '...kkkk...',
      '..keeeek..',
      '.kewkewek.',
      '.keeeeeek.',
      'keeEEEEeek',
      'kEEEEEEEEk',
      '.kkkkkkkk.'],
    den: [
      '..........',
      '..........',
      '...kGGk...',
      '.kG....Gk.',
      '.kG....Gk.',
      '..kkGGkk..'],
    ancient: [
      '......kkkk......',
      '....kkppppkk....',
      '...kppwkkwppk...',
      '..kpppkyykpppk..',
      '..kppppppppppk..',
      '.kpPPppppppPPpk.',
      'kpPkkPPppPPkkPpk',
      'kpk..kPPPPk..kpk',
      '.k...kPyyPk...k.',
      '.....kPPPPk.....',
      '....kPk..kPk....',
      '....kk....kk....'],
    egg: [
      '...kkkk...',
      '..kpPppk..',
      '.kpPpppPk.',
      '.kppPpPpk.',
      '.kpPppPpk.',
      '..kkkkkk..'],
    minion: ['.kk.', 'kbbk', 'kllk', 'kddk', '.kk.'],
    skull: ['.kkkkk.', 'kwwwwwk', 'kwkwkwk', 'kwwwwwk', '.kwkwk.', '..kkk..'],
  };
  // 7x7 order icons
  const ICON = {
    move: ['...k...', '..kwk..', '.kwwwk.', 'kkwwwkk', '..kwk..', '..kwk..', '..kkk..'],
    spell: ['..w.w..','.wp.pw.','wp...pw','.p.w.p.','wp...pw','.wp.pw.','..w.w..'],
    reap: ['...ww..','..wyw..','.wyw...','wyw...w','.ww..w.','..www..','...w...'],
    attack: ['.....kk', '....kwk', 'k..kwk.', 'kkkwk..', '.kwk...', 'kkkk...', 'k.kk...'],
    capture: ['k.k.k..', 'kgkgkg.', 'kgkgkgk', '.kgkgkg', '..kgkgk', '...kgk.', '....k..'],
    push: ['k..k...', 'kk.kk..', 'kyk.kyk', '.kyk.kyk', 'kyk.kyk', 'kk.kk..', 'k..k...'],
    heal: ['..kkk..', '..kgk..', 'kkkgkkk', 'kgggggk', 'kkkgkkk', '..kgk..', '..kkk..'],
    control: ['.kkkkk.', 'kpk.kpk', 'kpk.kpk', 'kkkkkkk', 'kpppppk', 'kppkppk', 'kkkkkkk'],
    recall: ['...k...', '..kck..', '.kccck.', 'kccccck', '.kckck.', '.kckck.', '.kkkkk.'],
    teleport: ['...k...', '..kvk..', '.kvkvk.', 'kvk.kvk', '.kvkvk.', '..kvk..', '...k...'],
    engage: ['k..k..k', '.kyyyk.', '.kyoyk.', 'kyoooyk', '.kyoyk.', '.kyyyk.', 'k..k..k'],
    wait: ['kkkkk..', '...kk..', '..kk...', '.kk....', 'kkkkk..', '.......', '.......'],
  };
  const ICON_PAL = { k: '#0b0b12', w: '#ffffff', g: COL.capture, y: COL.push, p: COL.control, c: COL.recall, v: COL.teleport, o: '#fff3c4' };
  ICON.heal = ICON.heal.map(r => r.replace(/g/g, 'h'));
  ICON_PAL.h = COL.heal;

  function basePal(team) {
    const t = TEAM[team] || { b: '#c0c0c0', d: '#707070', l: '#ffffff' };
    return { k: '#0b0b12', b: t.b, d: t.d, l: t.l, s: '#f2c79a', h: '#3a2a20', w: '#f4f4f4', g: '#a8b0c0', G: '#5e6678', y: '#ffd447', r: '#a8672e', p: '#b46cff', P: '#7a3fc4', e: '#69d66f', E: '#2f8f3c', c: COL.recall, v: COL.teleport, o: '#fff3c4' };
  }
  const spriteCache = new Map();
  function sprite(name, team, variant) {
    const ck = name + '|' + (team || '') + '|' + (variant || '');
    let c = spriteCache.get(ck); if (c) return c;
    const rows = SPR[name] || ICON[name], w = Math.max(...rows.map(r => r.length)), h = rows.length;
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), pal = name in ICON && !(name in SPR) ? ICON_PAL : basePal(team);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x]; if (!ch || ch === '.') continue;
      let col = pal[ch] || pal.k;
      if (variant === 'grey') col = ch === 'k' ? '#0b0b12' : greyOf(col);
      if (variant === 'white') col = ch === 'k' ? '#0b0b12' : '#ffffff';
      g.fillStyle = col; g.fillRect(x, y, 1, 1);
    }
    spriteCache.set(ck, c); return c;
  }
  function greyOf(hex) { const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255, v = Math.round((r * .3 + g * .59 + b * .11) * .6 + 20); return 'rgb(' + v + ',' + v + ',' + (v + 8) + ')'; }

  // ---------- terrain rasterization ----------
  function cellType(p) {
    const k = key(p);
    if (k === key(FOUNTAIN.A)) return 'fA';
    if (k === key(FOUNTAIN.B)) return 'fB';
    if (LANE_KEYS.has(k)) return 'lane';
    const a = dist(p, HOME.A), b = dist(p, HOME.B);
    return a === b ? 'river' : a < b ? 'jA' : 'jB';
  }
  const TER = {
    lane: { c: ['#6f6b80', '#646074'], hi: '#8e8aa2', lo: '#3b3948' },
    jA: { c: ['#24563f', '#1f4c37'], hi: '#36775a', lo: '#12301f' },
    jB: { c: ['#44502a', '#3c4724'], hi: '#5d6d37', lo: '#232b13' },
    river: { c: ['#1f4373', '#1b3b66'], hi: '#3266a3', lo: '#0f2140' },
    fA: { c: ['#1f6fae', '#1b649d'], hi: '#6fd0ff', lo: '#0c3356' },
    fB: { c: ['#ae3a1f', '#9d321b'], hi: '#ff9a6f', lo: '#561a0c' },
  };
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function buildTerrain() {
    const cellMap = new Int16Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - OX, dy = y + 0.5 - OY;
      const qf = (2 / 3 * dx) / S, rf = (-1 / 3 * dx + SQ3 / 3 * dy) / S, sf = -qf - rf;
      let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
      const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
      if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
      const i = CELL_IX.get(q + ',' + r); if (i !== undefined) cellMap[y * W + x] = i;
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    const rnd = mulberry(20261026);
    const types = CELLS.map(cellType);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, c = cellMap[y * W + x];
      let col;
      if (c < 0) { col = rnd() < 0.006 ? [38, 44, 70] : ((x + y) & 1) ? [10, 12, 22] : [12, 14, 26]; }
      else {
        const t = TER[types[c]], up = y > 0 ? cellMap[(y - 1) * W + x] : -1, dn1 = y < H - 1 ? cellMap[(y + 1) * W + x] : -1, dn2 = y < H - 2 ? cellMap[(y + 2) * W + x] : -1, dn3 = y < H - 3 ? cellMap[(y + 3) * W + x] : -1;
        const lf = x > 0 ? cellMap[y * W + x - 1] : -1, rt = x < W - 1 ? cellMap[y * W + x + 1] : -1;
        if (dn1 !== c || lf !== c || rt !== c) col = [8, 9, 16];
        else if (dn2 !== c || dn3 !== c) col = rgb(t.lo);
        else if (up !== c) col = rgb(t.hi);
        else col = rgb(t.c[((x >> 1) + (y >> 1)) & 1 ? 0 : 1]);
      }
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // decorations, seeded per cell
    CELLS.forEach((p, i) => {
      const [cx, cy] = cellXY(p), t = types[i], R = mulberry(i * 7919 + 17), pix = (x, y, c) => { if (cellMap[(y | 0) * W + (x | 0)] === i && cellMap[((y | 0) + 3) * W + (x | 0)] === i) { g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); } };
      const spot = () => [cx + Math.round((R() - .5) * 34), cy + Math.round((R() - .5) * 28)];
      if (t === 'jA' || t === 'jB') {
        for (let n = 0; n < 4; n++) { const [x, y] = spot(); const leaf = t === 'jA' ? '#4f9e6e' : '#7f9445', dark = t === 'jA' ? '#2d6a49' : '#55642a'; pix(x, y - 2, leaf); pix(x - 1, y - 1, leaf); pix(x, y - 1, dark); pix(x + 1, y - 1, leaf); pix(x - 1, y, dark); pix(x, y, leaf); pix(x + 1, y, dark); pix(x, y + 1, '#5a3b22'); }
        for (let n = 0; n < 6; n++) { const [x, y] = spot(); pix(x, y, TER[t].hi); }
      } else if (t === 'lane') {
        for (let n = 0; n < 7; n++) { const [x, y] = spot(); pix(x, y, R() < .5 ? TER.lane.hi : TER.lane.lo); }
      } else if (t === 'river') {
        for (let n = 0; n < 4; n++) { const [x, y] = spot(); pix(x - 1, y, '#5a8fd0'); pix(x, y - 1, '#5a8fd0'); pix(x + 1, y, '#5a8fd0'); pix(x + 2, y - 1, '#5a8fd0'); }
      } else {
        for (let n = 0; n < 8; n++) { const [x, y] = spot(); pix(x, y, '#e8fbff'); }
      }
    });
    // per-cell masks for tints and border highlights
    const masks = CELLS.map(() => ({ fill: [], border: [] }));
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = cellMap[y * W + x]; if (c < 0) continue;
      const b = cellMap[y * W + x - 1] !== c || cellMap[y * W + x + 1] !== c || cellMap[(y - 1) * W + x] !== c || cellMap[(y + 1) * W + x] !== c;
      (b ? masks[c].border : masks[c].fill).push(x, y);
    }
    return { canvas: cv, cellMap, masks, types };
  }

  // ---------- pixel primitives ----------
  function pline(g, x0, y0, x1, y1, col, dash, phase) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; g.fillStyle = col;
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, n = phase || 0;
    for (let guard = 0; guard < 2000; guard++) {
      if (!dash || n % dash < dash / 2) g.fillRect(x0, y0, 1, 1);
      n++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function pring(g, cx, cy, r, col, step) {
    r = Math.max(1, Math.round(r)); g.fillStyle = col; let x = r, y = 0, e = 1 - r, n = 0; cx |= 0; cy |= 0;
    while (x >= y) {
      if (!step || (n++ % step) === 0) for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) g.fillRect(cx + a, cy + b, 1, 1);
      y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
    }
  }
  function pdisc(g, cx, cy, r, col) { g.fillStyle = col; for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); g.fillRect((cx - w) | 0, (cy + y) | 0, w * 2 + 1, 1); } }
  const ease = v => v < .5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- slot layout ----------
  const SOLO = [[], [[0, 2]], [[-7, 2], [7, 2]], [[-8, -3], [8, -3], [0, 9]], [[-8, -5], [8, -5], [-8, 9], [8, 9]], [[-11, -5], [0, -8], [11, -5], [-6, 9], [6, 9]]];
  const COLM = [[], [[0, 2]], [[0, -5], [0, 9]], [[-3, -9], [3, 1], [-3, 11]], [[-4, -10], [4, -3], [-4, 4], [4, 11]], [[-4, -12], [4, -6], [-4, 0], [4, 6], [-4, 12]]];
  function layout(frame) {
    const groups = new Map(), out = new Map();
    for (const h of frame.heroes) { if (!h.alive) continue; const k = key(h.p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
    for (const [k, hs] of groups) {
      const A = hs.filter(h => h.team === 'A').sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]), B = hs.filter(h => h.team === 'B').sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
      const place = (list, table, cx) => list.forEach((h, i) => { const s = table[Math.min(5, list.length)][Math.min(i, 4)]; out.set(h.id, [s[0] + cx, s[1]]); });
      if (!B.length) place(A, SOLO, 0); else if (!A.length) place(B, SOLO, 0); else { place(A, COLM, -10); place(B, COLM, 10); }
    }
    return out;
  }

  // ---------- round choreography (pure function of game + k) ----------
  // Returns {paths: Map(heroId -> segments), fx: [...], labels: [...], hidden: Map(heroId->{t, until})}
  function choreograph(game, k) {
    const f = game.frames[k], prev = k > 0 ? game.frames[k - 1] : f;
    const offP = layout(prev), offK = layout(f);
    const fx = [], labels = [], segs = new Map(), vis = new Map();
    const at = (p, id, which) => { const [x, y] = cellXY(p); const o = (which === 'p' ? offP.get(id) : offK.get(id)) || offK.get(id) || offP.get(id) || [0, 2]; return [x + o[0], y + o[1]]; };
    const heroK = id => f.heroes.find(h => h.id === id), heroP = id => prev.heroes.find(h => h.id === id);
    const isHero = id => !!id && /^[AB]_(top|mid|adc|support|jungle)$/.test(id);
    const final = f.phase !== 'map';
    // default: hero stays/lerps between prev and current slot
    for (const h of f.heroes) {
      const o = heroP(h.id);
      const seg = [];
      if (o && o.alive && h.alive) seg.push({ t0: 0.1, t1: 0.4, from: at(o.p, h.id, 'p'), to: at(h.p, h.id, 'k'), mode: 'walk' });
      segs.set(h.id, seg);
      vis.set(h.id, { from: o && o.alive ? 0 : 1.01, to: h.alive ? 1.01 : 1.01 });
      if (o && !o.alive && h.alive) vis.set(h.id, { from: 0.06, to: 1.01 });
      if (o && o.alive && !h.alive) vis.set(h.id, { from: 0, to: 0.66 });
      if (o && !o.alive && !h.alive) vis.set(h.id, { from: 2, to: 2 });
    }
    if (final) return { fx: arenaFx(game, k), labels: [], segs, vis, offK, offP, at, final: true };
    const ev = f.events;
    const setPath = (id, list) => segs.set(id, list);
    const cellPt = (p, id) => at(p, id, 'k');
    // movement-type events refine the default path
    const moves = new Map();
    for (const e of ev) if (['move', 'teleport', 'recall', 'push_follow', 'push_retreat'].includes(e.kind)) { if (!moves.has(e.unit)) moves.set(e.unit, []); moves.get(e.unit).push(e); }
    for (const [id, list] of moves) {
      const o = heroP(id), h = heroK(id); if (!o) continue;
      // a hero respawning this round starts from its fountain, not from where it died
      let cur = !o.alive && h && h.alive ? at(FOUNTAIN[id[0]], id, 'k') : at(o.p, id, 'p'); const seg = [];
      for (const e of list) {
        if (e.kind === 'move') { const to = cellPt(e.to, id); seg.push({ t0: 0.1, t1: 0.4, from: cur, to, mode: 'walk' }); fx.push({ type: 'trail', t0: 0.1, t1: 0.4, from: cur, to, team: id[0], hold: true, basis: e.basis }); cur = to; }
        else if (e.kind === 'teleport') { const to = cellPt(e.to, id); seg.push({ t0: 0.22, t1: 0.3, from: cur, to, mode: 'warp' }); fx.push({ type: 'teleport', t0: 0.08, t1: 0.42, from: cur, to, team: id[0], hold: true }); labels.push({ text: '传送', at: to, dy: -18, col: COL.teleport, t0: 0.3, hold: true, big: true }); cur = to; }
        else if (e.kind === 'push_follow' || e.kind === 'push_retreat') { const to = cellPt(e.to, id); seg.push({ t0: 0.8, t1: 0.95, from: cur, to, mode: 'walk' }); fx.push({ type: e.kind === 'push_follow' ? 'follow' : 'retreat', t0: 0.8, t1: 0.95, from: cur, to, team: id[0], hold: true }); cur = to; }
        else if (e.kind === 'recall') { const to = cellPt(h.p, id); seg.push({ t0: 0.8, t1: 0.86, from: cur, to, mode: 'warp' }); fx.push({ type: 'recall', t0: 0.72, t1: 0.92, from: cur, to, team: id[0], hold: true }); labels.push({ text: '回城', at: cur, dy: -18, col: COL.recall, t0: 0.74, hold: true, big: true }); cur = to; }
      }
      // remaining displacement (e.g. slot reshuffle) settles at the end
      if (h && h.alive) { const fin = at(h.p, id, 'k'); if (Math.abs(fin[0] - cur[0]) + Math.abs(fin[1] - cur[1]) > 0) seg.push({ t0: 0.9, t1: 1, from: cur, to: fin, mode: 'walk' }); }
      setPath(id, seg);
    }
    const pos = (id, u) => heroPos(segs.get(id), u) || (heroK(id) && heroK(id).alive ? at(heroK(id).p, id, 'k') : heroP(id) ? at(heroP(id).p, id, 'p') : [OX, OY]);
    // stagger attacks by recorded attack order
    const orderEv = ev.find(e => e.kind === 'attack_order');
    const atkOrder = orderEv ? orderEv.order : [];
    const atkT = id => { const i = atkOrder.indexOf(id), n = Math.max(1, atkOrder.length); return 0.46 + (i < 0 ? 0 : i) * Math.min(0.06, 0.22 / n); };
    const dmgAt = new Map();
    for (const e of ev) {
      switch (e.kind) {
        case 'respawn': { const p = at(FOUNTAIN[e.unit[0]], e.unit, 'k'); fx.push({ type: 'respawn', t0: 0.02, t1: 0.2, at: p, team: e.unit[0] }); labels.push({ text: '复活', at: p, dy: -16, col: '#fff3c4', t0: 0.05, hold: true }); break; }
        case 'engage_cast': { const c = cellXY(e.center); fx.push({ type: 'shock', t0: 0.04, t1: 0.3, at: c, team: e.source[0], hold: true }); labels.push({ text: '开团!', at: c, dy: -26, col: COL.engage, t0: 0.06, hold: true, big: true }); break; }
        case 'engage_join': { fx.push({ type: 'joinring', t0: 0.2, t1: 0.4, unit: e.unit, pos }); break; }
        case 'heal': { const a = pos(e.source, 0.44), b = pos(e.target, 0.44); fx.push({ type: 'heal', t0: 0.4, t1: 0.56, from: a, to: b, hold: true }); labels.push({ text: '+' + Math.round(e.amount), at: b, dy: -14, col: COL.heal, t0: 0.46, float: true, hold: true }); break; }
        case 'control': { const a = pos(e.source, 0.44), b = pos(e.target, 0.44); fx.push({ type: 'control', t0: 0.4, t1: 0.58, from: a, to: b, hold: true }); labels.push({ text: '控制', at: b, dy: -20, col: COL.control, t0: 0.48, hold: true, big: true }); break; }
        case 'stun': fx.push({ type: 'stun', t0: 0, t1: 1, unit: e.unit, pos, hold: true }); break;
        case 'spell': { const t=atkT(e.source);for(const cell of e.cells||[])fx.push({type:'spellCell',t0:t,t1:t+0.20,at:cellXY(cell),from:pos(e.source,t),hold:true});labels.push({text:'法术 · 双格',at:pos(e.source,t),dy:-25,col:COL.spell,t0:t,hold:true});break;}
        case 'reap': { const t=atkT(e.source);fx.push({type:'reap',t0:t,t1:t+0.17,from:pos(e.source,t),to:pos(e.target,t),hold:true});labels.push({text:'收割',at:pos(e.source,t),dy:-25,col:COL.reap,t0:t,hold:true});break;}
        case 'reap_refresh': {const at=pos(e.unit,0.72);fx.push({type:'refresh',at,t0:0.70,t1:0.94,hold:true});labels.push({text:'收割刷新',at,dy:-28,col:COL.reap,t0:0.72,hold:true});break;}
        case 'aoe': { const t = atkT(e.source), c = cellXY(e.p); fx.push({ type: 'aoe', t0: t, t1: t + 0.18, from: pos(e.source, t), at: c, hold: true }); labels.push({ text: 'AOE', at: c, dy: 16, col: '#ff9ff3', t0: t + 0.04, hold: true }); break; }
        case 'hit': {
          const t = atkT(e.source);
          if (['hero','spell','reap'].includes(e.attackType)) {
            const a = pos(e.source, t), b = pos(e.target, t), role = e.source.slice(2);
            if (e.attackType==='spell') fx.push({type:'bolt',t0:t,t1:t+0.12,from:a,to:b,hold:true});
            if (e.attackType==='hero' && (role !== 'mid' || !ev.some(x => x.kind === 'aoe' && x.source === e.source))) fx.push({ type: role === 'adc' ? 'arrow' : role === 'jungle' ? 'claw' : 'slash', t0: t, t1: t + 0.12, from: a, to: b, hold: true, team: e.source[0] });
            fx.push({ type: 'hitflash', t0: t + 0.1, t1: t + 0.18, unit: e.target, pos });
            const n = (dmgAt.get(e.target) || 0); dmgAt.set(e.target, n + 1);
            labels.push({ text: '-' + Math.round(e.damage), at: b, dy: -14 - n * 9, col: '#ffffff', stroke: '#b3122b', t0: t + 0.1, float: true, hold: true });
          } else {
            const camp = f.camps.find(c => c.id === e.target) || prev.camps.find(c => c.id === e.target);
            if (camp) { const c = cellXY(camp.p); fx.push({ type: 'capture', t0: t, t1: t + 0.14, from: pos(e.source, t), at: [c[0], c[1] - 4], hold: true, team: e.source[0] }); }
          }
          break;
        }
        case 'move_escape': { const t = atkT(e.source), b = cellXY(e.to); labels.push({ text: e.success ? '闪避!' : '闪避失败', at: [b[0], b[1]], dy: -24, col: e.success ? '#9ff7ff' : '#ffb0b0', t0: t, hold: true }); if (e.success) fx.push({ type: 'miss', t0: t, t1: t + 0.12, from: pos(e.source, t), to: cellXY(e.from), hold: true }); break; }
        case 'kill': { const p = heroP(e.target) ? at(heroP(e.target).p, e.target, 'p') : [OX, OY]; const pp = pos(e.target, 0.62); fx.push({ type: 'kill', t0: 0.64, t1: 0.86, at: pp || p, hold: true }); labels.push({ text: '击杀', at: pp || p, dy: -24, col: '#ffffff', stroke: '#000', t0: 0.66, hold: true, big: true }); const g = (e.awards || []).find(a => a.id === e.killer); labels.push({ text: '+' + Math.round(g ? g.amount : 0) + '金', at: pos(e.killer, 0.7), dy: -22, col: COL.gold, t0: 0.7, float: true, hold: !!g }); break; }
        case 'death': { const pp = pos(e.target, 0.62); fx.push({ type: 'kill', t0: 0.64, t1: 0.86, at: pp, hold: true }); break; }
        case 'camp': { const c = f.camps.find(x => x.id === e.target); if (c) { const p = cellXY(c.p); fx.push({ type: 'coins', t0: 0.64, t1: 0.82, at: p }); const g = e.awards ? e.awards.reduce((n, a) => n + a.amount, 0) : e.gold; labels.push({ text: '夺取 +' + Math.round(g || 0), at: p, dy: -12, col: COL.capture, t0: 0.66, hold: true }); } break; }
        case 'ancient': { const c = f.camps.find(x => x.id === e.target); if (c) { const p = cellXY(c.p); fx.push({ type: 'ancientTaken', t0: 0.62, t1: 0.9, at: p, team: e.team, hold: true }); labels.push({ text: '远古被夺!', at: p, dy: -24, col: COL.ancient, t0: 0.64, hold: true, big: true }); } break; }
        case 'ancient_progress': { const c = f.camps.find(x => x.id === e.target); if (c && e.damage) { const p = cellXY(c.p); labels.push({ text: '-' + e.damage + '耐久', at: p, dy: 16, col: COL.ancient, t0: 0.66, hold: true }); } break; }
        case 'ancient_spawn': case 'ancient_notice': { const c = f.camps.find(x => x.id === e.target); if (c) { const p = cellXY(c.p); fx.push({ type: 'rune', t0: 0, t1: 0.3, at: p }); labels.push({ text: e.kind === 'ancient_spawn' ? '远古刷新' : '远古预告', at: p, dy: -24, col: COL.ancient, t0: 0.04, hold: true }); } break; }
        case 'recall_fail': { const p = pos(e.unit, 0.75); fx.push({ type: 'recallFail', t0: 0.72, t1: 0.88, at: p, hold: true }); labels.push({ text: '回城失败', at: p, dy: -18, col: '#ff8a8a', t0: 0.76, hold: true }); break; }
        case 'push_contest': { const zone = laneZone(f, prev, e.lane, true); if (zone) fx.push({ type: 'clash', t0: 0.78, t1: 0.92, at: zone, winner: e.winner }); break; }
        case 'line_shift': case 'mid_expand': { const from = (e.from || []).map(i => PATHS[e.lane][i]).filter(Boolean), to = (e.to || []).map(i => PATHS[e.lane][i]).filter(Boolean); if (from.length && to.length) fx.push({ type: 'wave', t0: 0.8, t1: 0.96, from: cellXY(from[0]), to: cellXY(to[to.length - 1]), team: e.team, hold: true }); break; }
        case 'push_damage': { const b = f.buildings.find(x => x.id === e.target); if (b) { const p = cellXY(b.p); fx.push({ type: e.protected ? 'shield' : 'towerHit', t0: 0.84, t1: 0.98, at: [p[0], p[1] - 10], team: e.team, hold: e.protected }); labels.push({ text: e.protected ? '保护' : '-' + e.damage, at: p, dy: -26, col: e.protected ? '#c8d0ff' : COL.tower, stroke: '#3a1a00', t0: 0.86, float: !e.protected, hold: true }); } break; }
        case 'tower': { const b = f.buildings.find(x => x.id === e.target); if (b) { const p = cellXY(b.p); fx.push({ type: 'boom', t0: 0.86, t1: 1, at: [p[0], p[1] - 8], hold: true }); labels.push({ text: '摧毁!', at: p, dy: -30, col: COL.tower, stroke: '#000', t0: 0.88, hold: true, big: true }); } break; }
        case 'invalid': { labels.push({ text: '✕无效', at: pos(e.unit, 0.4), dy: 12, col: COL.invalid, t0: 0.35, hold: true, small: true }); break; }
        case 'engage_aoe': { const t = atkT(e.source); for (const tg of e.targets) fx.push({ type: 'bolt', t0: t, t1: t + 0.14, from: pos(e.source, t), to: pos(tg, t), hold: false }); labels.push({ text: '团战AOE', at: pos(e.source, t), dy: -24, col: '#fff3a0', t0: t, hold: true }); break; }
        case 'engage_end': { const c = (prev.engagements.find(x => x.id === e.engagement) || {}).centers; if (c && c[0]) labels.push({ text: '团战结束', at: cellXY(c[0]), dy: -26, col: COL.engage, t0: 0.9, hold: true, big: true }); break; }
        default: break;
      }
    }
    // order badges for "wait" and "push" (visual only, recorded orders)
    for (const t of ['A', 'B']) for (const o of f.orders[t] || []) {
      if (o.action === 'push') { const h = heroK(o.unit); if (h && h.alive) fx.push({ type: 'pushArrow', t0: 0.76, t1: 0.95, unit: o.unit, lane: o.lane, pos, team: t, hold: true }); }
    }
    return { fx, labels, segs, vis, offK, offP, at, pos };
  }
  function heroPos(seg, u) {
    if (!seg || !seg.length) return null;
    let p = seg[0].from;
    for (const s of seg) {
      if (u < s.t0) break;
      if (s.mode === 'warp') { p = u >= s.t1 ? s.to : s.from; if (u < s.t1) break; continue; }
      const v = ease(clamp01((u - s.t0) / Math.max(0.001, s.t1 - s.t0)));
      p = [lerp(s.from[0], s.to[0], v), lerp(s.from[1], s.to[1], v)];
      if (u < s.t1) break;
    }
    return p;
  }
  function laneZone(f, prev, lane, usePrev) {
    const idx = (usePrev ? prev : f).lanes[lane].indices; if (!idx || !idx.length) return null;
    const a = cellXY(PATHS[lane][idx[0]]), b = cellXY(PATHS[lane][idx[idx.length - 1]]);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  // ---------- final battle arena ----------
  const ARENA = { x0: 40, y0: 34, x1: 360, y1: 318 };
  function arenaXY(id) { const t = id[0], r = ROLE_ORDER[id.slice(2)]; return [t === 'A' ? 120 : 280, 92 + r * 45]; }
  function arenaFx(game, k) {
    const f = game.frames[k], fx = [], labels = [];
    for (const e of f.events) {
      switch (e.kind) {
        case 'final_hit': fx.push({ type: e.attackType==='spell' ? 'bolt' : e.attackType==='reap' ? 'reap' : e.source.endsWith('_adc') ? 'arrow' : 'slash', t0: 0.3, t1: 0.5, from: arenaXY(e.source), to: arenaXY(e.target), hold: true, team: e.source[0] }); fx.push({ type: 'alabel', text: '-' + Math.round(e.damage), at: arenaXY(e.target), dy: -20, col: '#ffffff', stroke: '#b3122b', t0: 0.45 }); break;
        case 'final_spell': fx.push({type:'sweep',t0:0.2,t1:0.5,from:arenaXY(e.source),team:e.source[0]});fx.push({type:'alabel',text:'法术 · 全体',at:arenaXY(e.source),dy:-26,col:COL.spell,t0:0.2});break;
        case 'final_reap': fx.push({type:'alabel',text:'收割',at:arenaXY(e.source),dy:-26,col:COL.reap,t0:0.2});break;
        case 'reap_refresh': fx.push({type:'refresh',at:arenaXY(e.unit),t0:0.55,t1:0.85,hold:true});fx.push({type:'alabel',text:'收割刷新',at:arenaXY(e.unit),dy:-30,col:COL.reap,t0:0.58});break;
        case 'final_aoe': fx.push({ type: 'sweep', t0: 0.2, t1: 0.5, from: arenaXY(e.source), team: e.source[0] }); fx.push({ type: 'alabel', text: 'AOE', at: arenaXY(e.source), dy: -26, col: '#ff9ff3', t0: 0.2 }); break;
        case 'final_heal': fx.push({ type: 'heal', t0: 0.3, t1: 0.5, from: arenaXY(e.source), to: arenaXY(e.target), hold: true }); fx.push({ type: 'alabel', text: '+' + Math.round(e.amount), at: arenaXY(e.target), dy: -20, col: COL.heal, t0: 0.45 }); break;
        case 'final_control': fx.push({ type: 'control', t0: 0.3, t1: 0.5, from: arenaXY(e.source), to: arenaXY(e.target), hold: true }); fx.push({ type: 'alabel', text: '控制', at: arenaXY(e.target), dy: -26, col: COL.control, t0: 0.45 }); break;
        case 'final_kill': fx.push({ type: 'kill', t0: 0.55, t1: 0.8, at: arenaXY(e.target), hold: true }); fx.push({ type: 'alabel', text: '击杀', at: arenaXY(e.target), dy: -30, col: '#ffffff', stroke: '#000', t0: 0.58, big: true }); break;
        case 'final_wait': fx.push({ type: 'alabel', text: '待命', at: arenaXY(e.unit), dy: -26, col: COL.wait, t0: 0.2 }); break;
        default: break;
      }
    }
    return fx;
  }

  // ---------- Renderer ----------
  class Renderer {
    constructor(host, opts) {
      this.host = host; this.opts = opts || {};
      host.classList.add('mb-stage');
      host.innerHTML = '<canvas class="mb-pix"></canvas><canvas class="mb-bloom" aria-hidden="true"></canvas><div class="mb-crt" aria-hidden="true"></div><canvas class="mb-text" aria-hidden="true"></canvas><div class="mb-tip" hidden></div>';
      [this.pix, this.bloom, this.crt, this.text, this.tip] = host.children;
      for (const c of [this.pix, this.bloom]) { c.width = W; c.height = H; }
      this.g = this.pix.getContext('2d'); this.bg = this.bloom.getContext('2d');
      this.fx = document.createElement('canvas'); this.fx.width = W; this.fx.height = H; this.fg = this.fx.getContext('2d');
      this.tg = this.text.getContext('2d');
      for (const g of [this.g, this.bg, this.fg]) g.imageSmoothingEnabled = false;
      this.terrain = buildTerrain();
      this.settings = { crt: 'soft', reduced: false, names: 'all', icons: true };
      this.hit = []; this.hover = null; this.choreoCache = new Map();
      this.resize();
      this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
      if (this._ro) this._ro.observe(host); else root.addEventListener('resize', () => this.resize());
      host.addEventListener('mousemove', e => this.onMove(e));
      host.addEventListener('mouseleave', () => { this.hover = null; this.tip.hidden = true; });
      host.addEventListener('click', e => { const h = this.pick(e); if (this.opts.onPick) this.opts.onPick(h ? h.id : null); });
    }
    destroy() { if (this._ro) this._ro.disconnect(); this.host.innerHTML = ''; }
    setGame(game) { this.game = game; this.choreoCache.clear(); }
    choreo(k) { let c = this.choreoCache.get(k); if (!c) { c = choreograph(this.game, k); this.choreoCache.set(k, c); if (this.choreoCache.size > 40) this.choreoCache.delete(this.choreoCache.keys().next().value); } return c; }
    resize() {
      const r = this.host.getBoundingClientRect(); if (!r.width) return;
      let k = Math.min(r.width / W, (r.height || r.width * H / W) / H);
      if (k >= 1) { const ik = Math.floor(k); if (k - ik < 0.35 || ik >= 3) k = ik; }
      k = Math.max(0.5, k);
      const cw = Math.round(W * k), ch = Math.round(H * k);
      this.scale = k; this.cssW = cw; this.cssH = ch;
      const left = Math.max(0, Math.round((r.width - cw) / 2)), top = Math.max(0, Math.round(((r.height || ch) - ch) / 2));
      for (const c of [this.pix, this.bloom, this.text, this.crt]) { c.style.width = cw + 'px'; c.style.height = ch + 'px'; c.style.left = left + 'px'; c.style.top = top + 'px'; }
      this.host.style.setProperty('--px', Math.max(2, Math.round(k)) + 'px');
      const dpr = root.devicePixelRatio || 1; this.dpr = dpr;
      this.text.width = Math.round(cw * dpr); this.text.height = Math.round(ch * dpr);
      this.dirty = true;
    }
    apply(settings) { Object.assign(this.settings, settings); this.host.dataset.crt = this.settings.crt; this.host.classList.toggle('mb-reduced', !!this.settings.reduced); this.dirty = true; }
    toCss(x, y) { return [x * this.scale, y * this.scale]; }
    onMove(e) {
      const h = this.pick(e); this.hover = h ? h.id : null;
      if (h && this.game && this.opts.tipFor) { this.tip.hidden = false; this.tip.innerHTML = this.opts.tipFor(h.id); const r = this.host.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; this.tip.style.left = Math.min(x + 14, r.width - 230) + 'px'; this.tip.style.top = Math.min(y + 12, r.height - 120) + 'px'; }
      else this.tip.hidden = true;
    }
    pick(e) {
      const r = this.pix.getBoundingClientRect(), x = (e.clientX - r.left) / this.scale, y = (e.clientY - r.top) / this.scale;
      let best = null, bd = 99;
      for (const h of this.hit) { const d = Math.max(Math.abs(h.x - x), Math.abs(h.y - 4 - y)); if (d < 9 && d < bd) { bd = d; best = h; } }
      return best;
    }

    // draw frame k at round progress u (0..1); t = wall clock ms for idle pulses
    draw(k, u, t, view) {
      const game = this.game; if (!game) return;
      const f = game.frames[k], prev = k > 0 ? game.frames[k - 1] : f, g = this.g, fg = this.fg, S_ = this.settings;
      const reduced = S_.reduced; if (reduced) u = 1;
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t / 650);
      const C = this.choreo(k);
      const sel = view || {};
      g.drawImage(this.terrain.canvas, 0, 0);
      fg.clearRect(0, 0, W, H);
      const final = f.phase !== 'map';
      const labels = [];
      // engagement zones
      const engs = u < 0.5 && prev.engagements.length && !f.engagements.length ? prev.engagements : f.engagements;
      for (const e of engs) {
        for (const c of e.cells) { const i = CELL_IX.get(key(c)); if (i === undefined) continue; this.tintCell(g, i, 'rgba(255,182,39,' + (0.10 + 0.08 * pulse) + ')', true); this.borderCell(fg, i, 'rgba(255,190,60,' + (0.55 + 0.35 * pulse) + ')'); }
        const c0 = e.centers && e.centers[0]; if (c0) { const [x, y] = cellXY(c0); labels.push({ text: '团战#' + e.id + ' · ' + (f.phase === 'map' ? Math.max(0, e.deadline - f.mapTurn) : 0) + '回合内', x, y: y + 30, col: COL.engage, small: true, box: true }); }
      }
      // selection highlight cells (from feed click)
      if (sel.cells) for (const c of sel.cells) { const i = c && CELL_IX.get(key(c)); if (i !== undefined) { this.tintCell(g, i, 'rgba(255,255,255,' + (0.10 + 0.1 * pulse) + ')', false); this.borderCell(fg, i, 'rgba(255,255,255,' + (0.6 + 0.4 * pulse) + ')'); } }
      // fronts (兵线)
      this.drawLanes(g, f, prev, u, labels);
      // buildings
      for (const b of f.buildings) {
        const pb = prev.buildings.find(x => x.id === b.id), hp = u < 0.86 && pb ? pb.hp : b.hp;
        const [x, y] = cellXY(b.p), dead = hp <= 0, team = b.team;
        if (b.kind === 'base') { const s = sprite('base', team); g.drawImage(s, x - 10, y - 20); }
        else { const s = sprite(dead ? 'rubble' : 'tower', team); g.drawImage(s, x - 7, dead ? y - 6 : y - 21); }
        if (!dead) { this.bar(g, x - 8, y - 23 - (b.kind === 'base' ? 0 : 1), 16, hp / b.maxHP, team === 'A' ? '#5fb0ff' : '#ff7a55'); labels.push({ text: String(Math.round(hp)), x: x + 11, y: y - 21, col: '#e8e8f0', tiny: true }); }
        if (!dead && !reduced) { fg.fillStyle = TEAM[team].glow; fg.fillRect(x - 1, y - (b.kind === 'base' ? 17 : 19), 2, 2); }
      }
      // camps & ancients
      for (const c of f.camps) {
        const pc = prev.camps.find(x => x.id === c.id) || c, cc = u < 0.66 ? pc : c, [x, y] = cellXY(c.p);
        if (c.kind === 'normal') {
          if (cc.hp > 0) { g.drawImage(sprite('camp', null), x - 5, y + 6); const rt = c.regionTeam; if (rt) { g.fillStyle = TEAM[rt].b; g.fillRect(x - 5, y + 13, 10, 1); } }
          else { g.drawImage(sprite('den', null), x - 5, y + 7); if (c.spawnAt && f.phase === 'map') labels.push({ text: String(Math.max(0, c.spawnAt - f.mapTurn)), x, y: y + 18, col: '#9aa7a0', tiny: true }); }
        } else {
          if (cc.hp > 0) {
            g.drawImage(sprite('ancient', null), x - 8, y - 10);
            for (let i = 0; i < cc.maxHP; i++) { g.fillStyle = i < cc.hp ? COL.ancient : '#3a2450'; g.fillRect(x - cc.maxHP * 2 + i * 4, y + 4, 3, 2); }
            labels.push({text: '耐久 ' + cc.hp + '/' + cc.maxHP, x, y: y - 18, col: '#fff0ff', box: true, objective: true});
            if (cc.goldPool) labels.push({ text: Math.round(cc.goldPool) + '金', x, y: y + 13, col: COL.gold, tiny: true });
            if (!reduced) pring(fg, x, y - 3, 13 + Math.round(pulse * 2), 'rgba(217,140,255,0.7)', 3);
          } else if (c.announcement && c.spawnAt && f.phase === 'map') {
            g.drawImage(sprite('egg', null), x - 5, y - 4);
            pring(fg, x, y - 2, 12, 'rgba(217,140,255,' + (0.35 + 0.3 * pulse) + ')', 2);
            labels.push({ text: (c.spawnAt - f.mapTurn) + '回合后 耐久' + c.maxHP, x, y: y + 12, col: COL.ancient, tiny: true, box: true });
          } else { pring(g, x, y - 2, 6, 'rgba(160,120,200,0.35)', 2); }
        }
      }
      // fountains glow
      for (const t of ['A', 'B']) { const [x, y] = cellXY(FOUNTAIN[t]); if (!reduced) pring(fg, x, y, 10 + Math.round(pulse * 3), TEAM[t].glow, 4); }

      // heroes
      this.hit = [];
      const heroes = final ? [] : f.heroes.slice().sort((a, b) => (C.offK.get(a.id) || [0, 0])[1] - (C.offK.get(b.id) || [0, 0])[1]);
      const drawn = [];
      for (const h of heroes) {
        const v = C.vis.get(h.id); if (!v || u < v.from || u > v.to) continue;
        let p = heroPos(C.segs.get(h.id), u);
        if (!p) { const src = h.alive ? h : prev.heroes.find(x => x.id === h.id); if (!src || (!src.alive && !h.alive)) continue; p = C.at(src.p, h.id, h.alive ? 'k' : 'p'); }
        const x = Math.round(p[0]), y = Math.round(p[1]);
        const ph = prev.heroes.find(x => x.id === h.id), hp = u < 0.6 && ph ? ph.hp : h.hp, maxHP = u < 0.6 && ph ? ph.maxHP : h.maxHP;
        const flash = !reduced && C.fx.some(e => e.type === 'hitflash' && e.unit === h.id && u >= e.t0 && u <= e.t1);
        const dim = sel.focus && !sel.focus.has(h.id);
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x - 4, y + 2, 9, 2);
        g.globalAlpha = dim ? 0.45 : 1;
        g.drawImage(sprite(h.role, h.team, flash ? 'white' : (h.alive ? '' : 'grey')), x - 6, y - 10);
        g.globalAlpha = 1;
        this.bar(g, x - 5, y + 3, 10, maxHP ? hp / maxHP : 0, null);
        // team marker under feet
        g.fillStyle = TEAM[h.team].b; g.fillRect(x - 6, y + 6, 2, 1); g.fillRect(x + 5, y + 6, 2, 1);
        if (sel.hero === h.id || this.hover === h.id) this.brackets(fg, x, y - 4, 9, sel.hero === h.id ? '#ffffff' : 'rgba(255,255,255,0.6)', pulse);
        if (h.alive && h.stunUntil >= (f.mapTurn + 1) && f.phase === 'map') this.stars(fg, x, y - 13, t, reduced);
        this.hit.push({ id: h.id, x, y });
        drawn.push({ h, x, y, dim });
      }
      // order icons
      if (S_.icons && !final) for (const d of drawn) {
        const o = (f.orders[d.h.team] || []).find(o => o.unit === d.h.id);
        if (!o || !ICON[o.action]) continue;
        const inval = f.events.some(e => (e.kind === 'invalid' || e.kind === 'engage_cancel' || e.kind === 'recall_fail' || e.kind === 'stun') && e.unit === d.h.id);
        g.globalAlpha = d.dim ? 0.4 : 1;
        g.drawImage(sprite(o.action, null), d.x - 3, d.y - 19);
        if (inval) { g.fillStyle = '#ff4d4d'; for (let i = 0; i < 7; i++) { g.fillRect(d.x - 3 + i, d.y - 19 + i, 1, 1); g.fillRect(d.x + 3 - i, d.y - 19 + i, 1, 1); } }
        g.globalAlpha = 1;
      }
      // effects
      const fxList = C.fx;
      for (const e of fxList) {
        if (reduced) { if (e.hold) this.fxHold(fg, e, t); continue; }
        if (u < e.t0) continue;
        if (u <= e.t1) this.fxDraw(fg, e, clamp01((u - e.t0) / Math.max(0.001, e.t1 - e.t0)), u, t);
        else if (e.hold) this.fxHold(fg, e, t);
      }
      if (final) this.drawArena(g, fg, f, k, u, t, labels, sel);
      g.drawImage(this.fx, 0, 0);
      // bloom from effect layer only
      const bctx = this.bg; bctx.clearRect(0, 0, W, H); if (S_.crt !== 'off') bctx.drawImage(this.fx, 0, 0);
      // text overlay
      this.drawText(f, prev, C, drawn, labels, u, sel, final);
    }
    tintCell(g, i, col, checker) { const m = this.terrain.masks[i].fill; g.fillStyle = col; for (let n = 0; n < m.length; n += 2) { if (checker && ((m[n] + m[n + 1]) & 1)) continue; g.fillRect(m[n], m[n + 1], 1, 1); } }
    borderCell(g, i, col) { const m = this.terrain.masks[i].border; g.fillStyle = col; for (let n = 0; n < m.length; n += 2) g.fillRect(m[n], m[n + 1], 1, 1); }
    bar(g, x, y, w, ratio, col) {
      ratio = clamp01(ratio || 0); g.fillStyle = '#05050a'; g.fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle = '#2a2a36'; g.fillRect(x, y, w, 2);
      g.fillStyle = col || (ratio > 0.6 ? '#4ee36a' : ratio > 0.3 ? '#ffd447' : '#ff4d4d'); g.fillRect(x, y, Math.max(ratio > 0 ? 1 : 0, Math.round(w * ratio)), 2);
    }
    brackets(g, x, y, r, col, pulse) { const d = r + Math.round(pulse); g.fillStyle = col; for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.fillRect(x + sx * d - (sx > 0 ? 2 : 0), y + sy * d, 3, 1); g.fillRect(x + sx * d, y + sy * d - (sy > 0 ? 2 : 0), 1, 3); } }
    stars(g, x, y, t, reduced) { const a = reduced ? 0 : t / 300; for (let i = 0; i < 3; i++) { const ang = a + i * 2.09, sx = Math.round(x + Math.cos(ang) * 6), sy = Math.round(y + Math.sin(ang) * 2); g.fillStyle = '#ffe14d'; g.fillRect(sx, sy, 1, 1); g.fillRect(sx - 1, sy, 3, 1); g.fillRect(sx, sy - 1, 1, 3); } }
    drawLanes(g, f, prev, u, labels) {
      for (const lane of LANES) {
        const idx = (u < 0.88 ? prev : f).lanes[lane].indices; if (!idx || !idx.length) continue;
        const aCell = PATHS[lane][idx[0]], bCell = PATHS[lane][idx[idx.length - 1]];
        const [ax, ay] = cellXY(aCell), [bx, by] = cellXY(bCell);
        const ia = CELL_IX.get(key(aCell)), ib = CELL_IX.get(key(bCell));
        if (ia !== undefined) this.tintCell(g, ia, 'rgba(61,139,255,0.18)', true);
        if (ib !== undefined) this.tintCell(g, ib, 'rgba(255,90,60,0.18)', true);
        const same = idx.length === 1;
        const dir = same ? [1, 0] : norm([bx - ax, by - ay]);
        const put = (x, y, team, n) => { for (let i = 0; i < n; i++) g.drawImage(sprite('minion', team), Math.round(x - 2 + (i - 1) * 5 * -dir[1] * 0 + (i - 1) * 4), Math.round(y + 10 + (i % 2) * 2)); };
        if (same) { put(ax - 7, ay, 'A', 2); put(ax + 7, ay, 'B', 2); }
        else { put(ax + dir[0] * 8, ay + dir[1] * 8, 'A', 3); put(bx - dir[0] * 8, by - dir[1] * 8, 'B', 3); }
      }
      function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
    }
    fxDraw(g, e, v, u, t) {
      const team = e.team ? TEAM[e.team] : null;
      switch (e.type) {
        case 'trail': { const n = Math.round(v * 20); pline(g, e.from[0], e.from[1] + 2, lerp(e.from[0], e.to[0], ease(v)), lerp(e.from[1], e.to[1], ease(v)) + 2, team ? team.l : '#fff', 4, n); break; }
        case 'teleport': {
          const r1 = Math.round(10 * (1 - clamp01(v / 0.45))); if (r1 > 0) { pring(g, e.from[0], e.from[1] - 4, r1, COL.teleport); pring(g, e.from[0], e.from[1] - 4, Math.max(1, r1 - 3), '#efe0ff', 2); }
          const m = clamp01((v - 0.15) / 0.5); if (m > 0 && m < 1) { const steps = 14; for (let i = 0; i <= steps * m; i++) { const s = i / steps, x = lerp(e.from[0], e.to[0], s), y = lerp(e.from[1], e.to[1], s) - Math.sin(s * Math.PI) * 30 - 4; g.fillStyle = i % 2 ? COL.teleport : '#efe0ff'; g.fillRect(Math.round(x), Math.round(y), 2, 2); } }
          const r2 = Math.round(12 * clamp01((v - 0.45) / 0.4)); if (r2 > 0) { pring(g, e.to[0], e.to[1] - 4, r2, COL.teleport); pring(g, e.to[0], e.to[1] - 4, Math.max(1, r2 - 4), '#efe0ff', 2); }
          break;
        }
        case 'recall': {
          const a = v < 0.5 ? e.from : e.to, h = Math.round(30 * (v < 0.5 ? v * 2 : (1 - v) * 2));
          g.fillStyle = COL.recall; g.fillRect(a[0] - 3, a[1] - h, 6, h); g.fillStyle = '#ffffff'; g.fillRect(a[0] - 1, a[1] - h, 2, h);
          for (let i = 0; i < 4; i++) { g.fillStyle = COL.recall; g.fillRect(a[0] - 6 + i * 4, a[1] - ((t / 20 + i * 7) % 26), 1, 2); }
          break;
        }
        case 'recallFail': { const h = Math.round(18 * (1 - v)); g.fillStyle = COL.recall; g.fillRect(e.at[0] - 2, e.at[1] - h, 4, h); this.cross(g, e.at[0], e.at[1] - 8, '#ff4d4d', 4); break; }
        case 'respawn': { pring(g, e.at[0], e.at[1] - 4, Math.round(3 + v * 10), '#fff3c4', 2); g.fillStyle = '#fff3c4'; g.fillRect(e.at[0], e.at[1] - 16 + Math.round(v * 6), 1, 4); break; }
        case 'shock': { for (let i = 0; i < 3; i++) { const r = Math.round(v * 52) - i * 9; if (r > 1) pring(g, e.at[0], e.at[1], r, i === 0 ? COL.engage : i === 1 ? '#fff3c4' : '#ff7a2f', i ? 2 : 0); } pdisc(g, e.at[0], e.at[1], Math.max(0, Math.round(6 * (1 - v))), '#fff3c4'); break; }
        case 'joinring': { const p = e.pos(e.unit, u); pring(g, p[0], p[1] - 4, Math.round(4 + v * 6), COL.engage, 2); break; }
        case 'heal': { const n = 6; for (let i = 0; i < n; i++) { const s = clamp01(v * 1.4 - i * 0.08); const x = lerp(e.from[0], e.to[0], s), y = lerp(e.from[1], e.to[1], s) - 6 - Math.sin(s * Math.PI) * 6; this.plus(g, Math.round(x), Math.round(y), COL.heal); } this.plus(g, e.to[0], e.to[1] - 12 - Math.round(v * 6), '#c9ffd9'); break; }
        case 'control': { const s = clamp01(v * 1.6), x = lerp(e.from[0], e.to[0], s), y = lerp(e.from[1], e.to[1], s); for (let i = 0; i <= 10 * s; i++) { const q = i / 10; const cx = lerp(e.from[0], e.to[0], q), cy = lerp(e.from[1], e.to[1], q) - 4; g.fillStyle = i % 2 ? COL.control : '#ecd6ff'; g.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2); } if (s >= 1) { pring(g, e.to[0], e.to[1] - 4, 8, COL.control); g.drawImage(sprite('control', null), e.to[0] - 3, e.to[1] - 22); } void x; void y; break; }
        case 'stun': { const p = e.pos(e.unit, u); this.stars(g, p[0], p[1] - 13, t, false); break; }
        case 'spellCell': { const x=e.at[0],y=e.at[1],r=S-3;g.fillStyle='rgba(201,80,255,0.18)';g.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3;const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;i?g.lineTo(px,py):g.moveTo(px,py);}g.closePath();g.fill();g.strokeStyle=COL.spell;g.lineWidth=2;g.stroke();pring(g,x,y,Math.round(4+v*17),'#ffd1ff',2);pline(g,e.from[0],e.from[1]-6,x,y,COL.spell,3);break;}
        case 'reap': {const x=lerp(e.from[0],e.to[0],Math.min(1,v*1.5)),y=lerp(e.from[1],e.to[1],Math.min(1,v*1.5))-5;pline(g,e.from[0],e.from[1]-5,x,y,COL.reap,2);for(let i=0;i<3;i++)pline(g,x-7+i*2,y+7,x+5+i*2,y-7,i===1?'#fff5cf':COL.reap);if(v>.6)pring(g,e.to[0],e.to[1]-5,Math.round((v-.6)*22),COL.reap);break;}
        case 'refresh': {const r=Math.round(8+v*10);pring(g,e.at[0],e.at[1]-4,r,COL.reap,3);this.plus(g,e.at[0],e.at[1]-15,'#fff3bd');break;}
        case 'arrow': { const x = lerp(e.from[0], e.to[0], v), y = lerp(e.from[1], e.to[1], v) - 5; const d = norm2(e.to[0] - e.from[0], e.to[1] - e.from[1]); pline(g, x - d[0] * 6, y - d[1] * 6, x, y, '#ffe9b0'); g.fillStyle = '#ffffff'; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); break; }
        case 'slash': { const x = lerp(e.from[0], e.to[0], Math.min(1, v * 1.3)), y = lerp(e.from[1], e.to[1], Math.min(1, v * 1.3)) - 5; pline(g, x - 4, y - 4, x + 4, y + 4, '#ffffff'); pline(g, x - 3, y - 4, x + 5, y + 4, COL.attack); break; }
        case 'claw': { const x = e.to[0], y = e.to[1] - 6, n = Math.round(v * 8); for (let i = -1; i <= 1; i++) pline(g, x - 4 + i * 3, y - 4, x - 4 + i * 3 + n, y - 4 + n, i ? COL.attack : '#ffffff'); break; }
        case 'miss': { pline(g, e.from[0], e.from[1] - 5, lerp(e.from[0], e.to[0], v), lerp(e.from[1], e.to[1], v) - 5, '#9ff7ff', 3); break; }
        case 'aoe': { const r = Math.round(4 + v * 18); pring(g, e.at[0], e.at[1], r, '#ff9ff3'); pring(g, e.at[0], e.at[1], Math.max(1, r - 4), '#ff4fd8', 2); for (let i = 0; i < 8; i++) { const a = i * 0.785 + v; g.fillStyle = '#ffd1f7'; g.fillRect(Math.round(e.at[0] + Math.cos(a) * r * 0.7), Math.round(e.at[1] + Math.sin(a) * r * 0.6), 2, 2); } pline(g, e.from[0], e.from[1] - 6, e.at[0], e.at[1], 'rgba(255,159,243,0.8)', 3); break; }
        case 'hitflash': break;
        case 'capture': { const n = Math.round(v * 6); for (let i = -1; i <= 1; i++) pline(g, e.at[0] - 4 + i * 3, e.at[1] - 3, e.at[0] - 4 + i * 3 + n, e.at[1] - 3 + n, COL.capture); pline(g, e.from[0], e.from[1] - 4, e.at[0], e.at[1], 'rgba(109,255,122,0.6)', 3); break; }
        case 'coins': { for (let i = 0; i < 6; i++) { const a = i * 1.05, r = v * 14; g.fillStyle = i % 2 ? COL.gold : '#fff1a8'; g.fillRect(Math.round(e.at[0] + Math.cos(a) * r), Math.round(e.at[1] - 6 + Math.sin(a) * r * 0.6 - v * 6), 2, 2); } break; }
        case 'ancientTaken': { pring(g, e.at[0], e.at[1] - 3, Math.round(6 + v * 22), COL.ancient); pring(g, e.at[0], e.at[1] - 3, Math.round(3 + v * 16), TEAM[e.team].glow, 2); break; }
        case 'rune': { pring(g, e.at[0], e.at[1] - 2, Math.round(16 - v * 6), COL.ancient, 2); break; }
        case 'kill': { const y = e.at[1] - 12 - Math.round(v * 8); g.drawImage(sprite('skull', null), e.at[0] - 3, y); for (let i = 0; i < 6; i++) { const a = i * 1.05; g.fillStyle = '#ffffff'; g.fillRect(Math.round(e.at[0] + Math.cos(a) * v * 12), Math.round(e.at[1] - 4 + Math.sin(a) * v * 10), 1, 1); } break; }
        case 'clash': { const r = 2 + Math.round(v * 4); g.fillStyle = '#fff6c0'; g.fillRect(Math.round(e.at[0]) - r, Math.round(e.at[1]) + 12, r * 2, 1); g.fillRect(Math.round(e.at[0]), Math.round(e.at[1]) + 12 - r, 1, r * 2); if (e.winner) { g.fillStyle = TEAM[e.winner].glow; g.fillRect(Math.round(e.at[0]) - 1, Math.round(e.at[1]) + 11, 3, 3); } break; }
        case 'wave': { const x = lerp(e.from[0], e.to[0], v), y = lerp(e.from[1], e.to[1], v); this.chev(g, x, y + 12, e.to[0] - e.from[0], e.to[1] - e.from[1], TEAM[e.team].l); break; }
        case 'pushArrow': { const p = e.pos(e.unit, u); this.chev(g, p[0] + 7, p[1] - 3 - Math.round(v * 2), e.team === 'A' ? 1 : -1, e.team === 'A' ? -0.6 : 0.6, '#ffe066'); break; }
        case 'follow': case 'retreat': { pline(g, e.from[0], e.from[1] + 3, e.to[0], e.to[1] + 3, e.type === 'follow' ? '#ffe066' : '#ff9a9a', 3); break; }
        case 'towerHit': { const sx = Math.round(Math.sin(v * 30) * 1.5); for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? COL.tower : '#ffd8a8'; g.fillRect(e.at[0] + sx + (i - 2) * 3, e.at[1] - Math.round(v * 8) + (i % 3), 2, 2); } break; }
        case 'shield': { pring(g, e.at[0], e.at[1], 9, '#c8d0ff', 2); break; }
        case 'boom': { for (let i = 0; i < 12; i++) { const a = i * 0.52, r = v * 20; g.fillStyle = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? COL.tower : '#ff4d2e'; g.fillRect(Math.round(e.at[0] + Math.cos(a) * r), Math.round(e.at[1] + Math.sin(a) * r * 0.7), 3, 3); } if (v < 0.4) pdisc(g, e.at[0], e.at[1], Math.round(8 * (1 - v)), '#fff1c0'); break; }
        case 'bolt': { const R = mulberry(Math.round(e.from[0] * 31 + e.to[1] * 7 + v * 6)); let px = e.from[0], py = e.from[1] - 6; const n = 6; for (let i = 1; i <= n; i++) { const s = i / n, x = lerp(e.from[0], e.to[0], s) + (i < n ? (R() - .5) * 8 : 0), y = lerp(e.from[1], e.to[1], s) - 6 + (i < n ? (R() - .5) * 8 : 0); pline(g, px, py, x, y, i % 2 ? '#fff3a0' : '#ffffff'); px = x; py = y; } break; }
        case 'sweep': { const x = lerp(e.from[0], e.team === 'A' ? 300 : 100, v); g.fillStyle = 'rgba(255,159,243,0.85)'; for (let y = 90; y < 290; y += 3) g.fillRect(Math.round(x + Math.sin(y / 9) * 3), y, 3, 2); break; }
        case 'alabel': break;
        default: break;
      }
    }
    fxHold(g, e, t) {
      switch (e.type) {
        case 'trail': pline(g, e.from[0], e.from[1] + 2, e.to[0], e.to[1] + 2, e.team ? hexA(TEAM[e.team].l, 0.55) : '#fff', 4); this.chev(g, e.to[0], e.to[1] + 2, e.to[0] - e.from[0], e.to[1] - e.from[1], e.team ? TEAM[e.team].l : '#fff'); break;
        case 'teleport': { for (let i = 0; i <= 14; i += 2) { const s = i / 14; g.fillStyle = 'rgba(180,140,255,0.5)'; g.fillRect(Math.round(lerp(e.from[0], e.to[0], s)), Math.round(lerp(e.from[1], e.to[1], s) - Math.sin(s * Math.PI) * 30 - 4), 1, 1); } pring(g, e.to[0], e.to[1] - 4, 11, COL.teleport, 2); break; }
        case 'recall': pring(g, e.to[0], e.to[1] - 4, 9, COL.recall, 2); g.drawImage(sprite('recall', null), e.from[0] - 3, e.from[1] - 8); break;
        case 'recallFail': this.cross(g, e.at[0], e.at[1] - 8, '#ff4d4d', 3); break;
        case 'shock': pring(g, e.at[0], e.at[1], 6, COL.engage, 2); break;
        case 'heal': this.plus(g, e.to[0] + 7, e.to[1] - 12, COL.heal); break;
        case 'control': pring(g, e.to[0], e.to[1] - 4, 8, COL.control, 2); break;
        case 'stun': break;
        case 'spellCell': this.fxDraw(g,e,.65,1,t);break;
        case 'reap': pline(g,e.from[0],e.from[1]-5,e.to[0],e.to[1]-5,COL.reap,3);this.crosshair(g,e.to[0],e.to[1]-5,COL.reap);break;
        case 'refresh': pring(g,e.at[0],e.at[1]-4,10,COL.reap,3);this.plus(g,e.at[0],e.at[1]-15,COL.reap);break;
        case 'arrow': case 'slash': case 'claw': pline(g, e.from[0], e.from[1] - 5, e.to[0], e.to[1] - 5, 'rgba(255,77,77,0.5)', 3); this.crosshair(g, e.to[0], e.to[1] - 5, COL.attack); break;
        case 'miss': pline(g, e.from[0], e.from[1] - 5, e.to[0], e.to[1] - 5, 'rgba(159,247,255,0.5)', 3); break;
        case 'aoe': pring(g, e.at[0], e.at[1], 18, 'rgba(255,159,243,0.75)', 2); break;
        case 'capture': g.drawImage(sprite('capture', null), e.at[0] + 5, e.at[1] - 10); break;
        case 'ancientTaken': pring(g, e.at[0], e.at[1] - 3, 14, hexA(TEAM[e.team].glow, 0.8), 2); break;
        case 'kill': g.drawImage(sprite('skull', null), e.at[0] - 3, e.at[1] - 18); break;
        case 'wave': this.chev(g, e.to[0], e.to[1] + 12, e.to[0] - e.from[0], e.to[1] - e.from[1], TEAM[e.team].l); break;
        case 'pushArrow': { const p = e.pos(e.unit, 1); this.chev(g, p[0] + 7, p[1] - 4, e.team === 'A' ? 1 : -1, e.team === 'A' ? -0.6 : 0.6, '#ffe066'); break; }
        case 'follow': case 'retreat': pline(g, e.from[0], e.from[1] + 3, e.to[0], e.to[1] + 3, e.type === 'follow' ? 'rgba(255,224,102,0.6)' : 'rgba(255,154,154,0.6)', 3); break;
        case 'shield': pring(g, e.at[0], e.at[1], 9, '#c8d0ff', 2); break;
        case 'boom': g.fillStyle = 'rgba(255,159,67,0.6)'; g.fillRect(e.at[0] - 6, e.at[1] + 4, 12, 2); break;
        default: break;
      }
    }
    plus(g, x, y, col) { g.fillStyle = '#0b0b12'; g.fillRect(x - 2, y - 1, 5, 3); g.fillRect(x - 1, y - 2, 3, 5); g.fillStyle = col; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
    cross(g, x, y, col, r) { g.fillStyle = col; for (let i = -r; i <= r; i++) { g.fillRect(x + i, y + i, 1, 1); g.fillRect(x + i, y - i, 1, 1); } }
    crosshair(g, x, y, col) { g.fillStyle = col; g.fillRect(x - 6, y, 3, 1); g.fillRect(x + 4, y, 3, 1); g.fillRect(x, y - 6, 1, 3); g.fillRect(x, y + 4, 1, 3); }
    chev(g, x, y, dx, dy, col) { const d = norm2(dx, dy), nx = -d[1], ny = d[0]; for (let k = 0; k < 2; k++) { const bx = x - d[0] * k * 4, by = y - d[1] * k * 4; pline(g, bx - d[0] * 3 + nx * 3, by - d[1] * 3 + ny * 3, bx, by, col); pline(g, bx - d[0] * 3 - nx * 3, by - d[1] * 3 - ny * 3, bx, by, col); } }

    drawArena(g, fg, f, k, u, t, labels, sel) {
      labels.length = 0; fg.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(5,6,14,0.78)'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#12142a'; g.fillRect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0);
      g.fillStyle = '#2a2f5a'; g.fillRect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, 1); g.fillRect(ARENA.x0, ARENA.y1 - 1, ARENA.x1 - ARENA.x0, 1); g.fillRect(ARENA.x0, ARENA.y0, 1, ARENA.y1 - ARENA.y0); g.fillRect(ARENA.x1 - 1, ARENA.y0, 1, ARENA.y1 - ARENA.y0);
      for (let y = ARENA.y0 + 4; y < ARENA.y1 - 4; y += 4) { g.fillStyle = (y / 4) % 2 ? '#15183a' : '#131633'; g.fillRect(ARENA.x0 + 2, y, ARENA.x1 - ARENA.x0 - 4, 2); }
      g.fillStyle = '#ffb627'; g.fillRect(199, 78, 2, 228);
      const prev = k > 0 ? this.game.frames[k - 1] : f;
      const actorEv = f.events.find(e => e.kind === 'final_action');
      const b = f.battle;
      // order queue
      if (b) b.order.forEach((id, i) => { const x = 82 + i * 24, y = 52, h = f.heroes.find(z => z.id === id); g.fillStyle = id === (actorEv && actorEv.unit) ? '#ffd447' : id === b.actor ? '#7ff3ff' : '#2a2f5a'; g.fillRect(x - 8, y - 12, 16, 16); g.fillStyle = '#0b0b12'; g.fillRect(x - 7, y - 11, 14, 14); g.drawImage(sprite(id.slice(2), id[0], h && h.alive ? '' : 'grey'), x - 6, y - 10); });
      this.hit = [];
      for (const h of f.heroes) {
        const [x, y] = arenaXY(h.id), ph = prev.heroes.find(z => z.id === h.id), cur = u < 0.5 && ph ? ph : h;
        const alive = u < 0.6 && ph ? ph.alive : h.alive;
        const s = sprite(h.role, h.team, alive ? '' : 'grey');
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x - 9, y + 12, 18, 3);
        const dim = sel.focus && !sel.focus.has(h.id);
        g.globalAlpha = dim ? 0.45 : 1; g.drawImage(s, 0, 0, s.width, s.height, x - 12, y - 12, 24, 24); g.globalAlpha = 1;
        this.bar(g, x - 18, y + 15, 36, cur.maxHP ? cur.hp / cur.maxHP : 0, null);
        if (actorEv && actorEv.unit === h.id) this.brackets(fg, x, y, 15, '#ffd447', 0.5 + 0.5 * Math.sin(t / 500));
        if (sel.hero === h.id) this.brackets(fg, x, y, 17, '#ffffff', 0.5);
        this.hit.push({ id: h.id, x, y: y + 4 });
      }
      for (const e of this.choreo(k).fx) {
        if (e.type === 'alabel') { if (u >= e.t0) labels.push({ text: e.text, x: e.at[0], y: e.at[1] + e.dy, col: e.col, stroke: e.stroke, big: e.big }); continue; }
        if (this.settings.reduced) { if (e.hold) this.fxHold(fg, e, t); continue; }
        if (u >= e.t0 && u <= e.t1) this.fxDraw(fg, e, clamp01((u - e.t0) / (e.t1 - e.t0)), u, t); else if (u > e.t1 && e.hold) this.fxHold(fg, e, t);
      }
    }

    drawText(f, prev, C, drawn, labels, u, sel, final) {
      const g = this.tg, k = this.scale, dpr = this.dpr;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.text.width, this.text.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fs = Math.max(11, Math.min(15, Math.round(6.2 * k)));
      const FONT = '"Cascadia Mono","Consolas","Microsoft YaHei","PingFang SC","Noto Sans SC",monospace';
      const box = (x, y, text, col, size, bg, stroke) => {
        g.font = '600 ' + size + 'px ' + FONT; const w = g.measureText(text).width;
        if (bg) { g.fillStyle = bg; g.fillRect(Math.round(x - w / 2 - 3), Math.round(y - size + 1), Math.round(w + 6), size + 3); }
        if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(text, Math.round(x - w / 2), Math.round(y)); }
        g.fillStyle = col; g.fillText(text, Math.round(x - w / 2), Math.round(y));
      };
      g.textBaseline = 'alphabetic';
      // lane captions
      if (!final) {
        g.globalAlpha = 0.55;
        box(...this.toCss(cellXY([-3, -0.4])[0] - 16, cellXY([-3, -0.4])[1]), '上路', '#cfd3ea', fs - 1, null, '#000');
        box(...this.toCss(cellXY([0.2, 3.3])[0] + 18, cellXY([0.2, 3.3])[1] + 6), '下路', '#cfd3ea', fs - 1, null, '#000');
        g.globalAlpha = 1;
      }
      // collision-aware placement: static labels are fixed; name tags shift down, event labels shift up
      const placed = [];
      const hits = r => placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
      const place = (r, dir, tries) => { for (let i = 0; i < (tries || 8) && hits(r); i++) r.y += dir * (r.h + 1); placed.push(r); return r; };
      const measure = (text, size) => { g.font = '600 ' + size + 'px ' + FONT; return g.measureText(text).width; };
      for (const l of labels) {
        const [x, y] = this.toCss(l.x, l.y), size = l.tiny ? fs - 2 : l.small ? fs - 1 : l.big ? fs + 3 : fs;
        box(x, y, l.text, l.col, size, l.box ? (l.objective ? '#2b143d' : 'rgba(8,8,18,0.78)') : null, l.stroke || (l.box ? null : '#000'));
        const w = measure(l.text, size); placed.push({ x: x - w / 2 - 3, y: y - size + 1, w: w + 6, h: size + 3 });
      }
      const mode = this.settings.names;
      if (!final && mode !== 'off') {
        const list = drawn.filter(d => mode !== 'focus' || (sel.focus ? sel.focus.has(d.h.id) : sel.hero === d.h.id)).sort((a, b) => a.y - b.y || a.x - b.x);
        g.font = '600 ' + fs + 'px ' + FONT;
        for (const d of list) {
          const name = this.game.name(d.h.id), [x, y] = this.toCss(d.x, d.y + 8), w = g.measureText(name).width;
          const r = place({ x: Math.round(x - w / 2 - 3), y: Math.round(y), w: Math.round(w + 6), h: fs + 3 }, 1);
          g.globalAlpha = d.dim ? 0.45 : 1;
          g.fillStyle = 'rgba(6,6,14,0.78)'; g.fillRect(r.x, r.y, r.w, r.h);
          g.fillStyle = TEAM[d.h.team].b; g.fillRect(r.x, r.y, 2, r.h);
          g.fillStyle = TEAM[d.h.team].text; g.fillText(name, r.x + 3, r.y + fs);
          g.globalAlpha = 1;
        }
      }
      if (final) {
        for (const h of f.heroes) {
          const [ax, ay] = arenaXY(h.id), [x, y] = this.toCss(ax, ay + 28);
          box(x, y, this.game.name(h.id), TEAM[h.team].text, fs, 'rgba(6,6,14,0.8)');
          const [hx, hy] = this.toCss(ax, ay + 36); box(hx, hy + 4, Math.round(h.hp) + '/' + h.maxHP, '#d8dbe8', fs - 2, null, '#000');
        }
        const tt = f.phase === 'final_pending' ? '决战入场' : '最终决战' + (f.battle ? ' · 第' + f.battle.round + '轮' : '');
        const [x, y] = this.toCss(200, 30); box(x, y, tt, '#ffd447', fs + 4, 'rgba(6,6,14,0.85)', '#000');
        const [qx, qy] = this.toCss(40, 56); box(qx + 20, qy, '出手顺序', '#9aa0c0', fs - 2, null);
      }
      // choreographed labels (damage numbers etc.)
      for (const l of C.labels || []) {
        if (!this.settings.reduced && u < l.t0) continue;
        if (!l.hold && u > l.t0 + 0.4) continue;
        const v = this.settings.reduced ? 1 : clamp01((u - l.t0) / 0.3);
        const lx = l.at[0], ly = l.at[1] + (l.dy || 0) - (l.float ? v * 4 : 0);
        const [x, y0] = this.toCss(lx, ly), size = l.big ? fs + 2 : l.small ? fs - 2 : fs, w = measure(l.text, size);
        const r = final ? { y: y0 - size + 1 } : place({ x: x - w / 2 - 2, y: y0 - size + 1, w: w + 4, h: size + 2 }, -1, 5);
        box(x, r.y + size - 1, l.text, l.col, size, null, l.stroke || '#000');
      }
    }
  }
  function norm2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
  function hexA(hex, a) { const [r, g, b] = rgb(hex); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }

  MB.Renderer = Renderer;
  MB.geom = { W, H, S, cellXY, arenaXY };
  MB.sprite = sprite; MB.ICON_NAMES = Object.keys(ICON);
})(typeof window !== 'undefined' ? window : globalThis);
