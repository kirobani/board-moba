"""Publish Swiss cup schedules, live tables and replays without exposing sealed results."""
import functools
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.parse
from pathlib import Path

import competition as league
import cup_review
import technical as tech
from s16_catalog import cup_teams


ROOT = league.DATA / 'cups'
RUNNER = Path(__file__).with_name('cup-runner.cjs')
MODES = {'test', 'sealed', 'realtime'}
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,55}')
STOPPED = {'technical_hold', 'verification_hold'}


def draw_order(state, wave):
    fixtures = wave['fixtures']
    if wave['id'] == 'R1':
        return sorted(fixtures, key=lambda f: min(state['teams'][t]['pool'] for t in f['teams']))
    if wave['stage'] == 'swiss':
        return sorted(fixtures, key=lambda f: f['record'], reverse=True)
    if wave['id'] == 'QF':
        return sorted(fixtures, key=lambda f: f['id'] not in {'QF-1', 'QF-3'})
    return fixtures


def draw_seats(state, wave):
    ident = wave['id']
    fixtures = wave['fixtures']
    if ident == 'R1':
        pockets = {f'pool-{n}': [] for n in range(1, 5)}
    elif ident == 'QF':
        pockets = {'3–0': [], '3–2': [], 'mixed': []}
    elif wave['stage'] == 'knockout':
        pockets = {'qualified': []}
    else:
        records = ({f['record'] for f in fixtures} if fixtures else
                   {f"{r['wins']}–{r['losses']}" for r in state['records'].values() if max(r.values()) < 3})
        pockets = {record: [] for record in sorted(records, reverse=True)}
    for f in fixtures:
        for side, team in enumerate(f['teams']):
            if ident == 'R1':
                pocket = f"pool-{state['teams'][team]['pool']}"
            elif ident == 'QF':
                pocket = ('3–0', '3–2')[side] if f['id'] in {'QF-1', 'QF-3'} else 'mixed'
            else:
                pocket = f.get('record', 'qualified')
            pockets[pocket].append((f'{f["id"]}:{side}', team))
    sequence = [f'{f["id"]}:{side}' for f in draw_order(state, wave) for side in range(2)]
    return pockets, sequence


def pending_count(state, wave, pocket):
    ident = wave['id']
    if ident == 'R1':
        return 4
    if ident == 'QF':
        return 4 if pocket == 'mixed' else 2
    if ident in {'SF', 'GF'}:
        return 4 if ident == 'SF' else 2
    return sum(f"{r['wins']}–{r['losses']}" == pocket for r in state['records'].values())


def read(path):
    for attempt in range(4):
        try:
            return json.loads(path.read_text('utf-8'))
        except PermissionError:
            if attempt == 3:
                raise
            time.sleep(0.02)


@functools.lru_cache(maxsize=1)
def teams():
    return cup_teams()


@functools.lru_cache(maxsize=1)
def rating():
    return tech.Rating(read(league.ANALYTICS / 'calibration.json'))


def team_overrides(row):
    overrides = {}
    for side in ('A', 'B'):
        entry = teams()[row[side]]
        overrides[side] = {'participant': row[side], 'team': entry['name'], 'region': entry['region'],
                           'players': {p['role']: p['id'] for p in entry['players']}}
    return overrides


class Cups:
    def __init__(self, root=ROOT):
        self.root = root
        self.lock = threading.RLock()
        self.processes = {}
        self.stream_key = secrets.token_bytes(32)

    def folder(self, ident):
        if not isinstance(ident, str) or not ID.fullmatch(ident):
            raise ValueError('杯赛编号无效')
        folder = (self.root / ident).resolve()
        if folder.parent != self.root.resolve():
            raise ValueError('杯赛目录无效')
        return folder

    def load(self, ident):
        folder = self.folder(ident)
        state = read(folder / 'state.json')
        process = self.processes.get(ident)
        locked = (folder / 'runner.lock').is_file()
        if process is not None:
            code = process.poll()
            if code is None:
                if state['status'] == 'ready':
                    state['status'] = 'running'
            else:
                self.processes.pop(ident, None)
                if code and state['status'] in {'ready', 'running'}:
                    state['status'] = 'technical_hold'
                    state['message'] = '演算进程异常退出，比赛记录已保留。'
                    target = folder / 'interruption.json'
                    if not target.exists():
                        target.write_text(json.dumps({'exitCode': code}), encoding='utf-8')
        if state['status'] in {'ready', 'running'} and (folder / 'interruption.json').exists():
            state['status'] = 'technical_hold'
        if state['status'] == 'running' and not locked and process is None:
            state = read(folder / 'state.json')
            if state['status'] == 'running' and not (folder / 'runner.lock').exists():
                state['status'] = 'technical_hold'
        return state

    def publication(self, ident):
        folder = self.folder(ident)
        file = folder / 'publication.json'
        return read(file) if file.exists() else {'revealed': 0, 'focus': None}

    def publish(self, ident, publication):
        folder = self.folder(ident)
        temp = folder / ('publication-' + secrets.token_hex(6) + '.tmp')
        temp.write_text(json.dumps(publication), encoding='utf-8')
        os.replace(temp, folder / 'publication.json')

    @staticmethod
    def summary(state, revealed):
        return {k: state[k] for k in ('id', 'name', 'mode', 'createdAt', 'status')} | {
            'verified': state['status'] == 'complete-verified', 'revealed': revealed,
            'settled': sum(f['status'] == 'complete' for w in state['waves'] for f in w['fixtures']),
            'total': 40,
        }

    def index(self):
        with self.lock:
            cups = []
            for file in self.root.glob('*/state.json'):
                if not ID.fullmatch(file.parent.name):
                    continue
                state = self.load(file.parent.name)
                cups.append(self.summary(state, self.publication(state['id'])['revealed']))
            cups.sort(key=lambda s: s['id'], reverse=True)
            return {'cups': cups}

    @staticmethod
    def done(wave):
        return bool(wave['fixtures']) and all(f['status'] == 'complete' for f in wave['fixtures'])

    @staticmethod
    def drawn(state, publication, wave):
        if not state.get('manualDraw'):
            return True
        slots = publication.get('draws', {}).get(wave['id'], [])
        return bool(wave['fixtures']) and len(slots) == 2 * len(wave['fixtures'])

    def draw_view(self, state, publication, wave):
        if not state.get('manualDraw'):
            return None
        slots = publication.get('draws', {}).get(wave['id'], [])
        shown = set(slots)
        pockets, sequence = draw_seats(state, wave)
        next_slot = next((slot for slot in sequence if slot not in shown), None)
        next_pocket = next(iter(pockets), None) if not wave['fixtures'] else None
        groups = []
        last = None
        for key, seats in pockets.items():
            total = len(seats) if wave['fixtures'] else pending_count(state, wave, key)
            remaining = sum(slot not in shown for slot, _ in seats) if wave['fixtures'] else total
            blocked = key == 'mixed' and (not wave['fixtures'] or any(slot not in shown for slot, _ in pockets['3–2']))
            groups.append({'id': key, 'total': total, 'remaining': remaining, 'blocked': blocked})
            for slot, team in seats:
                if slot == next_slot:
                    next_pocket = key
                if slots and slot == slots[-1]:
                    match, side = slot.split(':')
                    last = {'team': team, 'pocket': key, 'fixture': match, 'side': int(side)}
        return {'wave': wave['id'], 'title': wave['title'], 'pockets': groups, 'last': last, 'nextPocket': next_pocket,
                'step': len(slots), 'complete': self.drawn(state, publication, wave)}

    def visible(self, ident):
        state = self.load(ident)
        publication = self.publication(ident)
        shown = publication['revealed']
        waves = state['waves'] if state['mode'] == 'test' else state['waves'][:shown+1]
        return state, publication, waves

    def public(self, ident):
        with self.lock:
            state, publication, waves = self.visible(ident)
            revealed, focus = publication['revealed'], publication['focus']
            test = state['mode'] == 'test'
            sealed = state['mode'] == 'sealed'
            view = []
            for i, wave in enumerate(waves):
                drawn = self.drawn(state, publication, wave)
                drawn_slots = publication.get('draws', {}).get(wave['id'], [])
                done = drawn and self.done(wave)
                open_round = drawn and (test or i < revealed)
                fixtures = []
                ordered = draw_order(state, wave) if state.get('manualDraw') and wave['stage'] == 'swiss' else wave['fixtures']
                for f in ordered:
                    item = {k: f[k] for k in ('id', 'teams', 'bestOf')}
                    if 'record' in f:
                        item['record'] = f['record']
                    if not drawn:
                        item['teams'] = [side if f'{f["id"]}:{j}' in drawn_slots else None for j, side in enumerate(f['teams'])]
                        fixtures.append(item)
                        continue
                    if open_round:
                        item.update(winner=f['winner'], star=f.get('star', False), status=f['status'],
                                    score=[sum(g['winner'] == side for g in f['games']) for side in f['teams']])
                    elif not sealed:
                        item['status'] = f['status']
                    if open_round:
                        item['games'] = len(f['games'])
                    fixtures.append(item)
                view.append({k: wave[k] for k in ('id', 'stage', 'title')} | {
                    'revealed': open_round, 'complete': done, 'drawn': drawn, 'fixtures': fixtures,
                })
            current = waves[-1]
            return self.summary(state, revealed) | {
                'teams': {ident: {k: value[k] for k in ('id', 'name', 'region', 'slot', 'pool', 'rating')}
                          for ident, value in state['teams'].items()},
                'seedBasis': state['seedBasis'], 'waves': view, 'focus': focus,
                'draw': self.draw_view(state, publication, current) if (test and not state['champion']) or revealed < len(waves) else None,
                'canStart': (not sealed or state.get('manualDraw', False)) and state['status'] == 'ready' and
                            current == state['waves'][-1] and self.drawn(state, publication, current),
                'canReveal': not test and revealed < len(waves) and self.drawn(state, publication, waves[revealed]) and self.done(waves[revealed]),
                'champion': state['champion'] if test or revealed == len(state['waves']) else None,
                'needsAttention': state['status'] in STOPPED,
            }

    def spawn(self, ident, command, *args):
        folder = self.folder(ident)
        if ident in self.processes or (folder / 'runner.lock').exists():
            raise ValueError('这一届正在演算')
        self.processes[ident] = subprocess.Popen([str(league.NODE), str(RUNNER), command, str(folder), *args],
            cwd=RUNNER.parent, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=league.NO_WINDOW)

    def create(self, body):
        name, mode = body.get('name'), body.get('mode')
        if not isinstance(name, str) or not name.strip() or len(name) > 60 or not isinstance(mode, str) or mode not in MODES:
            raise ValueError('请填写杯赛名称并选择有效模式')
        with self.lock:
            ident = 'cup-' + time.strftime('%Y%m%d-%H%M%S-') + secrets.token_hex(3)
            self.root.mkdir(parents=True, exist_ok=True)
            done = subprocess.run([str(league.NODE), str(RUNNER), 'create', str(self.folder(ident)), mode, name.strip(), 'manual'],
                cwd=RUNNER.parent, stdin=subprocess.DEVNULL, capture_output=True,
                creationflags=league.NO_WINDOW, timeout=20)
            if done.returncode:
                raise ValueError('创建杯赛失败，请检查冻结名单和裁判配置')
            return self.public(ident)

    def take_draw(self, ident, state, publication, wave, body):
        snapshot = self.draw_view(state, publication, wave)
        if not snapshot or snapshot['complete'] or type(body.get('step')) is not int or body['step'] != snapshot['step']:
            raise ValueError('抽签进度已变化，请刷新')
        if snapshot['nextPocket'] != body.get('pocket'):
            raise ValueError('请点击高亮的口袋，按签表顺序抽签')
        if wave.get('pendingDraw'):
            done = subprocess.run([str(league.NODE), str(RUNNER), 'plan-draw', str(self.folder(ident)), wave['id']],
                cwd=RUNNER.parent, stdin=subprocess.DEVNULL, capture_output=True,
                creationflags=league.NO_WINDOW, timeout=20)
            if done.returncode:
                raise ValueError('无法生成本轮合法配对，比赛记录已保留')
            state = self.load(ident)
            wave = state['waves'][-1]
        slots = publication.setdefault('draws', {}).setdefault(wave['id'], [])
        _, sequence = draw_seats(state, wave)
        slot = next(slot for slot in sequence if slot not in slots)
        slots.append(slot)
        self.publish(ident, publication)

    def action(self, ident, body):
        with self.lock:
            state, publication, waves = self.visible(ident)
            action, target = body.get('action'), body.get('target')
            shown = publication['revealed']
            current = waves[-1]
            if action == 'draw' and target == current['id'] and (state['mode'] == 'test' or shown < len(waves)):
                self.take_draw(ident, state, publication, current, body)
            elif action == 'start' and (state['mode'] in {'test', 'realtime'} or state.get('manualDraw')):
                if state['status'] != 'ready' or target != current['id'] or current != state['waves'][-1] or not self.drawn(state, publication, current):
                    raise ValueError('本轮状态已改变，请刷新')
                self.spawn(ident, 'wave', target)
            elif action == 'reveal' and state['mode'] != 'test':
                if shown >= len(waves) or waves[shown]['id'] != target or not self.drawn(state, publication, waves[shown]) or not self.done(waves[shown]):
                    raise ValueError('这一轮还不能揭晓')
                if publication['focus']:
                    publication.setdefault('reviewFocus', {})[target] = publication['focus']
                self.publish(ident, publication | {'revealed': shown+1, 'focus': None})
            elif action == 'focus' and state['mode'] != 'test':
                if shown >= len(waves) or not self.drawn(state, publication, current) or not any(f['id'] == target for f in current['fixtures']):
                    raise ValueError('焦点桌必须在当前轮次')
                if state['mode'] == 'sealed' and not self.done(current):
                    raise ValueError('本轮封存演算尚未结束')
                self.publish(ident, publication | {'revealed': shown, 'focus': target})
            else:
                raise ValueError('这项操作不适用于当前杯赛')
            return self.public(ident)

    def table(self, ident, fid, *, released=False):
        state, publication, waves = self.visible(ident)
        for i, wave in enumerate(waves):
            if not self.drawn(state, publication, wave):
                continue
            for fixture in wave['fixtures']:
                if fixture['id'] == fid and (state['mode'] == 'test' or i < publication['revealed'] or
                                             not released and fid == publication['focus']):
                    return state, fixture
        raise ValueError('本桌尚未开放观看')

    def replay(self, ident, fid, number):
        with self.lock:
            _, fixture = self.table(ident, fid, released=True)
            if not 1 <= number <= len(fixture['games']):
                raise ValueError('这局回放尚未就绪')
            row = fixture['games'][number-1]
        return {'game': self.replay_game(ident, fid, row), 'teams': team_overrides(row)}

    def replay_game(self, ident, fid, row):
        with gzip.open(self.folder(ident) / 'replays' / fid / row['replay'], 'rt', encoding='utf-8') as file:
            game = json.load(file)
        game.update(id=ident+'-'+row['id'], labels={s: row[s] for s in ('A','B')})
        return game

    def _cursor(self, ident, fid, number, kind, value):
        data = f'{ident}|{fid}|{number}|{kind}|{value}'.encode('utf8')
        return f'{value}.{hmac.new(self.stream_key, data, hashlib.sha256).hexdigest()}'

    def _position(self, ident, fid, number, cursor):
        if not cursor and number == 1:
            return 0
        if re.fullmatch(r'[0-9]{1,12}\.[a-f0-9]{64}', cursor):
            value = int(cursor.split('.')[0])
            if hmac.compare_digest(cursor, self._cursor(ident, fid, number, 'frame', value)):
                return value
        raise ValueError('请从本桌开局依次观看')

    def postgame(self, ident, fid, number, proof=''):
        with self.lock:
            allowed = re.fullmatch(r'0\.[a-f0-9]{64}', proof) and hmac.compare_digest(proof, self._cursor(ident, fid, number, 'ended', 0))
            _, fixture = self.table(ident, fid, released=not allowed)
            rows = tuple(fixture['games'])
            if not 1 <= number <= len(rows):
                raise ValueError('这局赛后数据尚未就绪')
        last = number == len(rows)
        settled = fixture['status'] == 'complete'
        def score(row):
            game = self.replay_game(ident, fid, row)
            game.setdefault('battleActions', (game['frames'][-1].get('battle') or {}).get('actions', 0))
            valid = row['outcome'] in {'win', 'loss', 'draw'}
            return rating().score(tech.analyze(game, game['labels'], teams(), valid=valid))
        technical = score(rows[number-1])
        series = None
        if settled and last and fixture['bestOf'] > 1:
            scores = [score(row) for row in rows[:-1]] + [technical]
            series = {'score': [sum(row['winner'] == team for row in rows) for team in fixture['teams']],
                      'teams': fixture['teams'], 'pom': tech.pom(scores, fixture['winner'])}
        has_next = not last or fixture['status'] not in {'complete', 'technical_hold'}
        return {'technical': technical, 'series': series, 'hasNext': has_next,
                'nextCursor': self._cursor(ident, fid, number+1, 'frame', 0) if allowed and has_next else None}

    def round_review(self, ident, wave_id):
        with self.lock:
            state, publication, waves = self.visible(ident)
            found = next(((i, w) for i, w in enumerate(waves) if w['id'] == wave_id), None)
            if not found:
                raise ValueError('本轮尚未揭晓')
            i, wave = found
            if not self.done(wave) or (state['mode'] != 'test' and i >= publication['revealed']):
                raise ValueError('本轮尚未揭晓')
            focus = publication.get('reviewFocus', {}).get(wave_id)
        fixtures = []
        for f in wave['fixtures']:
            ids = f['teams']
            record = f.get('record', '')
            advance = {'QF': '晋级半决赛', 'SF': '晋级决赛', 'GF': '夺冠'}.get(wave_id)
            if record.startswith('2–'):
                advance = '晋级八强'
            eliminated = wave['stage'] == 'knockout' or record.endswith('–2')
            item = {'id': f['id'], 'teams': [state['teams'][t]['name'] for t in ids],
                    'regions': [state['teams'][t]['region'] for t in ids], 'winner': ids.index(f['winner']),
                    'score': [sum(row['winner'] == t for row in f['games']) for t in ids],
                    'advance': advance, 'eliminated': eliminated, 'transition': '淘汰' if eliminated else advance}
            row = f['games'][-1]
            game = self.replay_game(ident, f['id'], row)
            if f['id'] == focus:
                honor = rating().score(tech.analyze(game, game['labels'], teams()))['mvp']['winners']
                if honor:
                    item['impact'] = '、'.join(member['displayName'] for member in honor)
            lead = deficit = 0
            for result in f['games']:
                if result['winner']:
                    lead += 1 if result['winner'] == f['winner'] else -1
                    deficit = min(deficit, lead)
            totals = game['frames'][-1]['teams']
            side = game['result']['winner']
            winner, loser = totals[side], totals['B' if side == 'A' else 'A']
            prefix = '最后一局' if len(f['games']) > 1 else '这一局'
            if deficit < 0:
                item['point'] = f'胜队中途还落后过 {-deficit} 局。'
            elif winner['ancients'] >= loser['ancients'] + 2:
                item['point'] = f'{prefix}胜队拿了 {winner["ancients"]} 次远古。'
            elif winner['towers'] >= loser['towers'] + 2:
                item['point'] = f'{prefix}胜队多推了 {winner["towers"]-loser["towers"]} 座塔。'
            elif winner['kills'] < loser['kills']:
                item['point'] = f'{prefix}胜队还少拿了 {loser["kills"]-winner["kills"]} 个人头。'
            fixtures.append(item)
        return cup_review.review({'title': wave['title'], 'wave': wave_id, 'stage': wave['stage'], 'fixtures': fixtures, 'focus': focus})

    @functools.lru_cache(maxsize=8)
    def _settled_feed(self, ident, fid, filename, sha):
        with gzip.open(self.folder(ident) / 'replays' / fid / filename, 'rt', encoding='utf-8') as file:
            return json.load(file)['frames']

    def live(self, ident, fid, query):
        with self.lock:
            state, fixture = self.table(ident, fid)
            number = int(query.get('game', [1])[0])
            if not 1 <= number <= len(fixture['games'])+1:
                raise ValueError('直播进度无效')
            position = self._position(ident, fid, number, query.get('cursor', [''])[0])
            row = fixture['games'][number-1] if number <= len(fixture['games']) else None
            fname = f'{fid}-m{number}'
            stream = self.folder(ident) / 'replays' / fid / (fname+'.frames.jsonl')
            has_stream = state['mode'] == 'realtime' and stream.is_file()
            if row is None and not has_stream:
                return {'waiting': True, 'done': fixture['status'] in {'complete', 'technical_hold'}}
            finished = row is not None
            if row is None:
                # Match the referee's first-side coin toss and per-game alternation.
                draw = hashlib.sha256(f"{state['drawSeed']}|side|{fid}".encode()).hexdigest()
                a, b = fixture['teams']
                A, B = (b, a) if (int(draw[:2], 16)+number-1)%2 else (a, b)
                row = {'A': A, 'B': B}
        if has_stream:
            with stream.open('rb') as file:
                size = os.fstat(file.fileno()).st_size
                file.seek(position)
                line = file.readline()
                frames = [json.loads(line)] if line.endswith(b'\n') else []
                end = file.tell() if frames else position
        else:
            saved = self._settled_feed(ident, fid, row['replay'], row['replaySha256'])
            size = len(saved)
            frames = saved[position:position+1]
            end = position+len(frames)
        done = finished and end >= size
        if not frames and not done:
            return {'waiting': True, 'done': False}
        return {'game': {'id': ident+'-'+fname, 'format': 'full-frames-v1', 'labels': {s: row[s] for s in ('A','B')},
                         'frames': frames, 'result': frames[-1].get('result') if frames else None},
                'teams': team_overrides(row), 'cursor': self._cursor(ident, fid, number, 'frame', end), 'done': done,
                'proof': self._cursor(ident, fid, number, 'ended', 0) if done else None}
