'use strict';
const {makeRole}=require('./tactics.cjs');
module.exports.decide=makeRole('support', {
  lane:1.25, push:0.25, peel:1.4, follow:1.5,
  engage:-0.8, objective:1.1, safety:1.07,
});
