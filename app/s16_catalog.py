"""Demo lineups for new games, with official player IDs for archived replays."""
from functools import lru_cache
import json
import subprocess

import competition as c


ENGINE = c.ROOT / 'referee/judge-engine.cjs'
REGIONS = {'gpt-6.2': 'OAI', 'claude-': 'ANTH', 'google/': 'GOO', 'grok-': 'XAI', 'upstage/': 'ICK'}


def team(ident, label, model, core, ids):
    region = next((tag for prefix, tag in REGIONS.items() if model.startswith(prefix)), 'CNAI')
    return {'id': ident, 'name': label, 'region': region, 'coreRole': core,
            'players': [{'role': role, 'id': ids[role], 'displayName': ids[role]} for role in c.ROLES]}


@lru_cache(maxsize=1)
def programs():
    root = c.DATA / 'demo-lineups'
    command = "process.stdout.write(JSON.stringify(require('./examples/squads.cjs').demoEntries()))"
    result = subprocess.run([c.NODE, '-e', command], cwd=c.ROOT, capture_output=True,
                            check=True, timeout=15, creationflags=c.NO_WINDOW)
    entries = {}
    for row in json.loads(result.stdout):
        info = row['info']
        ident, label, roster = info['id'], info['label'], info['roster']
        path = root / f'{ident}.json'
        c.save(path, {'candidate': row['files'], 'rosters': {'candidate': roster}})
        entries[ident] = {'id': ident, 'kind': 'squad-s16', 'name': label, 'ruleset': 's16',
                          'path': str(path), 'digest': info['digest'],
                          'team': team(ident, label, info['model'], roster['coreRole'], roster['playerIds'])}
    return entries


def cup_teams():
    original = c.read(c.ROOT / 'results/teams.json')
    teams = {r['id']: team(r['id'], r['label'], r['model'], r['coreRole'], r['playerIds']) for r in original}
    return teams | {ident: row['team'] for ident, row in programs().items()}
