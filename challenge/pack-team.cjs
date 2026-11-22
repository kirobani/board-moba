'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {squad, rosterFor} = require('../referee/challenge.cjs');

const [directory, destination] = process.argv.slice(2);
if (!directory || !destination) {
  console.error('Usage: node challenge/pack-team.cjs TEAM_DIR NEW_SUBMISSION_JSON');
  process.exit(1);
}
const names = fs.readdirSync(directory).filter(name => /^[a-z][a-z0-9_-]*\.cjs$/.test(name) && name !== 'engine.cjs');
const candidate = squad(Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')])));
const roster = JSON.parse(fs.readFileSync(path.join(directory, 'roster.json'), 'utf8'));
const rosters = {candidate: rosterFor({candidate: roster}, 'candidate')};
fs.writeFileSync(destination, JSON.stringify({candidate, rosters}, null, 2) + '\n', {flag: 'wx'});
