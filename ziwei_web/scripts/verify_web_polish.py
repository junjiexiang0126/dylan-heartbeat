"""Read-only post-deploy checks for the restored first UI batch; no login/model calls."""
import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='https://ziwei-home-web-test-ziwei-hermes-test.up.railway.app')
args = parser.parse_args()
base = args.base.rstrip('/')
cache = {}

def get(path):
    if path not in cache:
        with urllib.request.urlopen(base + path, timeout=20) as response:
            cache[path] = (response.status, response.headers.get_content_type(), response.read())
    return cache[path]

def text(path):
    return get(path)[2].decode('utf-8')

checks = []
def check(name, run):
    try:
        passed = bool(run())
        checks.append({'check': name, 'passed': passed})
    except Exception as error:
        checks.append({'check': name, 'passed': False, 'error': type(error).__name__})

check('1 font: 200 font/woff2, exact self-hosted bytes', lambda: get('/EBGaramond.woff2')[:2] == (200, 'font/woff2') and hashlib.sha256(get('/EBGaramond.woff2')[2]).digest() == hashlib.sha256((Path(__file__).resolve().parents[1] / 'public/EBGaramond.woff2').read_bytes()).digest())
check('2 index loads home.css', lambda: 'href="/home.css"' in text('/'))
check('3 index retains impressions.js', lambda: '/impressions.js' in text('/'))
check('4 memorial font CSS', lambda: 'MemorialSerif' in text('/home.css'))
check('5 shared message gap 6px', lambda: bool(re.search(r'\.chat-messages\{[^}]*gap:6px', text('/chat.css'))))
check('6 sender label grouping CSS', lambda: 'same-sender' in text('/chat.css'))
check('7 action log before bubble', lambda: bool(re.search(r'insertBefore\(box,\s*bubble\)', text('/chat.js'))))
check('8 expression sticker retained', lambda: get('/stickers/expressions/exp6-04.png')[0] == 200 and get('/stickers/expressions/exp6-04.png')[2].startswith(b'\x89PNG'))
# The screenshot-facing controller is a generated artifact. Verify exact deployed bytes,
# rather than assuming an updated source module means the served bundle changed.
check('9 served raven bundle matches release', lambda: hashlib.sha256(get('/raven.js')[2]).digest() == hashlib.sha256((Path(__file__).resolve().parents[1] / 'public/raven.js').read_bytes()).digest())
check('10 served chat behavior matches release', lambda: hashlib.sha256(get('/chat.js')[2]).digest() == hashlib.sha256((Path(__file__).resolve().parents[1] / 'public/chat.js').read_bytes()).digest())
print(json.dumps({'base': base, 'checks': checks, 'passed': sum(c['passed'] for c in checks), 'total': len(checks)}, ensure_ascii=False, indent=2))
raise SystemExit(0 if all(c['passed'] for c in checks) else 1)
