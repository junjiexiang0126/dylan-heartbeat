"""Minimal MCP stdio transport. Authorization always enforced by the host."""
import json
import os
import sys
import urllib.request

ENDPOINT=os.environ['ZIWEI_INTERNAL_URL']
TOKEN=os.environ['ZIWEI_RUN_CAPABILITY']
CAN_ADD=os.getenv('ZIWEI_CAN_ADD')=='1'
TOOLS=[{'name':'search_memories','description':'Read existing long term memories; never writes.',
        'inputSchema':{'type':'object','properties':{'query':{'type':'string'}},'required':['query']}},
       {'name':'read_dataset','description':'Read the fixed isolated CSV dataset. No arbitrary file paths.',
        'inputSchema':{'type':'object','properties':{}}}]
if CAN_ADD:
    TOOLS.append({'name':'add_memory','description':'Add explicitly authorized task memory; no update or delete.',
        'inputSchema':{'type':'object','properties':{'content':{'type':'string'},'idempotency_key':{'type':'string'}},'required':['content','idempotency_key']}})

def respond(request):
    method=request.get('method')
    if method=='initialize': return {'protocolVersion':request.get('params',{}).get('protocolVersion','2024-11-05'),'capabilities':{'tools':{}},'serverInfo':{'name':'ziwei-scoped-memory','version':'1.0'}}
    if method=='ping': return {}
    if method=='tools/list': return {'tools':TOOLS}
    if method=='tools/call':
        params=request.get('params',{}); name=params.get('name'); arguments=params.get('arguments',{})
        paths={'search_memories':'/internal/memory/read','read_dataset':'/internal/dataset'}
        if CAN_ADD: paths['add_memory']='/internal/memory/add'
        try:
            if name not in paths: raise ValueError('Tool not authorized')
            req=urllib.request.Request(ENDPOINT+paths[name],data=json.dumps(arguments).encode(),
                headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json','Connection':'close'})
            with urllib.request.urlopen(req,timeout=10) as response: value=json.load(response)
            return {'content':[{'type':'text','text':json.dumps(value,ensure_ascii=False)}],'isError':False}
        except Exception:
            return {'content':[{'type':'text','text':'Tool failed or permission denied; do not claim success.'}],'isError':True}
    raise ValueError('Unsupported method')

def main():
    for line in sys.stdin:
        request={}
        try:
            request=json.loads(line)
            if not isinstance(request,dict): request={}; raise ValueError('Object required')
            if 'id' not in request: continue
            reply={'jsonrpc':'2.0','id':request['id'],'result':respond(request)}
        except Exception: reply={'jsonrpc':'2.0','id':request.get('id'),'error':{'code':-32600,'message':'Invalid or unsupported request'}}
        print(json.dumps(reply,ensure_ascii=False),flush=True)

if __name__=='__main__': main()
