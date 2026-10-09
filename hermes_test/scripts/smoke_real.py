"""Real Hermes tool inspection plus zero-cost HTTP memory checks."""
import argparse
import json
import secrets
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ziwei.config import Settings,HERMES_COMMIT
from ziwei.server import Application,create_server

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--python',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        keys=[secrets.token_urlsafe(32) for _ in range(4)]
        app=Application(Settings(Path(directory),*keys,hermes_source=Path(args.source),hermes_python=args.python,port=0))
        server=create_server(app);threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            inspections=[]
            for allow in (False,True):
                result=app.executor.run([{'role':'user','content':'inspect only'}],allow_add=allow,inspect_only=True)
                assert result['native_memory_disabled'] and not result['model_called']
                assert ('mcp__ziwei__add_memory' in result['tools'])==allow
                inspections.append({'allow_add':allow,**result})
            base='http://127.0.0.1:'+str(server.server_port)
            for text,key in [('/记住 真实零费用验收标记 6729',keys[1]),('/回忆 6729',keys[0])]:
                body={'model':'ziwei-hermes','messages':[{'role':'user','content':text}]}
                request=urllib.request.Request(base+'/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','Connection':'close'})
                with urllib.request.urlopen(request,timeout=10) as response: value=json.load(response)
            assert '6729' in value['choices'][0]['message']['content']
            assert app.store.budget()['calls']==0
            report={'kind':'real-hermes-inspection-and-zero-cost-http-memory-check','hermes_commit':HERMES_COMMIT,
                'real_model_calls':0,'inspected':inspections,'explicit_save_and_new_http_request_readback':'passed',
                'not_claimed':'DeepSeek, cloud, model-driven autonomous task or Kelivo device end-to-end acceptance'}
            Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
        finally: server.shutdown();server.server_close()

if __name__=='__main__': main()
