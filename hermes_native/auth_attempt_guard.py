"""Bound failed authentication attempts without blocking valid Bearer clients.

This is temporary brute-force protection, not network isolation. Never trust
forwarded headers or record credentials. State is bounded and process-local.
"""
from collections import OrderedDict
from time import monotonic


class FailedAuthGuard:
    def __init__(self, limit=12, window=60, peers=1024, clock=monotonic):
        self.limit, self.window, self.peers, self.clock = limit, window, peers, clock
        self.failures = OrderedDict()

    def exceeded(self, request):
        transport = getattr(request, 'transport', None)
        peer = transport.get_extra_info('peername') if transport else None
        if not isinstance(peer, (tuple, list)) or not peer:
            return False  # Keep the original 401 when no socket identity exists.
        # Socket identity only; caller-supplied X-Forwarded-For is untrusted.
        address = str(peer[0])[:128]
        if address in ('127.0.0.1', '::1', '::ffff:127.0.0.1'):
            # Immutable startup probes deliberately test many invalid keys on
            # loopback. Preserve those per-route 401 checks, never weaken auth.
            return False
        now = self.clock()
        start, count = self.failures.pop(address, (now, 0))
        if now - start >= self.window:
            start, count = now, 0
        self.failures[address] = (start, count + 1)
        while len(self.failures) > self.peers:
            self.failures.popitem(last=False)
        return count >= self.limit


def install(adapter, web):
    original = adapter._check_auth
    guard = FailedAuthGuard()

    def check(self, request):
        result = original(self, request)
        # Validate the existing Bearer first. Failed peers cannot lock out the
        # legitimate Web/WeCom/Kelivo client behind a shared Railway proxy.
        if result is not None and getattr(result, 'status', None) == 401 and guard.exceeded(request):
            return web.json_response({'error': 'authentication_rate_limited'}, status=429,
                                     headers={'Retry-After': '60', 'Cache-Control': 'no-store'})
        return result

    adapter._check_auth = check
