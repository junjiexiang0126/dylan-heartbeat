import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta

spec = importlib.util.spec_from_file_location('web_bridge_test', Path(__file__).parents[1] / 'web_bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)

class BridgeFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        (self.root/'workspace').mkdir(); (self.root/'audio_cache').mkdir()
        self.old = bridge.home; bridge.home = lambda:self.root
    def tearDown(self):
        bridge.home = self.old; self.tmp.cleanup()
    def test_voluntary_status_unknown_fresh_and_stale(self):
        self.assertIsNone(bridge.status_record()['state'])
        self.assertEqual(json.loads(bridge.publish_status({'state':'开心'}))['error'],'invalid_status')
        bridge.publish_status({'state':'在思考'})
        self.assertEqual(bridge.status_record()['state'],'在思考'); self.assertFalse(bridge.status_record()['stale'])
        file=self.root/'workspace/web-status.json';record=json.loads(file.read_text());record['updatedAt']=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat();file.write_text(json.dumps(record))
        self.assertTrue(bridge.status_record()['stale'])
        record['source']='user';file.write_text(json.dumps(record));self.assertIsNone(bridge.status_record()['state'])
    def test_export_requires_explicit_media_tag_safe_root_and_no_symlink(self):
        p=self.root/'audio_cache/reply.mp3';p.write_bytes(b'ID3example')
        self.assertEqual(bridge.media_paths('Hello '+str(p)),[])
        self.assertEqual(bridge.media_paths('MEDIA:'+str(p))[0]['data'],b'ID3example')
        outside=self.root/'secret.mp3';outside.write_bytes(b'ID3secret');self.assertEqual(bridge.media_paths('MEDIA:'+str(outside)),[])
        alias=self.root/'workspace/alias';alias.symlink_to(self.root/'audio_cache',target_is_directory=True)
        self.assertEqual(bridge.media_paths('MEDIA:'+str(alias/'reply.mp3')),[])
        p.unlink();p.symlink_to(outside);self.assertEqual(bridge.media_paths('MEDIA:'+str(p)),[])
    def test_traversal_hidden_fifo_and_oversize_rejected(self):
        for value in ['../secret','a/../secret','.env','/etc/passwd']:
            with self.assertRaises(ValueError):bridge.read_beneath(self.root/'workspace',value)
        file=self.root/'workspace/large.txt';file.write_bytes(b'1234')
        with self.assertRaises(ValueError):bridge.read_beneath(self.root/'workspace','large.txt',3)
        os.mkfifo(self.root/'workspace/pipe')
        with self.assertRaises(ValueError):bridge.read_beneath(self.root/'workspace','pipe')

class RouteBoundary(unittest.TestCase):
    def test_routes_require_authentication_and_native_run_ownership(self):
        import asyncio
        import types
        from unittest.mock import patch
        from aiohttp import web
        class Adapter:
            def _http_route_table(self):return []
            def _check_auth(self, request):
                return None if request.headers.get('Authorization')=='Bearer fixture' else web.json_response({'error':'unauthorized'},status=401)
        api=types.ModuleType('gateway.platforms.api_server');api.APIServerAdapter=Adapter
        registry=types.ModuleType('tools.registry');registry.registry=types.SimpleNamespace(register=lambda **kw:None)
        toolsets=types.ModuleType('toolsets');toolsets.TOOLSETS={}
        runs=types.ModuleType('gateway.platforms.api_server_runs')
        def owned(adapter,request,**kw):
            error=adapter._check_auth(request)
            if error is None and request.match_info['run_id']!='run_owned':error=web.json_response({'error':'not_found'},status=404)
            return (request.match_info['run_id'],{'status':'completed','output':''},None,None,error)
        runs._load_owned_run=owned
        gateway=types.ModuleType('gateway');platforms=types.ModuleType('gateway.platforms');gateway.platforms=platforms;platforms.api_server=api
        modules={'gateway':gateway,'gateway.platforms':platforms,'gateway.platforms.api_server':api,'gateway.platforms.api_server_runs':runs,'tools.registry':registry,'toolsets':toolsets}
        with patch.dict('sys.modules',modules):bridge.install()
        routes={path:handler for method,path,handler in Adapter()._http_route_table()}
        unauth=types.SimpleNamespace(headers={},match_info={'run_id':'run_owned'})
        for path in routes:
            self.assertEqual(asyncio.run(routes[path](unauth)).status,401)
        foreign=types.SimpleNamespace(headers={'Authorization':'Bearer fixture'},match_info={'run_id':'run_foreign'})
        self.assertEqual(asyncio.run(routes['/ziwei/web/runs/{run_id}/media'](foreign)).status,404)

if __name__=='__main__':unittest.main()
