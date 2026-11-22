'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('adc', {
  lane:2.45, push:1.85, combat:0.75, objective:0.35,
  reap:1.05, safety:1.2, reset:0.4,
});
