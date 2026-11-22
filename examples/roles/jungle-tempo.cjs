'use strict';
const {makeRole}=require('./tactics.cjs');
const preset={
  farm:3, invade:0.65, engage:2.25, objective:3.05,
  roam:2.8, combat:1.2, safety:0.87,
};
module.exports={preset,decide:makeRole('jungle',preset)};
