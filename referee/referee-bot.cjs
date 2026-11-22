'use strict';
const {Bot}=require('./bot-vm.cjs');
class RefereeBot extends Bot {
  decide(observation){
    const decision=super.decide(observation);
    if(observation.phase!=='map')return decision;
    const {coach}=JSON.parse(this.ctx.__output);
    return coach==null?decision:{...decision,coach};
  }
}
module.exports={RefereeBot};
