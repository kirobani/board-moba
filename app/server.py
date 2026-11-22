"""Loopback-only server for the board MOBA cup, replays, and sandbox."""
import argparse
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import subprocess
from urllib.parse import parse_qs, unquote, urlsplit

import competition as c
from cup import Cups
from sandbox import Sandbox


WEB = c.ROOT / 'web'
RESULTS = c.ROOT / 'results'
live_cups = Cups(c.DATA / 'cups')
archives = Cups(c.ROOT / 'archives/cups')


class Handler(BaseHTTPRequestHandler):
    def is_local(self):
        host = self.headers.get('Host', '')
        return host.split(':', 1)[0] in {'localhost', '127.0.0.1'}

    def send_bytes(self, raw, content_type, status=200):
        if len(raw) > 4096 and 'gzip' in self.headers.get('Accept-Encoding', '') and content_type.startswith(('text/', 'application/json', 'application/javascript')):
            raw = gzip.compress(raw, compresslevel=3)
            compressed = True
        else:
            compressed = False
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if compressed:
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def json(self, result, status=200):
        self.send_bytes(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode(),
                        'application/json; charset=utf-8', status)

    def log_message(self, template, *args):
        if args and len(args) >= 2 and str(args[1]).startswith('5'):
            super().log_message(template, *args)

    def file(self, path):
        if path == '/':
            path = '/index.html'
        base = RESULTS if path.startswith('/results/') else WEB
        relative = path.removeprefix('/results/') if base == RESULTS else path.lstrip('/')
        candidate = (base / relative).resolve()
        if not candidate.is_relative_to(base) or any(part.startswith('.') for part in Path(relative).parts):
            return self.send_error(404)
        if not candidate.is_file() or candidate.suffix not in {'.html', '.css', '.js', '.json', '.csv', '.md'}:
            return self.send_error(404)
        kind = 'text/javascript' if candidate.suffix == '.js' else mimetypes.guess_type(candidate)[0]
        if not kind or candidate.suffix == '.md':
            kind = 'text/plain'
        self.send_bytes(candidate.read_bytes(), kind + '; charset=utf-8')

    def do_GET(self):
        if not self.is_local():
            return self.send_error(403)
        url = urlsplit(self.path)
        path = unquote(url.path).rstrip('/')
        segments = path.lstrip('/').split('/')
        query = parse_qs(url.query)
        try:
            if path == '/api/health':
                return self.json({'ok': True, 'ruleset': 's16'})
            if path == '/api/arena':
                return self.json({'programs': self.server.sandbox.catalog(), 'sandboxes': self.server.sandbox.list()})
            if path == '/api/cups':
                return self.json({'cups': live_cups.index()['cups'] + archives.index()['cups']})
            if segments[:2] == ['api', 'sandbox'] and len(segments) == 3:
                return self.json(self.server.sandbox.public(segments[2]))
            if segments[:2] == ['api', 'cups'] and len(segments) >= 3:
                ident, *rest = segments[2:]
                cups = archives if (archives.folder(ident) / 'state.json').is_file() else live_cups
                if not rest:
                    return self.json(cups.public(ident))
                if len(rest) == 3 and rest[0] == 'replay':
                    return self.json(cups.replay(ident, rest[1], int(rest[2])))
                if len(rest) == 3 and rest[0] == 'postgame':
                    return self.json(cups.postgame(ident, rest[1], int(rest[2]), query.get('proof', [''])[0]))
                if len(rest) == 2 and rest[0] == 'review':
                    return self.json(cups.round_review(ident, rest[1]))
                if len(rest) == 2 and rest[0] == 'live' and cups is live_cups:
                    return self.json(cups.live(ident, rest[1], query))
            if segments[0] == 'api':
                return self.json({'error': '页面不存在'}, 404)
            return self.file(path or '/')
        except FileNotFoundError:
            self.json({'error': '记录不存在'}, 404)
        except (ValueError, KeyError, OSError, AssertionError):
            self.json({'error': '比赛记录暂时不可用'}, 409)

    def do_POST(self):
        if not self.is_local():
            return self.send_error(403)
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            return self.send_error(403)
        if self.headers.get_content_type() != 'application/json':
            return self.send_error(415)
        segments = unquote(urlsplit(self.path).path).strip('/').split('/')
        try:
            size = int(self.headers['Content-Length'])
            if not 0 < size <= 32_768:
                return self.send_error(413)
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('JSON 必须是对象')
            if segments == ['api', 'cups']:
                return self.json(live_cups.create(body))
            if segments == ['api', 'sandboxes']:
                return self.json(self.server.sandbox.create(body))
            if len(segments) == 4 and segments[:2] == ['api', 'cups'] and segments[3] == 'action':
                return self.json(live_cups.action(segments[2], body))
            if len(segments) == 4 and segments[:2] == ['api', 'sandbox']:
                sandbox = self.server.sandbox
                action = {'input': sandbox.command, 'control': sandbox.control, 'names': sandbox.rename}.get(segments[3])
                if action:
                    return self.json(action(segments[2], body))
            self.json({'error': '操作不存在'}, 404)
        except (ValueError, KeyError, AssertionError, TypeError) as error:
            self.json({'error': str(error) or '参数无效'}, 409)
        except (OSError, subprocess.SubprocessError):
            self.json({'error': '本地演算暂时不可用'}, 409)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18860)
    args = parser.parse_args()
    if not c.NODE:
        parser.error('Node.js 24 must be available on PATH')
    c.DATA.mkdir(exist_ok=True)
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        server.sandbox = Sandbox(c.DATA / 'sandbox')
        print(f'http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
