"""Real service processes + restart + HTTP persistence. No model requests."""
import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    root=Path(__file__).resolve().parents[1];keys=[secrets.token_urlsafe(32) for _ in range(4)]
    with tempfile.TemporaryDirectory() as directory:
        with socket.socket() as sock: sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        env={**os.environ,'ZIWEI_DATA_DIR':directory,'HOST':'127.0.0.1','PORT':str(port),'ZIWEI_CHAT_KEY':keys[0],
            'ZIWEI_MEMORY_WRITE_KEY':keys[1],'ZIWEI_MEMORY_DELETE_KEY':keys[2],'ZIWEI_ADMIN_KEY':keys[3],
            'DEEPSEEK_API_KEY':'','ZIWEI_BUDGET_FEN':'0','ZIWEI_PRIOR_BUDGET_AUDIT':''}
        base='http://127.0.0.1:'+str(port)
        def request(path,key=None,body=None):
            headers={'Connection':'close'}
            if key: headers['Authorization']='Bearer '+key
            if body is not None: headers['Content-Type']='application/json'
            req=urllib.request.Request(base+path,headers=headers,data=None if body is None else json.dumps(body).encode())
            with urllib.request.urlopen(req,timeout=3) as response: return json.load(response)
        def stop(proc):
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill();proc.wait()
        def start():
            proc=subprocess.Popen([sys.executable,'-m','ziwei.server'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            for _ in range(100):
                if proc.poll() is not None: raise RuntimeError('Service failed to start')
                try:
                    if request('/healthz'): return proc
                except (OSError,ValueError): pass
                time.sleep(.1)
            stop(proc);raise RuntimeError('Health timeout')
        proc=start()
        try: request('/v1/chat/completions',keys[1],{'model':'ziwei-hermes','messages':[{'role':'user','content':'/记住 重启标记 restart-6827'}]})
        finally: stop(proc)
        proc=start()
        try:
            value=request('/v1/chat/completions',keys[0],{'model':'ziwei-hermes','messages':[{'role':'user','content':'/回忆 restart-6827'}]})
            assert 'restart-6827' in value['choices'][0]['message']['content']
            assert request('/admin/budget',keys[3])['calls']==0
            report={'kind':'real-service-process-restart','separate_service_processes':2,'memory_read_after_restart':'passed','real_model_calls':0,
                    'not_claimed':'Model-driven recall, autonomous tasks, cloud or Kelivo device acceptance'}
            Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
        finally: stop(proc)

if __name__=='__main__': main()
