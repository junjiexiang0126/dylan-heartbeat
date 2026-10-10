#!/usr/bin/env python3
"""Run INSIDE the Hermes container only, with existing API_SERVER_KEY.
One isolated chat request; never prints tokens, prompts or personal message content.
Explicitly opt in: ZIWEI_LIVE_SSE_PROBE=YES.
"""
import json, os, sys, time, urllib.request, urllib.error, uuid
if os.getenv("ZIWEI_LIVE_SSE_PROBE") != "YES":
    sys.exit("Refusing: set ZIWEI_LIVE_SSE_PROBE=YES")
key=os.getenv("API_SERVER_KEY")
if not key:
    sys.exit("API_SERVER_KEY unavailable; do not copy it into chat or logs")
base=os.getenv("ZIWEI_PROBE_BASE", "http://127.0.0.1:8642").rstrip("/")
sid="ziwei-web-isolated-probe-"+uuid.uuid4().hex[:12]
headers={"Authorization":"Bearer "+key,"X-Hermes-Session-Key":"agent:main:web:isolated-probe-"+sid,"Content-Type":"application/json","Accept":"text/event-stream"}
payload=json.dumps({"message":"仅供通信验收：请回复“测试完成”，不要调用工具，不要修改文件或记忆。","stream":True},ensure_ascii=False).encode()
def req(path,method="GET",data=None,extra=None):
    h={**headers,**(extra or {})}
    return urllib.request.Request(base+path,method=method,data=data,headers=h)
def emit(kind,**fields):
    print(json.dumps({"kind":kind,**fields},ensure_ascii=False),flush=True)
try:
    with urllib.request.urlopen(req("/api/sessions/"+sid+"/chat/stream","POST",payload),timeout=90) as r:
        emit("response",status=r.status,content_type=r.headers.get("content-type",""))
        count=0;done=False;types=set();bytes_seen=0
        for raw in r:
            bytes_seen+=len(raw)
            if bytes_seen>1024*1024: emit("limit",reason="response_too_large");break
            line=raw.decode("utf-8","replace").strip()
            if not line.startswith("data:"):continue
            data=line[5:].strip()
            if data=="[DONE]":done=True;break
            try:
                obj=json.loads(data)
                if isinstance(obj,dict):types.update(obj.keys())
            except json.JSONDecodeError:pass
            count+=1
        emit("stream_summary",done=done,data_frames=count,frame_keys=sorted(types))
    with urllib.request.urlopen(req("/api/sessions/"+sid+"/messages?limit=10&offset=0&order=latest"),timeout=15) as r:
        obj=json.load(r)
        roles=[x.get("role") for x in obj.get("data",[])]
        emit("history_summary",status=r.status,roles=roles,returned=obj.get("pagination",{}).get("returned"),session_id_matches=obj.get("session_id")==sid)
except urllib.error.HTTPError as e:
    emit("http_error",status=e.code,route=e.url.split(base)[-1],body_omitted=True)
    sys.exit(2)
except Exception as e:
    emit("error",type=type(e).__name__,message="details omitted")
    sys.exit(3)
