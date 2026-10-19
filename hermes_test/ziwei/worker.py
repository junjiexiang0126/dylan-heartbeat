import json
import os
import sys

def main():
    payload=json.load(sys.stdin)
    sys.path.insert(0,os.environ['HERMES_SOURCE'])
    from tools.mcp_tool_discovery import discover_mcp_tools
    discover_mcp_tools()
    from run_agent import AIAgent
    agent=AIAgent(base_url=os.environ['ZIWEI_INTERNAL_URL']+'/internal/model/v1',
        api_key=os.environ['ZIWEI_RUN_CAPABILITY'],provider='custom',api_mode='chat_completions',
        model='deepseek-flash',enabled_toolsets=['ziwei'],
        disabled_toolsets=['memory','file','terminal','web','browser','delegate','connections','cronjob','session_search','todo'],
        max_iterations=4,max_tokens=2048,quiet_mode=True,skip_memory=True,skip_context_files=True,
        skip_background_review=True,save_trajectories=False,
        ephemeral_system_prompt=payload['system'],session_id=payload['run_id'])
    try:
        names=[t['function']['name'] for t in agent.tools]
        if 'mcp__ziwei__search_memories' not in names or any(not n.startswith('mcp__ziwei__') for n in names):
            raise RuntimeError('Unexpected tool set; fail closed')
        if getattr(agent,'_memory_store',None) is not None: raise RuntimeError('Native memory unexpectedly enabled')
        if payload.get('inspect_only'):
            result={'tools':names,'native_memory_disabled':True,'model_called':False}
        else:
            messages=payload['messages']
            result=agent.run_conversation(messages[-1]['content'],conversation_history=messages[:-1])
        print('ZIWEI_RESULT='+json.dumps(result,ensure_ascii=False,default=str),flush=True)
    finally: agent.close()

if __name__=='__main__': main()
