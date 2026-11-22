'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('top', {
  lane:1.6, push:2.4, split:2.1, combat:0.35,
  farm:0.25, objective:-0.2, safety:1.15,
});
