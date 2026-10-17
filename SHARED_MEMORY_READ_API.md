# Shared memory and read-only agent API

Chat, read-only API and autonomous cycles share the current readMemories(DATA_DIR) reader. Flat files take precedence over Ziwei-home imports; it includes system_prompt.txt, care_rules.txt, autonomy.txt, core memory, long-term goals and shared_history.txt, capped at 24,000 characters per source. Missing files are omitted. The earlier narrow three-file reader and appended chat context were superseded to preserve the later identity/history support and client instruction ordering. No credentials or client tool settings are read.

Read-only routes:
- GET /admin/agent/status: server timestamp, configured autonomous switch, next run time, error flag, task/activity counts and last activity status. Gateway status does not prove the worker is currently alive; a stale last activity is evidence to investigate. Bark status "sent" means the provider accepted the request, not that the phone displayed it.
- GET /admin/agent/memory: the exact bounded memory context used by chat and autonomous cycles.

Both routes require Authorization: Bearer with a dedicated AGENT_READ_TOKEN. No token means access is disabled, including localhost. Query parameters and admin Basic credentials do not authenticate these routes. No write routes are provided. Never reuse ADMIN_PASSWORD, GATEWAY_API_KEY or TARGET_API_KEY. Provision the token securely in Railway and the intended client's secret store; do not paste it into a conversation.

Responses use Cache-Control: no-store. Both routes share a fixed limit of 30 authenticated requests per minute per server process and record endpoint/outcome audit events without memory bodies or token values. This is not a distributed rate limiter.

After deployment and secure token provisioning, a client can use:
```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $ZIWEI_READ_TOKEN" \
  "$ZIWEI_BASE_URL/admin/agent/status"
```
Set ZIWEI_BASE_URL to the deployed Gateway's HTTPS origin. Never include the token in a URL or use curl verbose/trace output. Supply secrets through the execution environment.

Validation: npm test. Integration checks real HTTP requests against a mock model, memory injection into chat, authentication failures, no query-token authentication, no POST access, state-only status, memory response, no-store and rate limiting.

Rollout: retained as an optional legacy Node capability on develop/ziwei-hermes-unified-v1, disabled without AGENT_READ_TOKEN. It does not expose the official Hermes profile. Native Hermes remains the active runtime; this integration does not deploy or provision credentials.
