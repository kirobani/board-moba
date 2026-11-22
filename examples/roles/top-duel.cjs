'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('top', {
  lane:2.5, push:1.25, combat:1.35, objective:0.8,
  safety:0.95,
});
