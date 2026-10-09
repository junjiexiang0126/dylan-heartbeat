"""Fault injection ONLY in the disposable official-container CI fixture."""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, '/opt/ziwei-native')
import runtime_guard as guard


def pid(service):
    return max(0, int(subprocess.check_output(['/command/s6-svstat', '-o', 'pid', '/run/service/' + service]).strip()))


def wait_new(service, previous):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        current = pid(service)
        if current and current != previous:
            return current
        time.sleep(0.5)
    raise AssertionError('ephemeral supervisor did not restart ' + service)


def main():
    # Refuse to run this helper against the real profile or real credentials.
    assert os.environ.get('ZIWEI_EPHEMERAL_FAULT_TEST') == '1'
    assert os.environ.get('API_SERVER_KEY') == 'startup-check-only-distinct-not-a-live-credential'
    assert Path('/data/legacy-marker').read_text() == 'legacy-data-preserved'
    guardian = pid('ziwei-guardian')
    gateway = guard.gateway_pid()
    assert guardian > 0 and gateway > 0
    assert 'Uid:\t0\t' in Path(f'/proc/{guardian}/status').read_text()
    assert 'Uid:\t10000\t' in Path(f'/proc/{gateway}/status').read_text()
    os.kill(gateway, signal.SIGKILL)
    fresh_gateway = wait_new('gateway-default', gateway)
    assert pid('ziwei-guardian') == guardian
    assert guard.await_health(gateway)
    os.kill(guardian, signal.SIGTERM)
    fresh_guardian = wait_new('ziwei-guardian', guardian)
    assert fresh_guardian != guardian and guard.gateway_pid() == fresh_gateway
    assert guard.health()
    print('ephemeral Gateway exit, Guardian independence and Guardian s6 restart passed')


if __name__ == '__main__':
    main()
