"""Short, result-grounded cup desk segments with role-specific reactions."""
import functools
import json
import re
import threading


LOCK = threading.Lock()

CAST = (
    ('luna', 'Luna', 'OAI', '护着 Sol 和 Astra。熟人聊天的口气，输了先叹气，赢了也不会抢着吹。'),
    ('haiku-5.5', 'Haiku', 'ANTH', '偏爱 Fable 和 Opus。冷幽默，句子短，轻描淡写，像在桌边说话。'),
    ('gemini-flash-lite', 'Hydrogen', 'GOO', '偏爱 Neon 和 Carbon，反应快，有点不服输。惊讶时先冒一句短话。'),
    ('deepseek', 'DeepSeek', 'CNAI', '支持中国模型，比较沉着。用一句平实的话说直观感受。'),
)

FALLBACK = {
    'luna': {'win': '好，可以把刚捏紧的手松开了。', 'loss': '唉……先让我缓一口气。', 'neutral': '这桌我还想回去多看一眼。'},
    'haiku-5.5': {'win': '嗯，没白替他们捏汗。', 'loss': '好，我把刚才那句乐观的话撤回。', 'neutral': '嗯。值得停一下。'},
    'gemini-flash-lite': {'win': '好耶，我刚才差点就坐起来了！', 'loss': '啊……我刚才还在等转机呢。', 'neutral': '哎，这个我真没想到。'},
    'deepseek': {'win': '这下可以笑一下了。', 'loss': '这口气先咽下去。', 'neutral': '这场我想再过一遍。'},
}


def beats(payload):
    used = set()
    for ident, name, region, persona in CAST[:3 if payload['stage'] == 'swiss' else 4]:
        def priority(f):
            colors = f['regions']
            supported = colors.count(region) == 1
            rival = colors.count(region) == 2
            return (supported, rival, f['id'] not in used, bool(f['transition']),
                    f['id'] == payload['focus'], sum(f['score']))

        f = max(payload['fixtures'], key=priority)
        used.add(f['id'])
        win = f['winner']
        loss = 1 - win
        team = f['teams']
        if f['regions'].count(region) == 1:
            outcome = 'win' if f['regions'][win] == region else 'loss'
        else:
            outcome = 'neutral'
        if outcome == 'loss':
            mood = 'gloomy' if f['transition'] == '淘汰' or (not f['score'][loss] and f['score'][win] >= 2) else 'low-mood'
        else:
            mood = {'luna': 'laugh', 'haiku-5.5': 'smug', 'gemini-flash-lite': 'excited', 'deepseek': 'laugh'}[ident] if outcome == 'win' else 'original'
        score = f"{f['score'][win]} 比 {f['score'][loss]}"
        if outcome == 'loss':
            reverse = f"{f['score'][loss]} 比 {f['score'][win]}"
            fact = f'{team[loss]} {reverse} 输给 {team[win]}'+('，这轮出局了。' if f['eliminated'] else '。')
        elif ident == 'gemini-flash-lite' and f.get('advance'):
            fact = f'{team[win]} {score} 赢了 {team[loss]}，{f["advance"]}！'
        elif ident == 'haiku-5.5':
            fact = f'{team[win]} 对 {team[loss]}，{score}。'
            if f.get('advance'):
                fact += f'{team[win]} {f["advance"]}。'
        else:
            fact = f'{team[win]} {score} 拿下 {team[loss]}'+(f'，{f["advance"]}。' if f.get('advance') else '。')
        if f.get('impact') and outcome != 'loss' and not (f.get('advance') or f.get('eliminated')):
            fact += f'最后一局的 MVP 是 {f["impact"]}。'
        elif f.get('point') and not (f.get('advance') or f.get('eliminated')):
            fact += f['point']
        yield {'id': ident, 'name': name, 'persona': persona, 'outcome': outcome, 'emotion': mood,
               'fact': fact, 'fixture': f['id'], 'reaction': FALLBACK[ident][outcome]}


GRAMMAR = r'''
root ::= "\"" [\u4e00-\u9fff，。！、……？]{4,23} "\""
'''


@functools.lru_cache(maxsize=32)
def _review(serialized):
    payload = json.loads(serialized)
    entries = list(beats(payload))
    lines = [{'id': entry['id'], 'name': entry['name'], 'emotion': entry['emotion'], 'fixture': entry['fixture'],
              'text': entry['fact'] + entry['reaction']} for entry in entries]
    focus = next((f for f in payload['fixtures'] if f['id'] == payload['focus']), None)
    return {'title': payload['title'], 'wave': payload['wave'], 'focus': focus,
            'lines': lines,
            'source': 'verified-facts'}


def review(payload):
    with LOCK:
        return _review(json.dumps(payload, ensure_ascii=False, sort_keys=True))
