"""Synthesize an explicitly requested reading of a saved reply; never print text."""
import asyncio
import json
import sys

async def main():
    import edge_tts
    text = sys.stdin.read(30001)
    if not text.strip() or len(text) > 30000: raise ValueError('speech_text_limit')
    await edge_tts.Communicate(text, 'zh-CN-XiaoxiaoNeural').save(sys.argv[1])

try:
    asyncio.run(main())
    print(json.dumps({'ok': True}))
except Exception:
    print(json.dumps({'error': 'speech_unavailable'}))
    sys.exit(1)
