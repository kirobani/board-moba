'use strict';
const {makeCoach}=require('./tactics.cjs');
module.exports.decide=makeCoach({
  top:{lane:2.25,push:0.9,combat:1.75,safety:0.92},
  mid:{lane:1.9,push:0.6,combat:2.1,roam:2.2,objective:1.1},
  jungle:{farm:3.0,engage:1.7,objective:2.5,roam:2.3,combat:1.3},
  adc:{lane:2.2,push:0.9,combat:1.95,reap:2.0,safety:1.15},
  support:{lane:1.1,peel:1.65,follow:1.2,engage:1.3,objective:1.4},
},{threshold:2.3,combat:1.0,peel:1.4,reset:0.5,engage:1.65});
