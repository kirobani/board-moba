import copy
import gzip
import json
import secrets
import subprocess
import threading
import time
import unicodedata
from pathlib import Path

import competition as c
import s16_catalog

STREAM = Path(__file__).with_name('sandbox-s16-worker.cjs')
ACTIONS = {'wait','move','attack','spell','reap','capture','push','heal','control','recall','teleport','engage'}

def clean(frame):
    return {k: copy.deepcopy(v) for k, v in frame.items() if not k.startswith('_') and k != 'seed'}

class Sandbox:
    def __init__(self, root):
        self.slots = threading.Semaphore(2)
        self.root=root;self.root.mkdir(exist_ok=True);self.lock=threading.RLock();self.jobs={};self.packets={};self.pending=set();self.connection_errors=set()
        self.programs = s16_catalog.programs()
    def catalog(self):
        return [{**{k:v for k,v in p.items() if k in ['id','name','kind','region']},
                 'ruleset':p.get('ruleset','legacy')} for p in self.programs.values()]
    def folder(self,ident):
        if not c.SAFE.fullmatch(ident):raise ValueError('沙盒编号无效')
        return self.root/ident
    @staticmethod
    def apply_human_ids(state,names):
        if not isinstance(names,dict) or set(names)-{'A','B'}:raise ValueError('请按蓝方、红方填写人类选手ID')
        state['teams']=copy.deepcopy(state['teams']);saved=copy.deepcopy(state.get('humanIds',{}))
        for side,values in names.items():
            if state['controllers'].get(side)!='human':raise ValueError('只能修改人类控制方的选手ID')
            if not isinstance(values,dict) or set(values)-set(c.ROLES):raise ValueError('选手位置无效')
            for role,value in values.items():
                if not isinstance(value,str):raise ValueError('选手ID请填写文字')
                value=value.strip()
                if len(value)>24 or any(unicodedata.category(ch).startswith('C') for ch in value):raise ValueError('选手ID最多24个字符，请勿包含换行或控制字符')
                player=next(p for p in state['teams'][side]['players'] if p['role']==role)
                player.update(id=value or c.ROLES[role],displayName=value or '人类'+side+'.'+c.ROLES[role]);saved.setdefault(side,{})[role]=value
            ids=[p['displayName'].casefold() for p in state['teams'][side]['players']]
            if len(set(ids))!=len(ids):raise ValueError('同一队的五位选手请使用不同ID')
        state['humanIds']=saved
        return state
    def rename(self,ident,data):
        with self.lock:
            state=self.apply_human_ids(self.state(ident),data.get('humanIds'))
            c.save(self.folder(ident)/'human-player-ids.json',{'version':1,'humanIds':state['humanIds'],'updated_epoch':time.time()})
            return self.public(ident)
    def create(self,data):
        with self.lock:
            if len(self.pending)+sum(p.poll() is None for p in self.jobs.values())>=2:raise ValueError('已有两场沙盒运行中，请先完成或结束其中一场')
            ident='sandbox-'+time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(3);folder=self.folder(ident);labels={};controllers={};teams={}
            selected={self.programs.get(data.get(side),{}).get('ruleset','legacy')
                      for side in ('A','B') if data.get(side)!='human'}
            ruleset=data.get('ruleset') or next(iter(selected),'s16')
            if ruleset != 's16' or selected-{ruleset}:
                raise ValueError('请选择使用同一套规则的程序')
            for side in ['A','B']:
                name=data.get(side)
                if name=='human':controllers[side]={'kind':'human'};labels[side]='human-'+side;teams[side]={'id':labels[side],'name':'人类 '+side,'players':[{'role':r,'id':n,'displayName':'人类'+side+'.'+n} for r,n in c.ROLES.items()]}
                else:
                    if name not in self.programs:raise ValueError('请选择已有程序或人类控制')
                    p=self.programs[name]
                    if p['kind']=='submission':assert c.sha(Path(p['path']))==p['sha256']
                    controllers[side]={k:p[k] for k in ['kind','path','style','variant','digest'] if k in p};labels[side]=name;teams[side]=p.get('team',{'id':name,'name':p['name'],'players':[{'role':r,'id':n,'displayName':p['name']+'.'+n} for r,n in c.ROLES.items()]})
            seed=str(data.get('seed') or secrets.token_hex(16))[:100]
            worker=STREAM
            state={'id':ident,'name':str(data.get('name') or '自由沙盒')[:60],'created':time.time(),'status':'queued','ruleset':ruleset,'labels':labels,'teams':teams,'controllers':{s:controllers[s]['kind'] for s in ['A','B']},'engine_sha256':c.sha(s16_catalog.ENGINE),'seed':seed}
            self.apply_human_ids(state,data.get('humanIds',{}));folder.mkdir()
            c.save(folder/'state.json',state);c.save(folder/'control.json',{'paused':False,'delayMs':max(0,min(2000,int(data.get('delayMs',120)))),'step':0})
            job={'id':ident,'seed':seed,'budgetMs':2000,'replay':True,'config':{},**controllers,'livePath':str(folder/'frames.jsonl'),'controlPath':str(folder/'control.json'),'requestPath':str(folder/'request.json')};c.save(folder/'intent.json',{'job':job,'engine_sha256':state['engine_sha256'],'worker_sha256':c.sha(worker)})
            self.pending.add(ident);threading.Thread(target=self.run,args=(ident,job,worker),daemon=True).start();return self.public(ident)
    def run(self, ident, job, worker):
        folder=self.folder(ident)
        try:
            with self.slots,(folder/'stdout.json').open('wb') as output,(folder/'stderr.txt').open('wb') as error:
                p=subprocess.Popen([str(c.NODE),'--max-old-space-size=512',str(worker)],cwd=folder,stdin=subprocess.PIPE,stdout=output,stderr=error,creationflags=c.NO_WINDOW)
                with self.lock:self.pending.discard(ident);self.jobs[ident]=p
                s=c.read(folder/'state.json');s.update(status='running',process=c.identity(p.pid));c.save(folder/'state.json',s);p.stdin.write((json.dumps(job)+'\n').encode());p.stdin.flush();code=p.wait()
                if code:raise RuntimeError('沙盒进程异常结束，原始输出已保留')
            raw=c.read(folder/'stdout.json');assert raw['engineSha256']==s['engine_sha256'] and raw['frames']
            with gzip.open(folder/'replay.json.gz','wb',compresslevel=6) as stream:stream.write((folder/'stdout.json').read_bytes())
            s.update(status='completed' if raw.get('status')=='completed' and not raw['faults'] and raw.get('result') else 'technical_hold',completed=time.time(),replay_sha256=c.sha(folder/'replay.json.gz'),faults=raw['faults']);c.save(folder/'state.json',s)
        except Exception as e:
            s=c.read(folder/'state.json');s.update(status='stopped' if c.read(folder/'control.json').get('stop') else 'technical_hold',error=str(e)[:200]);c.save(folder/'state.json',s)
        finally:
            with self.lock:
                self.pending.discard(ident);p=self.jobs.pop(ident,None)
                if p and p.stdin:p.stdin.close()
    def state(self,ident):
        with self.lock:
            s=c.read(self.folder(ident)/'state.json')
            names=self.folder(ident)/'human-player-ids.json'
            if names.exists():self.apply_human_ids(s,c.read(names)['humanIds'])
            if s['status'] not in ['queued','running']:return s
            p=self.jobs.get(ident)
            connected=p is not None and p.poll() is None and bool(p.stdin) and c.alive(s.get('process'))
            pending=s['status']=='queued' and (ident in self.pending or (p is not None and p.poll() is None))
            if ident in self.connection_errors or not (connected or pending):
                s.update(status='interrupted',interrupted=True,message='对局连接已断开，本局不能继续提交指令。已保留画面，可回放或新建沙盒。')
            return s
    def list(self):return [{k:s.get(k) for k in ['id','name','status','created','ruleset','controllers','message']} for p in sorted(self.root.glob('*/state.json'),reverse=True) for s in [self.state(p.parent.name)]]
    def public(self,ident):
        folder=self.folder(ident);s=self.state(ident);frames=c.frames(folder/'frames.jsonl');request=c.read(folder/'request.json') if (folder/'request.json').exists() else {};s.pop('process',None)
        if s['status'] not in ['queued','running']:request={'waiting':False,'done':True}
        if frames:
            last=frames[-1];s['game']={'id':ident,'format':'full-frames-v1','frames':[clean(f) for f in frames],'labels':s['labels'],'result':last.get('result'),'config':last['config'],'turns':last['turn'],'mapTurns':last.get('mapTurn',0),'battleActions':(last.get('battle') or {}).get('actions',0)}
        s['request']=request;s['control']=c.read(folder/'control.json');s['submittedSides']=list(self.packets.get((ident,request.get('turn')),{}));return s
    def command(self,ident,data):
        with self.lock:
            folder=self.folder(ident);s=self.state(ident)
            if s.get('interrupted'):raise ValueError(s['message'])
            request=c.read(folder/'request.json');side=data.get('side');turn=data.get('turn');orders=data.get('orders')
            if s['status']!='running' or not request.get('waiting') or turn!=request['turn'] or side not in request['teams'] or s['controllers'].get(side)!='human':raise ValueError('现在不是这一方的操作回合')
            p=self.jobs.get(ident)
            if not p or p.poll() is not None or not p.stdin or not c.alive(s.get('process')):raise ValueError('对局连接已断开，指令未提交；已保留记录，请新建沙盒。')
            if not isinstance(orders,list) or len(orders)>5:raise ValueError('每回合最多提交五位英雄的指令')
            obs=request['observations'][side];modern=s.get('ruleset')=='s16'
            units={h['id']:h for h in obs['heroes'] if h['team']==side};seen=set()
            def tile(value):
                return isinstance(value,list) and len(value)==2 and all(type(n) is int and abs(n)<=50 for n in value)
            for o in orders:
                if not isinstance(o,dict) or o.get('unit') not in units or o.get('unit') in seen or o.get('action') not in ACTIONS:raise ValueError('英雄或指令无效')
                seen.add(o['unit'])
                if set(o)-{'unit','action','target','to','lane','cells'}:raise ValueError('指令字段无效')
                if 'to' in o and not tile(o['to']):raise ValueError('坐标无效')
                if 'cells' in o:
                    cells=o['cells'];required=3 if modern else 2
                    if o['action']!='spell' or not isinstance(cells,list) or len(cells)!=required or not all(map(tile,cells)):
                        raise ValueError(f'法术需要 {required} 个合法格子')
                    if modern and not any(sorted(cells)==sorted(combination) for combination in units[o['unit']].get('spellTargets',[])):
                        raise ValueError('请选择互相连通且在法术范围内的三个格子')
            coach=data.get('coach')
            if coach is not None and (not modern or obs['phase']!='map' or not isinstance(coach,dict)
                    or set(coach)!={'unit','action','to'} or coach['action']!='coach_engage'
                    or coach['unit'] not in units or not units[coach['unit']].get('coachEngageAvailable') or not tile(coach['to'])):
                raise ValueError('教练开团指令无效')
            packet=self.packets.setdefault((ident,turn),{});
            if side in packet:raise ValueError('这一方本回合已提交')
            packet[side]={'orders':orders,**({'coach':coach} if coach is not None else {})}
            if all(t in packet for t in request['teams']):
                request['waiting']=False;c.save(folder/'request.json',request)
                try:p.stdin.write((json.dumps({'turn':turn,'commands':packet})+'\n').encode());p.stdin.flush()
                except (OSError,ValueError):
                    self.connection_errors.add(ident);self.packets.pop((ident,turn),None)
                    raise ValueError('提交时对局连接中断，已保留记录；请新建沙盒，本局不会自动重打。')
                self.packets.pop((ident,turn),None)
            return {'accepted':True,'turn':turn,'side':side}
    def control(self,ident,data):
        with self.lock:
            p=self.folder(ident)/'control.json';ctl=c.read(p)
            if 'paused' in data:ctl['paused']=data['paused'] is True
            if 'delayMs' in data:ctl['delayMs']=max(0,min(2000,int(data['delayMs'])))
            if data.get('step'):ctl['paused']=True;ctl['step']+=1
            if data.get('stop'):ctl['stop']=True
            c.save(p,ctl)
            if data.get('stop'):
                proc=self.jobs.get(ident)
                if proc and proc.poll() is None:
                    try:proc.stdin.write(b'{"stop":true}\n');proc.stdin.flush()
                    except (OSError,BrokenPipeError):pass
            return ctl
