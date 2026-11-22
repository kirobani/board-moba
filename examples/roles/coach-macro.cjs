'use strict';
const {makeCoach}=require('./tactics.cjs');
module.exports.decide=makeCoach({
  top:{lane:1.8,push:2.8,split:2.4,safety:1.12},
  mid:{lane:1.7,push:1.7,combat:1.0,objective:2.15},
  jungle:{farm:3.1,invade:0.7,objective:3.6,roam:1.2},
  adc:{lane:2.0,push:2.15,combat:0.8,reap:1.2,safety:1.15},
  support:{lane:0.9,push:0.6,peel:1.15,follow:0.7,objective:3.2},
},{threshold:2.45,objective:1.45,push:1.25,engage:0.7});
