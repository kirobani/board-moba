'use strict';
const vm=require('node:vm');
class BotFault extends Error{constructor(code,message){super(message);this.code=code;}}
class Bot{
 constructor(source,engineSource,budget=2000){
  if(!Number.isInteger(budget)||budget<1||budget>2000)throw new BotFault('budget-limit','Decision budget must be an integer from 1 to 2000 ms');
  this.budget=budget;this.ctx=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
  try{
   new vm.Script(engineSource,{filename:'engine.cjs'}).runInContext(this.ctx,{timeout:1000});
   new vm.Script(`globalThis.module={exports:{}};globalThis.exports=module.exports;
    globalThis.require=function(name){if(name==='./engine.cjs')return HexMoba;throw new Error('Only ./engine.cjs may be imported');};
    globalThis.console={log(){},warn(){},error(){}};
    Math.random=function(){throw new Error('Use your own deterministic PRNG; hidden judge seed is unavailable');};
    ${source}\n;globalThis.__agent=module.exports;
    if(typeof __agent.decide!=='function')throw new Error('Export module.exports.decide(observation)');`,{filename:'agent.cjs'}).runInContext(this.ctx,{timeout:1000});
   this.call=new vm.Script(`(()=>{const obs=JSON.parse(__input);const result=__agent.decide(obs);if(result&&typeof result.then==='function')throw new Error('decide must be synchronous');globalThis.__output=JSON.stringify(result);})()`,{filename:'decision.cjs'});
  }catch(e){throw new BotFault('initialization',String(e.message).slice(0,500));}
 }
 decide(observation){
  this.ctx.__input=JSON.stringify(observation);this.ctx.__output=undefined;
  try{this.call.runInContext(this.ctx,{timeout:this.budget});}catch(e){throw new BotFault(e.code==='ERR_SCRIPT_EXECUTION_TIMEOUT'?'decision-timeout':'decision-exception',String(e.message).slice(0,500));}
  const text=this.ctx.__output;if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw new BotFault('output','Return a JSON-serializable object, maximum64KiB');
  let result;try{result=JSON.parse(text);}catch(_){throw new BotFault('output','Invalid JSON result');}
  if(!result||!Array.isArray(result.orders)||result.orders.length>5)throw new BotFault('output','Return {orders:[...]} with at most5 orders');
  const known=new Set(observation.heroes.filter(h=>h.team===observation.you).map(h=>h.id)),seen=new Set();
  for(const o of result.orders){if(!o||!known.has(o.unit)||seen.has(o.unit)||!['move','attack','spell','reap','capture','push','heal','control','recall','wait','engage','teleport'].includes(o.action))throw new BotFault('order-format','Wrong unit, duplicate unit, or invalid action');seen.add(o.unit);}
  if(observation.phase==='final_battle'&&result.orders.some(o=>o.unit!==observation.finalDecision.actor))throw new BotFault('order-format','Finalbattle accepts current actor only');return{orders:result.orders};
 }
}
module.exports={Bot,BotFault};
