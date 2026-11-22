'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('mid', {
  lane:2.1, push:1, combat:1.55, objective:0.65,
  roam:0.9, safety:1.02,
});
