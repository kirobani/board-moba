'use strict';
const {makeRole}=require('./tactics.cjs');
const {preset}=require('./jungle-tempo.cjs');

module.exports.decide=makeRole('jungle', state=>state.decisionTurn>state.config.laneLock ?
  {...preset,farm:2.65,push:.7,split:.5,objective:3.35} : preset
);
