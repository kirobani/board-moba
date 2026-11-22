'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('adc', {
  lane:2.2, push:0.85, combat:1.5, roam:1.7,
  objective:1, reap:2.2, safety:1.02, reset:0.45,
});
