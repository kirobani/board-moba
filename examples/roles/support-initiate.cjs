'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('support', {
  lane:1.15, push:0.5, peel:1.05, follow:0.9,
  engage:2.3, objective:2.1, safety:0.87,
});
