"""Shared process, replay, and file helpers for the local arena."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

import psutil


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.local'
ANALYTICS = Path(__file__).with_name('analytics')
NODE = shutil.which('node')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
ROLES = {'top': '上路', 'jungle': '打野', 'mid': '中路', 'adc': '射手', 'support': '辅助'}
SAFE = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]{0,90}')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode='w', encoding='utf-8') as stream:
        temp = Path(stream.name)
        json.dump(data, stream, ensure_ascii=False, separators=(',', ':'))
    try:
        for attempt in range(100):
            try:
                os.replace(temp, path)
                return
            except PermissionError:
                if attempt == 99:
                    raise
                time.sleep(.01)
    finally:
        temp.unlink(missing_ok=True)


def identity(pid):
    process = psutil.Process(pid)
    return {'pid': pid, 'exe': process.exe(), 'created_epoch': process.create_time(), 'cwd': process.cwd()}


def alive(record):
    if record is None:
        return False
    try:
        current = identity(record['pid'])
    except psutil.Error:
        return False
    return current == record


def frames(path):
    if not path.is_file():
        return []
    raw = path.read_bytes()
    last_line = raw.rfind(b'\n')
    return [json.loads(line) for line in raw[:last_line+1].splitlines()]
