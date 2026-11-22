/* Shared read-only economy chart. Points come from recorded hero gold, including dead heroes. */
(function (root) {
  'use strict';
  let nextId = 0;
  const signed = n => (Math.abs(n) < .0000005 ? '±0' : (n > 0 ? '+' : '−') + amount(Math.abs(n)));
  const amount = n => Number(n).toLocaleString('zh-CN', {maximumFractionDigits: 1});
  function label(frame, index) {
    if (frame.phase === 'final_pending') return '决战入场';
    if (frame.phase && frame.phase !== 'map') return '决战行动 ' + (frame.battle?.actions ?? index);
    return '回合 ' + (frame.mapTurn ?? frame.turn ?? index);
  }
  function series(frames, start = 0) {
    return frames.map((frame, offset) => {
      const index=start+offset;
      const totals = {A: 0, B: 0};
      for (const hero of frame.heroes) {
        if (hero.team !== 'A' && hero.team !== 'B') continue;
        const gold = hero.goldMicros != null ? hero.goldMicros / 1e6 : Number(hero.gold);
        if (!Number.isFinite(gold)) throw Error('金币记录缺失');
        totals[hero.team] += gold;
      }
      return {index, label: label(frame, index), A: totals.A, B: totals.B, diff: totals.A - totals.B};
    });
  }
  function mount(el, frames, options) {
    options = options || {};
    const points = series(frames), names = {A: options.A || 'A队', B: options.B || 'B队'};
    if (!points.length) throw Error('没有可用的经济记录');
    const uid = 'ec-' + ++nextId;
    el.classList.add('economy-curve');
    if (options.compact) el.classList.add('ec-compact');
    el.innerHTML = `<div class="ec-heading"><strong>经济差曲线</strong><span class="ec-scope"></span></div>
      <div class="ec-legend"><span class="ec-team-a"></span><span class="ec-team-b"></span></div>
      <div class="ec-readout" aria-live="off"><b class="ec-at"></b><strong class="ec-diff"></strong><span class="ec-totals"></span></div>
      <div class="ec-plot"><div class="ec-axis" aria-hidden="true"><span class="ec-high"></span><span>0</span><span class="ec-low"></span></div>
        <div class="ec-drawing"><svg class="ec-svg" viewBox="0 0 800 160" preserveAspectRatio="none" role="img" aria-label="双方经济差随回合变化，上方A队领先，下方B队领先">
          <defs><clipPath id="${uid}-a"><rect x="0" y="0" width="800" height="80"/></clipPath><clipPath id="${uid}-b"><rect x="0" y="80" width="800" height="80"/></clipPath></defs>
          <path class="ec-grid" d="M0 8H800 M0 152H800"/><path class="ec-zero" d="M0 80H800"/>
          <path class="ec-fill ec-a" clip-path="url(#${uid}-a)"/><path class="ec-fill ec-b" clip-path="url(#${uid}-b)"/>
          <path class="ec-line ec-a" clip-path="url(#${uid}-a)"/><path class="ec-line ec-b" clip-path="url(#${uid}-b)"/>
          <line class="ec-cursor" y1="0" y2="160"/><circle class="ec-dot" r="3" vector-effect="non-scaling-stroke"/>
        </svg></div></div>
      <div class="ec-xlabels"><span class="ec-start"></span><span class="ec-end"></span></div>
      <input class="ec-inspect" type="range" min="0" step="1" value="0" aria-label="查看各回合经济差">
      <p class="ec-note">A队总金币 − B队总金币 · 悬停或拖动查看</p>`;
    const q = selector => el.querySelector(selector);
    q('.ec-team-a').textContent = 'A / ' + names.A + ' 领先 ↑';
    q('.ec-team-b').textContent = 'B / ' + names.B + ' 领先 ↓';
    q('.ec-scope').textContent = options.live ? '随播放更新' : '全局回顾';
    const input = q('.ec-inspect'), drawing = q('.ec-drawing');
    let current = 0, inspected = 0, limit = 100;
    const X = k => current ? k / current * 800 : 0;
    const Y = d => 80 - d / limit * 72;
    function inspect(k) {
      inspected = Math.max(0, Math.min(current, Math.round(k)));
      const p = points[inspected];
      el.dataset.inspectIndex = String(inspected);
      el.dataset.diff = String(p.diff);
      el.dataset.goldA = String(p.A); el.dataset.goldB = String(p.B);
      q('.ec-at').textContent = p.label;
      q('.ec-diff').textContent = 'A−B ' + signed(p.diff) + ' 金';
      q('.ec-diff').dataset.lead = p.diff > .0000005 ? 'A' : p.diff < -.0000005 ? 'B' : 'even';
      q('.ec-totals').textContent = names.A + ' ' + amount(p.A) + ' / ' + names.B + ' ' + amount(p.B);
      q('.ec-cursor').setAttribute('x1', X(inspected)); q('.ec-cursor').setAttribute('x2', X(inspected));
      q('.ec-dot').setAttribute('cx', X(inspected)); q('.ec-dot').setAttribute('cy', Y(p.diff));
      input.value = String(inspected);
      input.setAttribute('aria-valuetext', p.label + '，' + names.A + '减' + names.B + '，' + signed(p.diff) + '金币');
    }
    function setFrame(k) {
      current = Math.max(0, Math.min(points.length - 1, Math.floor(k)));
      const visible = points.slice(0, current + 1);
      const peak = visible.reduce((v, p) => Math.max(v, Math.abs(p.diff)), 0);
      limit = Math.max(100, Math.ceil(peak / 100) * 100);
      const path = visible.map(p => `${p.index ? 'L' : 'M'}${X(p.index).toFixed(3)},${Y(p.diff).toFixed(3)}`).join(' ');
      q('.ec-high').textContent = '+' + amount(limit); q('.ec-low').textContent = '−' + amount(limit);
      el.querySelectorAll('.ec-line').forEach(p => p.setAttribute('d', path));
      el.querySelectorAll('.ec-fill').forEach(p => p.setAttribute('d', path + ` L${X(current)},80 L0,80 Z`));
      q('.ec-start').textContent = points[0].label;
      q('.ec-end').textContent = points[current].label;
      el.dataset.currentIndex = String(current); el.dataset.pointCount = String(visible.length);
      input.max = String(current); input.disabled = current === 0;
      q('.ec-svg').setAttribute('aria-label', names.A + '减' + names.B + '的经济差，' + points[0].label + '至' + points[current].label);
      inspect(current);
    }
    function pointer(event) {
      const rect = drawing.getBoundingClientRect();
      if (rect.width) inspect((event.clientX - rect.left) / rect.width * current);
    }
    drawing.addEventListener('pointermove', pointer);
    drawing.addEventListener('pointerdown', pointer);
    drawing.addEventListener('pointerleave', () => inspect(current));
    input.addEventListener('input', () => inspect(+input.value));
    setFrame(options.live ? (options.index || 0) : points.length - 1);
    const chart = {setFrame, inspect, points, append:frames=>points.push(...series(frames,points.length))};
    el.economyChart = chart;
    return chart;
  }
  root.MobaEconomyCurve = {series, mount};
})(typeof window !== 'undefined' ? window : globalThis);
