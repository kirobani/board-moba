'use strict';
const {readFileSync} = require('node:fs');

function display(seconds) {
  const hours = Math.floor(seconds/3600);
  const minutes = Math.floor(seconds/60)%60;
  return [hours,minutes,seconds%60].map(part=>String(part).padStart(2,'0')).join(':');
}

try {
  const file = process.argv[2] ?? 'contest-clock.json';
  const {startedAt,developmentEndsAt,closesAt,interruptionMs=0} = JSON.parse(readFileSync(file,'utf8').trimStart());
  if (![startedAt,developmentEndsAt,closesAt,interruptionMs].every(Number.isSafeInteger) ||
      startedAt<=0 || interruptionMs<0 || !(startedAt<developmentEndsAt && developmentEndsAt<closesAt)) {
    throw Error('计时文件格式有误');
  }
  const now = Date.now();
  const elapsed = Math.max(0,Math.floor((now-startedAt-interruptionMs)/1000));
  const remaining = deadline => display(Math.max(0,Math.ceil((deadline-now)/1000)));
  const stage = now<startedAt ? '等待开赛' : now<developmentEndsAt ? '开发试赛' :
    now<closesAt ? '整理交卷' : '已收卷';
  const credited = interruptionMs ? ` · 已补时 ${display(Math.floor(interruptionMs/1000))}` : '';
  console.log(`${stage} · 已用 ${display(elapsed)} · 开发剩余 ${remaining(developmentEndsAt)} · 收卷剩余 ${remaining(closesAt)}${credited}`);
} catch (error) {
  console.error(error.code==='ENOENT' ? '未找到计时文件，请使用裁判发的 contest-clock.json' : error.message);
  process.exitCode = 1;
}
