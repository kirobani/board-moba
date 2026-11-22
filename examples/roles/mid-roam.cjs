'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('mid', {
  lane:1.75, push:0.55, combat:1.55, objective:1.55,
  roam:3.1, safety:0.85,
});
