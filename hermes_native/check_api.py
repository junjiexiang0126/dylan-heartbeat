"""Real gateway transport smoke check. Never submits a model request."""
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

base = os.environ.get("CHECK_BASE_URL", "http://127.0.0.1:8642")
deadline = time.monotonic() + 45
while True:
    try:
        with urlopen(base + "/health", timeout=2) as response:
            assert response.status == 200
        break
    except (URLError, TimeoutError, ConnectionError):
        if time.monotonic() >= deadline:
            raise SystemExit("Official Gateway did not become healthy within 45 seconds.")
        time.sleep(1)
try:
    urlopen(base + "/v1/models", timeout=5)
except HTTPError as error:
    assert error.code in (401, 403), error.code
else:
    raise AssertionError("Model endpoint accepted an unauthenticated request.")
request = Request(base + "/v1/models", headers={"Authorization": "Bearer " + os.environ["API_SERVER_KEY"]})
with urlopen(request, timeout=5) as response:
    models = json.load(response)
assert models.get("data"), models
print("PASS: real Gateway health, rejected unauthenticated access, authenticated model list")
print("No model invocation; this does not validate DeepSeek or end-to-end agent behavior.")
