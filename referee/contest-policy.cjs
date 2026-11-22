'use strict';
const fs = require('node:fs');
const path = require('node:path');

const formalPairs = 10;
const developmentMs = 180*60_000;
const submissionMs = 210*60_000;

function readReceipt(file) {
  try {return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error) {
    if (error.code==='ENOENT') return undefined;
    throw error;
  }
}

function readClock(sealPath) {
  const clock = readReceipt(sealPath+'.clock');
  if (clock===undefined) return undefined;
  const {startedAt} = clock;
  if (!Number.isSafeInteger(startedAt) || startedAt<=0) throw Error('Invalid referee clock');
  const directory = sealPath+'.interruptions';
  const credits = fs.existsSync(directory) ? fs.readdirSync(directory)
    .filter(name=>/^\d+-\d+\.json$/.test(name))
    .map(name=>readReceipt(path.join(directory,name))) : [];
  const merged = [];
  for (const {from,to} of credits.sort((a,b)=>a.from-b.from)) {
    if (!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<startedAt||to<=from) {
      throw Error('Invalid interruption receipt');
    }
    const previous = merged.at(-1);
    if (previous && from<=previous.to) previous.to=Math.max(previous.to,to);
    else merged.push({from,to});
  }
  let developmentEndsAt = startedAt+developmentMs;
  let closesAt = startedAt+submissionMs;
  let interruptionMs = 0;
  for (const {from,to} of merged) {
    if (from>=closesAt) break;
    const duration = to-from;
    if (from<developmentEndsAt) developmentEndsAt+=duration;
    closesAt+=duration;
    interruptionMs+=duration;
  }
  return {startedAt,developmentEndsAt,closesAt,interruptionMs};
}

module.exports = {formalPairs,readReceipt,readClock};
