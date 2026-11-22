'use strict';
import vm from 'node:vm';
import readline from 'node:readline';

const clock = {budget:2000};
const roles = ['top','mid','jungle','adc','support'];
let decideTeam;
function loadContext(files, engine) {
  const context = vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
  const run = (source,filename) => new vm.Script(source,{filename}).runInContext(context,{timeout:1000});
  run(engine,'engine.cjs');
  run(`
    const modules = new Map(), loaded = new Map();
    globalThis.console = Object.freeze({log(){}, warn(){}, error(){}});
    Math.random = () => { throw new Error('Use deterministic decisions'); };
    function load(id) {
      if (id === 'engine.cjs') return HexMoba;
      if (!modules.has(id)) throw new Error('Unavailable module');
      if (loaded.has(id)) return loaded.get(id).exports;
      const module = {exports:{}};
      loaded.set(id,module);
      const require = name => {
        if (typeof name !== 'string' || !/^\\.\\/[a-z][a-z0-9_-]*(?:\\.cjs)?$/.test(name)) throw new Error('Unavailable module');
        return load(name.endsWith('.cjs') ? name.slice(2) : name.slice(2)+'.cjs');
      };
      modules.get(id)(module, module.exports, require);
      return module.exports;
    }
  `,'loader.cjs');
  for (const [name,source] of Object.entries(files)) {
    if (name === 'engine.cjs') continue;
    run(`modules.set(${JSON.stringify(name)},(function(module,exports,require) {\n${source}\n}));`,name);
  }
  return {context,run};
}
function init(files, engine) {
  const {context,run} = loadContext(files,engine);
  run(`
    const roles = ${JSON.stringify(roles)};
    const programs = Object.fromEntries([...roles,'coach'].map(role=>[role,load(role+'.cjs').decide]));
    for (const role of Object.keys(programs)) if (typeof programs[role] !== 'function') {
      throw new Error(role+'.cjs must export decide');
    }
    function orderFor(obs,role) {
      const order = programs[role](JSON.parse(input));
      if (order == null) return null;
      if (typeof order !== 'object' || order.unit !== obs.you+'_'+role) throw new Error(role+' returned an invalid unit');
      return order;
    }
    function decision() {
      const obs = JSON.parse(input);
      if (obs.phase === 'final_battle') {
        return {orders:[orderFor(obs,obs.finalDecision.actor.split('_')[1])].filter(Boolean)};
      }
      const orders = roles.map(role=>orderFor(obs,role)).filter(Boolean);
      const coach = programs.coach(JSON.parse(input),JSON.parse(JSON.stringify(orders)));
      if (coach != null && typeof coach !== 'object') throw new Error('Invalid coach proposal');
      return {orders,coach};
    }
  `,'team.cjs');
  const decide = new vm.Script('JSON.stringify(decision())',{filename:'decision.cjs'});
  return observation => {
    context.input = JSON.stringify(observation);
    return decide.runInContext(context,{timeout:clock.budget});
  };
}

function initWithCore(files, engine, coreRole) {
  if (!roles.includes(coreRole)) throw new Error('Invalid core role');
  const invoke = new vm.Script('JSON.stringify(program(...JSON.parse(input)) ?? null)',{filename:'decision.cjs'});
  // Each role has its own module state. Only the referee passes proposals between them.
  const contexts = Object.fromEntries([...roles,'coach'].map(role=>{
    const {context,run} = loadContext(files,engine);
    run(`const program = load(${JSON.stringify(role+'.cjs')}).decide;
      if (typeof program !== 'function') throw new Error('Module must export decide');`,role+'.cjs');
    return [role,context];
  }));

  return observation => {
    const deadline = performance.now()+clock.budget;
    function remaining() {
      const time = deadline-performance.now();
      if (time<=0) throw Object.assign(new Error('Team decision budget exceeded'),{code:'ERR_SCRIPT_EXECUTION_TIMEOUT'});
      return Math.ceil(time);
    }
    function call(role,...args) {
      const context = contexts[role];
      context.input = JSON.stringify([observation,...args]);
      const out = invoke.runInContext(context,{timeout:remaining()});
      remaining();
      if (typeof out!=='string'||Buffer.byteLength(out)>65536) throw new Error('Invalid JSON decision');
      return JSON.parse(out);
    }
    function proposal(role,...args) {
      const order = call(role,...args);
      if (order!=null&&(typeof order!=='object'||order.unit!==observation.you+'_'+role)) {
        throw new Error(role+' returned an invalid unit');
      }
      return order;
    }
    if (observation.phase==='final_battle') {
      const role = observation.finalDecision.actor.split('_')[1];
      return JSON.stringify({orders:[proposal(role)].filter(Boolean)});
    }
    const coreOrder = proposal(coreRole);
    const reference = {coreRole,coreOrder};
    const orders = roles.map(role=>role===coreRole?coreOrder:proposal(role,reference)).filter(Boolean);
    const coach = call('coach',orders);
    if (coach!=null&&typeof coach!=='object') throw new Error('Invalid coach proposal');
    return JSON.stringify({orders,coach});
  };
}
const lines = readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of lines) {
  try {
    const data = JSON.parse(line);
    if (data.type === 'initialize') {
      decideTeam = data.coreRole==null?init(data.files,data.engine):initWithCore(data.files,data.engine,data.coreRole);
      process.stdout.write('{"ready":true}\n');
      continue;
    }
    const out = decideTeam(data.observation);
    if (typeof out !== 'string' || Buffer.byteLength(out)>65536) throw new Error('Invalid JSON decision');
    process.stdout.write(out+'\n');
  } catch(err) {
    process.stdout.write(JSON.stringify({fault:err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
      ? 'decision-timeout' : 'program-error',message:String(err.message).slice(0,300)})+'\n');
  }
}
