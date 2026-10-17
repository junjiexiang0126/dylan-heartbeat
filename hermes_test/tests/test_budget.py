"""Real SQLite accounting/migrations, HTTP gateway with mock upstream (no paid calls)."""
import concurrent.futures
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ziwei.pricing import PRICE_CARD, NANO_PER_FEN, reservation, usage_cost, check_price_card, request_bounds
from ziwei.store import Store, BudgetExceeded
from ziwei.server import Application, create_server
from ziwei.config import Settings
from ziwei.admin import restore


def usage(prompt=1000, output=100, hit=0):
    return dict(prompt_tokens=prompt, completion_tokens=output, total_tokens=prompt+output,
                prompt_cache_hit_tokens=hit, prompt_cache_miss_tokens=prompt-hit)


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.store = Store(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def reserve(self): return self.store.reserve(4000, 'r', input_bound=2000, output_bound=200)
    def test_settlement_releases_excess_and_retains_original_reservation(self):
        ident=self.reserve(); before=self.store.budget()['used_nano']
        self.store.complete_call(ident, 'success', usage())
        after=self.store.budget()
        self.assertEqual(after['settled_nano'], 2_800_000)
        self.assertEqual(after['inflight_nano'], 0); self.assertLess(after['used_nano'],before)
        with self.store.transaction() as db:
            row=db.execute('SELECT * FROM calls').fetchone()
            self.assertEqual(row['reserved_nano'],before)
            self.assertEqual(json.loads(row['usage_json']),usage())
    def test_cache_price_and_token_scaling(self):
        self.assertEqual(usage_cost(usage(1000,100,900),PRICE_CARD)[0],1_036_000)
        self.assertEqual(usage_cost(usage(2000,200,1800),PRICE_CARD)[0],2_072_000)
    def test_nested_cache_counts(self):
        u={'prompt_tokens':1000,'completion_tokens':100,'prompt_tokens_details':{'cached_tokens':900}}
        self.assertEqual(usage_cost(u,PRICE_CARD)[0],1_036_000)
    def test_missing_cache_uses_uncached_ceiling(self):
        self.assertEqual(usage_cost({'prompt_tokens':1000,'completion_tokens':100},PRICE_CARD)[0],2_800_000)
    def test_invalid_cache_and_tokens(self):
        for u in [usage(hit=1001),{**usage(),'prompt_cache_miss_tokens':5},
                  {**usage(),'total_tokens':0},{**usage(),'completion_tokens':True},
                  {**usage(),'prompt_tokens':-1}]:
            with self.subTest(u=u),self.assertRaises(ValueError): usage_cost(u,PRICE_CARD)
    def test_missing_usage_retains_reservation(self):
        ident=self.reserve(); before=self.store.budget()['used_nano']
        self.store.complete_call(ident,'success',None)
        self.assertEqual(self.store.budget()['uncertain_nano'],before)
        with self.assertRaises(RuntimeError): self.store.run_usage('r')
    def test_bad_usage_retains_reservation(self):
        ident=self.reserve(); before=self.store.budget()['used_nano']
        self.store.complete_call(ident,'success',{**usage(),'prompt_cache_hit_tokens':False})
        self.assertEqual(self.store.budget()['uncertain_nano'],before)
    def test_failure_and_restart_never_release_uncertain_cost(self):
        ident=self.reserve(); self.store.complete_call(ident,'failed')
        reopened=Store(self.tmp.name); reopened.recover()
        self.assertEqual(reopened.budget()['uncertain_nano'],5_600_000)
    def test_restart_marks_inflight_uncertain(self):
        self.reserve(); reopened=Store(self.tmp.name); reopened.recover()
        self.assertEqual(reopened.budget()['inflight_nano'],0)
        self.assertEqual(reopened.budget()['uncertain_nano'],5_600_000)
    def test_idempotent_settlement_and_delivery_failure(self):
        ident=self.reserve();self.store.complete_call(ident,'success',usage())
        before=self.store.budget()
        self.store.complete_call(ident,'failed');self.store.complete_call(ident,'success',usage(2000,200))
        self.assertEqual(self.store.budget(),before)
    def test_concurrent_reservations_enforce_exact_limit(self):
        def run(n):
            try: self.store.reserve(1,str(n),input_bound=2000,output_bound=200);return True
            except BudgetExceeded: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool: result=list(pool.map(run,range(24)))
        self.assertEqual(sum(result),1);self.assertLessEqual(self.store.budget()['used_nano'],NANO_PER_FEN)
    def test_repeated_tiny_settlements_do_not_round_to_zero(self):
        for n in range(10):
            ident=self.store.reserve(1,str(n),input_bound=1,output_bound=1)
            self.store.complete_call(ident,'success',usage(1,1,1))
        self.assertEqual(self.store.budget()['settled_nano'],80400)
    def test_exhaustion_and_limit_validation(self):
        with self.assertRaises(BudgetExceeded): self.store.reserve(0,'r')
        with self.assertRaises(ValueError): self.store.reserve(4001,'r')
        with self.assertRaises(ValueError): Settings(Path(self.tmp.name),'x'*32,budget_fen=4001,prior_budget='x').validate()
    def test_usage_overrun_halts_future_requests_and_restore(self):
        backup=self.store.backup();ident=self.reserve()
        self.store.complete_call(ident,'success',usage(2100,100))
        self.assertTrue(self.store.budget()['halted'])
        with self.assertRaises(BudgetExceeded): self.store.reserve(4000,'next')
        restore(self.tmp.name,backup);self.assertTrue(self.store.budget()['halted'])
    def test_expired_tariff_disables_reservation(self):
        with self.assertRaises(ValueError): check_price_card(datetime(2026,10,16,tzinfo=timezone.utc))
        with patch('ziwei.pricing.check_price_card',side_effect=ValueError('expired')):
            self.assertFalse(self.store.can_reserve(4000))
            with self.assertRaises(ValueError): self.reserve()
    def test_request_bounds_include_tools_and_unicode(self):
        req={'messages':[{'role':'user','content':'中文'}],'tools':[],'max_tokens':20}
        raw=json.dumps(req,ensure_ascii=False).encode()
        self.assertEqual(request_bounds(raw,req),(len(raw)+4096+64,20))
        with self.assertRaises(ValueError): request_bounds(b'x'*100001,req)
        with self.assertRaises(ValueError): request_bounds(raw,{**req,'tools':[{}]*9})
    def test_old_schema_migrates_without_repricing_or_data_loss(self):
        with tempfile.TemporaryDirectory() as data:
            path=Path(data)/'ziwei.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE calls(id INTEGER PRIMARY KEY,run_id TEXT,reserved_fen INTEGER,status TEXT,input_tokens INTEGER,output_tokens INTEGER,created REAL)')
                db.execute("INSERT INTO calls VALUES(1,'prior-validation',2000,'prior-audit',31082,822,1)")
                db.execute("INSERT INTO calls VALUES(2,'old',200,'success',100,10,2)")
            old=Store(data);old.mutate('add','retained memory',key='m');job=old.create_job('retained job',9999999999)
            old.complete_call(2,'success',usage())  # Never silently discount old rows.
            reopened=Store(data)
            self.assertEqual(reopened.budget()['historical_unverified_nano'],22_000_000_000)
            self.assertEqual(reopened.search()[0]['content'],'retained memory')
            self.assertEqual(reopened.jobs()[0]['id'],job)
            with reopened.transaction() as db:
                self.assertEqual(tuple(db.execute('SELECT id,run_id,reserved_fen,status,input_tokens,output_tokens,created FROM calls WHERE id=2').fetchone()),(2,'old',200,'success',100,10,2.0))
    def test_backup_restore_preserves_fractional_cost_and_memory(self):
        self.store.mutate('add','retained',key='m');ident=self.reserve()
        self.store.complete_call(ident,'success',usage());backup=self.store.backup()
        restore(self.tmp.name,backup)
        self.assertEqual(self.store.budget()['settled_nano'],2_800_000)
        self.assertEqual(self.store.search()[0]['content'],'retained')
    def test_older_backup_cannot_lower_spend(self):
        backup=self.store.backup();ident=self.reserve();self.store.complete_call(ident,'success',usage())
        before=self.store.budget()['used_nano'];restore(self.tmp.name,backup)
        self.assertGreaterEqual(self.store.budget()['used_nano'],before)


class GatewayBudgetTests(unittest.TestCase):
    """HTTP + actual DB, provider response is a test fixture, not DeepSeek E2E."""
    def test_gateway_settlement_failure_and_admin_breakdown(self):
        with tempfile.TemporaryDirectory() as data:
            keys=[secrets.token_urlsafe(32) for _ in range(4)]
            app=Application(Settings(Path(data),*keys,port=0))
            app.settings.model_key='fake-test-key';app.settings.budget_fen=100
            server=create_server(app);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            real_open=urllib.request.urlopen
            try:
                token=app.store.grant('http-test');body={'model':'deepseek-flash','messages':[{'role':'user','content':'hello'}]}
                base='http://127.0.0.1:'+str(server.server_port)
                def request():
                    req=urllib.request.Request(base+'/internal/model/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token})
                    with real_open(req,timeout=5) as response:return response.status
                response={'model':'deepseek-flash','choices':[{'message':{'content':'fixture'}}],'usage':usage(100,10,80)}
                with patch('ziwei.server.urllib.request.urlopen',return_value=io.BytesIO(json.dumps(response).encode())) as upstream:
                    self.assertEqual(request(),200)
                    actual=json.loads(upstream.call_args.args[0].data)
                    self.assertFalse(actual['stream']);self.assertEqual(actual['thinking'],{'type':'disabled'})
                self.assertEqual(app.store.budget()['settled_nano'],123200)
                with patch('ziwei.server.urllib.request.urlopen',side_effect=TimeoutError('fixture timeout')):
                    with self.assertRaises(urllib.error.HTTPError) as error: request()
                    self.assertEqual(error.exception.code,503)
                self.assertGreater(app.store.budget()['uncertain_nano'],0)
                req=urllib.request.Request(base+'/admin/budget',headers={'Authorization':'Bearer '+keys[3]})
                with real_open(req) as response: result=json.load(response)
                self.assertEqual(result['limit_fen'],100);self.assertIn('historical_unverified_nano',result)
                app.settings.budget_fen=0
                with patch('ziwei.server.urllib.request.urlopen') as upstream:
                    with self.assertRaises(urllib.error.HTTPError) as error: request()
                    self.assertEqual(error.exception.code,402);upstream.assert_not_called()
            finally: server.shutdown();server.server_close();thread.join()
