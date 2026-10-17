"""Read-only diagnostics over cached Work commands, with no model/runtime imports."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('work_diagnostic',Path(__file__).parents[1]/'work_bridge.py')
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class WorkDiagnostic(unittest.TestCase):
    def test_reports_shape_without_exposing_any_values(self):
        secret='private-body-api-key-must-not-appear'
        command={'approved':True,'message':secret,'toolCall':{'name':'work_document_create','arguments':{'text':secret,'format':secret,'title':secret,secret:secret}}}
        summary=bridge.command_diagnostic({'text':json.dumps(command)})
        self.assertEqual(summary['tool'],'work_document_create')
        self.assertEqual(summary['argumentKeys'],['(other)','format','text','title'])
        self.assertEqual(summary['textLength'],len(secret))
        self.assertNotIn(secret,json.dumps(summary))
        self.assertEqual(summary['modelCalls'],0)
    def test_delivery_arguments_are_distinguished_from_creation(self):
        summary=bridge.command_diagnostic({'text':json.dumps({'approved':True,'toolCall':{'name':'work_document_deliver','arguments':{'files':['secret-id']}}})})
        self.assertEqual(summary['argumentKeys'],['files'])
        self.assertEqual(summary['tool'],'work_document_deliver')
        self.assertNotIn('secret-id',json.dumps(summary))
    def test_latest_review_only_is_read_without_changing_cache(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            old=root/'old-review.json';latest=root/'new-review.json'
            old.write_text(json.dumps({'result':{'text':'{}'}}))
            command={'approved':False,'toolCall':{'name':'work_document_create','arguments':{'content':'hidden'}}}
            latest.write_text(json.dumps({'result':{'text':json.dumps(command)}}))
            os.utime(old,ns=(1,1));os.utime(latest,ns=(2,2))
            (root/'newer-plan.json').write_text('private plan')
            before={p.name:p.read_bytes() for p in root.iterdir()}
            summary=bridge.cached_review_diagnostic(root)
            self.assertFalse(summary['approved'])
            self.assertEqual(summary['argumentKeys'],['content'])
            self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
    def test_symlinks_and_oversize_files_are_not_read(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);outside=root/'private.json';outside.write_text('sensitive')
            (root/'unsafe-review.json').symlink_to(outside)
            (root/'large-review.json').write_text('x'*128001)
            self.assertIsNone(bridge.cached_review_diagnostic(root))
    def test_malformed_objects_and_unknown_tools_do_not_expose_text(self):
        self.assertEqual(bridge.command_diagnostic({'text':'secret invalid text'})['protocol'],'invalid_json')
        self.assertEqual(bridge.command_diagnostic({'text':'[]'})['protocol'],'not_object')
        summary=bridge.command_diagnostic({'text':json.dumps({'toolCall':{'name':'secret-tool-name','arguments':'private string'}})})
        self.assertEqual(summary['tool'],'unsupported_or_missing')
        self.assertNotIn('secret',json.dumps(summary))

if __name__=='__main__':
    unittest.main()
