'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const teams = require('../results/teams.json');

const choices = {
  top: ['duel', 'split'],
  jungle: ['lane', 'tempo'],
  mid: ['roam', 'zone'],
  adc: ['cleanup', 'siege'],
  support: ['initiate', 'peel'],
  coach: ['macro', 'tactical'],
};
const roleSource = name => fs.readFileSync(path.join(__dirname, 'roles', name + '.cjs'), 'utf8');

function demoEntries() {
  return teams.map((original, index) => {
    const seat = String(index + 1).padStart(2, '0');
    const roles = ['top', 'mid', 'jungle', 'adc', 'support'];
    const playerIds = Object.fromEntries(roles.map((role, n) => [role, 'Demo' + seat + 'P' + (n + 1)]));
    const roster = {coreRole: roles[index % roles.length], playerIds};
    const files = Object.fromEntries(Object.entries(choices).map(([role, styles], n) =>
      [role + '.cjs', roleSource(role + '-' + styles[(index >> (n % 4)) & 1])]));
    files['tactics.cjs'] = roleSource('tactics');
    files['jungle-tempo.cjs'] = roleSource('jungle-tempo');
    const digest = createHash('sha256').update(JSON.stringify([Object.entries(files).sort(), roster])).digest('hex');
    const info = {id: 'demo-' + seat, label: '示例队 ' + seat, model: original.model, roster, digest};
    return {info, files};
  });
}

if (require.main === module) {
  const [id, file] = process.argv.slice(2);
  const demo = demoEntries().find(entry => entry.info.id === id);
  if (!demo || !file) {
    console.error('Usage: node examples/squads.cjs demo-01 path/to/team.json');
    process.exitCode = 1;
  } else {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({candidate: demo.files, rosters: {candidate: demo.info.roster}}, null, 2) + '\n', {flag: 'wx'});
  }
}

module.exports = {demoEntries};
