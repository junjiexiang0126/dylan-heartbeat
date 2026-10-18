import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('auth_guard', Path(__file__).parents[1] / 'auth_attempt_guard.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)


def request(ip='100.64.0.2'):
    return SimpleNamespace(transport=SimpleNamespace(get_extra_info=lambda name:(ip, 1234)))


class AuthGuardTests(unittest.TestCase):
    def test_loopback_probes_keep_original_authentication_rejections(self):
        g=guard.FailedAuthGuard(limit=1)
        for _ in range(30):self.assertFalse(g.exceeded(request('127.0.0.1')))
        self.assertEqual(len(g.failures),0)

    def test_failed_attempts_expire_and_peer_storage_is_bounded(self):
        now=[0]; g=guard.FailedAuthGuard(limit=2, peers=2, clock=lambda:now[0])
        self.assertFalse(g.exceeded(request()));self.assertFalse(g.exceeded(request()))
        self.assertTrue(g.exceeded(request()));now[0]=61
        self.assertFalse(g.exceeded(request()))
        g.exceeded(request('1'));g.exceeded(request('2'));self.assertEqual(len(g.failures),2)

    def test_valid_bearer_stays_available_after_peer_failures(self):
        class Adapter:
            def _check_auth(self, req):
                return None if getattr(req,'valid',False) else SimpleNamespace(status=401)
        web=SimpleNamespace(json_response=lambda body,**kw:SimpleNamespace(body=body,**kw))
        guard.install(Adapter,web);a=Adapter();req=request()
        for _ in range(12):self.assertEqual(a._check_auth(req).status,401)
        self.assertEqual(a._check_auth(req).status,429)
        req.valid=True;self.assertIsNone(a._check_auth(req))
