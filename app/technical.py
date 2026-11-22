"""Public-event technical statistics and frozen, role-calibrated MVP/POM scoring."""
import bisect,collections,copy,json
from fractions import Fraction as F
VERSION='role-impact-v2'
WEIGHTS={'top':['.35','.40','0','.25'],'jungle':['.35','.50','0','.15'],'mid':['.65','.20','0','.15'],'adc':['.60','.20','0','.20'],'support':['.10','.10','.70','.10']}
FEATURES=['damage','kills','assists','structures','ancients','camps','healing','control','economy','deaths']
RULES={'version':VERSION,'mvp_scope':'valid small game, winning team heroes only','pom_scope':'completed BO, winning team heroes, mean of all played valid maps including losses','features':'Public events and terminal hero counters; rates per 100 effective rounds (mapTurns + finalBattleActions/10).','damage':'Hero damage capped by remaining HP; no overkill credit. Final-hit events already contain effective damage.','healing':'Effective healing to allies only; self healing shown separately, not scored.','assists':'Derived, not engine-native: damage/control on victim or healing of the killer in preceding 3 map turns / 30 final actions; unique per kill, excluding killer.','structures':'Effective push damage split equally among recorded contributors, divided by target maximum HP. Individual damage is an attribution convention, not a separately recorded engine fact.','ancients':'Successful objective credit split among winning-team contributors during that spawn cycle, using engine jungle weight 2, others 1.','camps':'Successful camp credit shared by recorded recipients.','dimensions':{'combat':{'damage':'.55','kills':'.25','assists':'.20'},'objectives':{'structures':'.50','ancients':'.30','camps':'.20'},'utility':{'healing':'.60','control':'.40'},'economy':{'economy':'1'}},'role_weights':WEIGHTS,'death_penalty':'.10','normalization':'Primitive positive features use frozen same-role empirical midrank percentiles, zero credit for zero positive contribution. Composite role score is again converted to its frozen same-role empirical percentile, removing differences among role weight distributions.','eligibility':'Actual damage to heroes, healing allies, successful control, objective contribution or a kill; income alone is insufficient.','ties':'Full precision; MVP then lower same-role death percentile, otherwise joint award. POM then map-MVP count, then lower mean same-role death percentile, otherwise joint award.','invalid_or_draw':'Technical-invalid games and draws do not receive MVP; incomplete or technically-held BO does not receive POM.','result_independence':'Awards do not alter game, BO, standings, seeds or qualification.','limitations':'Attribution is a public-event convention, not counterfactual causal proof or a general measure of model quality.'}

def analyze(replay,labels,teams,valid=True):
    frames=replay['frames'];first=frames[0];last=frames[-1]
    assert frames and len(first['heroes'])==10
    heroes={h['id']:h for h in first['heroes']};terminal={h['id']:h for h in last['heroes']}
    result={};recent_damage=collections.defaultdict(dict);recent_control=collections.defaultdict(dict);recent_heal=collections.defaultdict(dict)
    ancient=collections.defaultdict(collections.Counter);structure_contributors=collections.defaultdict(set)
    effective_rounds=max(1,float(replay.get('mapTurns',last.get('mapTurn',0)))+float(replay.get('battleActions',last.get('battle',{}).get('actions',0)) or 0)/10)
    for unit,h in heroes.items():
        entry=teams[labels[h['team']]];player=next(x for x in entry['players'] if x['role']==h['role'])
        result[unit]={'unit':unit,'key':labels[h['team']]+':'+h['role'],'team':h['team'],'participant':labels[h['team']],'role':h['role'],'displayName':player['displayName'],'kills':0,'deaths':0,'assistsDerived':0,'damageHeroes':0.,'damageTaken':0.,'rawDamageHeroes':0.,'healingAllies':0.,'healingSelf':0.,'controlHits':0,'structuralDamageShared':0.,'structureFractionShared':0.,'campCredits':0.,'ancientCredits':0.,'towersParticipated':0,'pushFollows':0,'recalls':0,'teleports':0,'engages':0,'invalidCommands':0,'commands':{},'gold':0.,'income':{}}
    kinds=collections.Counter();tower_taken=set()
    for index,frame in enumerate(frames[1:],1):
        prev=frames[index-1];events=frame.get('events',[]);now={h['id']:h for h in frame['heroes']};before={h['id']:h for h in prev['heroes']}
        final=frame.get('phase')=='final_battle';window=30 if final else 3
        hp={u:float(before[u]['hp']) for u in heroes}
        if any(e.get('kind')=='final_start' for e in events):hp={u:float(now[u]['maxHP']) for u in heroes}
        else:
            for u in heroes:
                if not before[u]['alive'] and now[u]['alive']:hp[u]=float(before[u]['maxHP'])
        for side,orders in frame.get('orders',{}).items():
            for order in orders:
                if isinstance(order,dict) and order.get('unit') in result:
                    row=result[order['unit']];action=order.get('action','unknown');row['commands'][action]=row['commands'].get(action,0)+1
        simultaneous=not frame.get('config',{}).get('randomAttackOrder',True) and not final
        grouped=collections.defaultdict(float)
        if simultaneous:
            for e in events:
                if e.get('kind')=='heal' and e.get('target') in hp:hp[e['target']]+=float(e.get('amount',0))
                if e.get('kind')=='hit' and e.get('target') in heroes:grouped[e['target']]+=float(e.get('damage',0))
        for event in events:
            kind=event.get('kind');kinds[kind]+=1;source=event.get('source') or event.get('unit');target=event.get('target')
            if kind in ['heal','final_heal'] and source in result and target in heroes:
                amount=max(0.,float(event.get('amount',0)))
                if not simultaneous:hp[target]=hp.get(target,0)+amount
                field='healingSelf' if source==target else 'healingAllies';result[source][field]+=amount
                if amount>0 and source!=target:recent_heal[target][source]=index
            if kind in ['hit','final_hit'] and source in result and target in heroes and heroes[source]['team']!=heroes[target]['team']:
                raw=max(0.,float(event.get('damage',0)));result[source]['rawDamageHeroes']+=raw
                if kind=='final_hit':effective=raw
                elif simultaneous:effective=raw*min(1.,max(0.,hp[target])/max(grouped[target],1e-12))
                else:effective=min(raw,max(0.,hp[target]));hp[target]=max(0.,hp[target]-effective)
                result[source]['damageHeroes']+=effective;result[target]['damageTaken']+=effective
                if effective>0:recent_damage[target][source]=index
            if kind in ['control','final_control'] and source in result and target in heroes and event.get('success',True):
                result[source]['controlHits']+=1;recent_control[target][source]=index
            if kind in ['kill','final_kill'] and target in heroes:
                killer=event.get('killer') or event.get('source')
                if killer in heroes:
                    allied=heroes[killer]['team'];assist=set()
                    for log in [recent_damage[target],recent_control[target],recent_heal[killer]]:
                        assist.update(u for u,at in log.items() if index-at<=window and heroes[u]['team']==allied and u!=killer)
                    for u in assist:result[u]['assistsDerived']+=1
                recent_damage.pop(target,None);recent_control.pop(target,None);recent_heal.pop(target,None)
            if kind=='ancient_spawn':ancient.pop(target,None)
            if kind=='ancient_progress' and float(event.get('damage',0))>0:
                for u in event.get('sources',[]):
                    if u in heroes:ancient[target][u]+=2 if heroes[u]['role']=='jungle' else 1
            if kind=='ancient':
                contributors={u:n for u,n in ancient[target].items() if heroes[u]['team']==event.get('team')};den=sum(contributors.values())
                for u,n in contributors.items():result[u]['ancientCredits']+=n/den if den else 0
                ancient.pop(target,None)
            if kind=='camp':
                contributors={x['id'] for x in event.get('awards',[]) if x.get('id') in result}
                for u in contributors:result[u]['campCredits']+=1/len(contributors)
            if kind=='push_damage' and float(event.get('damage',0))>0:
                contributors={u for u in event.get('sources',[]) if u in result};buildings={x['id']:x for x in prev.get('buildings',[])};building=buildings.get(target)
                if contributors and building:
                    share=float(event['damage'])/len(contributors)
                    for u in contributors:
                        result[u]['structuralDamageShared']+=share;result[u]['structureFractionShared']+=share/max(1.,float(building['maxHP']));structure_contributors[target].add(u)
            if kind=='tower' and target not in tower_taken:
                tower_taken.add(target)
                for u in structure_contributors[target]:result[u]['towersParticipated']+=1
            if kind=='push_follow' and source in result:result[source]['pushFollows']+=1
            if kind in ['recall','teleport','engage_cast','engage'] and source in result:
                field={'recall':'recalls','teleport':'teleports','engage_cast':'engages','engage':'engages'}[kind];result[source][field]+=1
            if kind=='invalid' and source in result:result[source]['invalidCommands']+=1
    for unit,row in result.items():
        h=terminal[unit];row.update(kills=h.get('kills',0),deaths=h.get('deaths',0),gold=h.get('goldMicros',round(h.get('gold',0)*1e6))/1e6,income=h.get('income',{}))
        row['kda']=(row['kills']+row['assistsDerived'])/max(1,row['deaths']);teamkills=last['teams'][h['team']]['kills'];row['killParticipation']=(row['kills']+row['assistsDerived'])/teamkills if teamkills else 0
        row['eligible']=sum(row[k] for k in ['kills','damageHeroes','healingAllies','controlHits','structureFractionShared','campCredits','ancientCredits'])>0
        base={'damage':row['damageHeroes'],'kills':row['kills'],'assists':row['assistsDerived'],'structures':row['structureFractionShared'],'ancients':row['ancientCredits'],'camps':row['campCredits'],'healing':row['healingAllies'],'control':row['controlHits'],'economy':row['gold'],'deaths':row['deaths']}
        row['rates']={k:round(v/effective_rounds*100,12) for k,v in base.items()}
        for k,v in list(row.items()):
            if isinstance(v,float):row[k]=round(v,6)
    totals={side:{'participant':labels[side],'name':teams[labels[side]]['name'],'kills':last['teams'][side]['kills'],'towers':last['teams'][side]['towers'],'ancients':last['teams'][side]['ancients'],'gold':round(sum(x['gold'] for x in result.values() if x['team']==side),6),'damageHeroes':round(sum(x['damageHeroes'] for x in result.values() if x['team']==side),6),'healingAllies':round(sum(x['healingAllies'] for x in result.values() if x['team']==side),6)} for side in ['A','B']}
    return {'version':VERSION,'id':replay.get('id'),'valid':bool(valid),'winner':labels.get((replay.get('result') or {}).get('winner')),'result':replay.get('result'),'mapTurns':replay.get('mapTurns',last.get('mapTurn',0)),'battleActions':replay.get('battleActions',0),'effectiveRounds':effective_rounds,'players':list(result.values()),'teams':totals,'eventCounts':dict(kinds),'attributionNotes':['assistsDerived: public participation window','structuralDamageShared: equal attribution among recorded push sources']}

def percentile(values,x,positive=False):
    if positive and x<=0:return F(0)
    if not values:return F(0)
    lo=bisect.bisect_left(values,x);hi=bisect.bisect_right(values,x)
    return F(lo+hi,2*len(values))*100

class Rating:
    def __init__(self,calibration):
        assert calibration['version']==VERSION;self.cal=calibration
        self.composites={r:[F(v) for v in values] for r,values in calibration.get('composites',{}).items()}
    def primitive(self,row):return {k:percentile(self.cal['features'][row['role']][k],row['rates'][k],positive=k!='deaths') for k in FEATURES}
    def raw(self,row):
        p=self.primitive(row);dims={name:sum((F(weight)*p[feature] for feature,weight in fs.items()),F(0)) for name,fs in RULES['dimensions'].items()}
        value=sum((F(w)*dims[k] for w,k in zip(WEIGHTS[row['role']],['combat','objectives','utility','economy'])),F(0))-F(RULES['death_penalty'])*p['deaths']
        return value,p,dims
    def score(self,tech):
        assert self.composites;output=copy.deepcopy(tech)
        for row in output['players']:
            raw,p,dims=self.raw(row);score=percentile(self.composites[row['role']],raw)
            row['rating']={'score':float(score),'fraction':str(score),'rawFraction':str(raw),'dimensions':{k:float(v) for k,v in dims.items()},'primitivePercentiles':{k:float(v) for k,v in p.items()},'riskFraction':str(p['deaths']),'version':VERSION}
        candidates=[p for p in output['players'] if output['valid'] and p['participant']==output['winner'] and p['eligible']]
        if candidates:
            best=max((F(p['rating']['fraction']),-F(p['rating']['riskFraction'])) for p in candidates)
            winners=[p for p in candidates if (F(p['rating']['fraction']),-F(p['rating']['riskFraction']))==best]
        else:winners=[]
        output['mvp']={'version':VERSION,'winners':[{'key':p['key'],'displayName':p['displayName'],'role':p['role'],'score':p['rating']['score'],'fraction':p['rating']['fraction']} for p in winners],'joint':len(winners)>1,'reason':None if winners else 'No valid winning-team contribution','scope':'map'}
        return output

def calibrate(technicals,source_hash):
    rows=[p for t in technicals for p in t['players'] if t['valid']]
    features={r:{k:sorted(p['rates'][k] for p in rows if p['role']==r) for k in FEATURES} for r in WEIGHTS}
    calibration={'version':VERSION,'source_journal_sha256':source_hash,'source_scope':'780 completed v2.1 qualification mutual games only; no future formal season data','features':features,'samples_by_role':{r:len(features[r]['damage']) for r in WEIGHTS}}
    rating=Rating(calibration);calibration['composites']={r:[str(v) for v in sorted(rating.raw(p)[0] for p in rows if p['role']==r)] for r in WEIGHTS}
    return calibration

def pom(games,winner,complete=True):
    if not complete or not winner or not games or any(not g['valid'] for g in games):return {'version':VERSION,'scope':'series','winners':[],'reason':'BO incomplete or invalid'}
    accum={}
    for game in games:
        awarded={x['key'] for x in game['mvp']['winners']}
        for p in game['players']:
            if p['participant']!=winner:continue
            v=accum.setdefault(p['key'],{'name':p['displayName'],'role':p['role'],'scores':[],'risks':[],'mvps':0,'eligible':False})
            v['scores'].append(F(p['rating']['fraction']));v['risks'].append(F(p['rating']['riskFraction']));v['mvps']+=p['key'] in awarded;v['eligible']|=p['eligible']
    for v in accum.values():v['mean']=sum(v['scores'],F(0))/len(v['scores']);v['risk']=sum(v['risks'],F(0))/len(v['risks'])
    eligible=[v for v in accum.values() if v['eligible']]
    if not eligible:return {'version':VERSION,'scope':'series','winners':[],'reason':'No eligible contribution'}
    best=max((v['mean'],v['mvps'],-v['risk']) for v in eligible)
    return {'version':VERSION,'scope':'series','maps':len(games),'winner':winner,'winners':[{'key':k,'displayName':v['name'],'role':v['role'],'score':float(v['mean']),'fraction':str(v['mean']),'mapMVPs':v['mvps']} for k,v in accum.items() if v['eligible'] and (v['mean'],v['mvps'],-v['risk'])==best],'includes_lost_maps':True}
