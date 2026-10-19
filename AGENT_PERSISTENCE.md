# Chat and worker persistence

This increment adds an explicit read/write bridge. It does not infer task completion from prose, synchronize Kelivo SQLite, or add background MCP access. The client needs an HTTP tool (e.g. its existing shell/curl) and a securely configured URL/key. No model-facing tool definitions or MCP configuration are changed.

## Configuration

Deploy first to the isolated test environment. Set `AGENT_PERSISTENCE_ENABLED=true` and configure a dedicated `AGENT_STATE_KEY` in the server and client's private secret configuration. Default is disabled. Do not put the key in this repository, prompts, screenshots, URL parameters, or public chat. Existing Gateway/DeepSeek keys are not accepted by these endpoints. Disabling the flag returns 404 and stops new API writes; already persisted data remains readable by chat/worker context.

## Protocol

Both endpoints require `Authorization: Bearer <AGENT_STATE_KEY>` even on localhost, with `Cache-Control: no-store`.

- `GET /v1/agent/context`: authoritative revision, tasks, dynamic memories, allowlisted reference context, next wake and error state.
- `POST /v1/agent/operations`: up to 10 changes in an atomic batch, with stable request ID and expected revision. Body limit 40 KB. Authenticated requests share a 60-per-minute instance limit; audit logs contain only event/revision/count metadata.

Example body (fictional test data):

```json
{
  "requestId": "cancel_review_001",
  "expectedRevision": 1,
  "operations": [
    {"type":"task","id":"review","status":"cancelled","nextStep":"","evidence":"User explicitly cancelled this task"},
    {"type":"memory","id":"study_style","content":"Write an outline before expanding an answer","source":"User explicitly requested storage"}
  ]
}
```

Client execution: GET → select only authorized changes → POST → GET again and compare target values. Report saved/cancelled only after readback. Without a configured HTTP tool and credentials, report the blocker. A JSON receipt is evidence of storage, not independent proof that a real-world task was performed. Completion requires a stated evidence source; cancellation requires a stated user instruction. No public activity is executed by these APIs.

On a network timeout, retry the identical body/requestId (receipt deduplication retains the latest 200). Reusing an ID with different data is rejected. On revision conflict, GET again and reassess; on worker-busy, wait at least 5 seconds and retry at most three times. Do not silently mark a conflict as successful. Closed tasks are terminal. Create a distinct task ID only for a genuinely new authorized task.

## Storage and rollout

The existing `autonomous_state.json` is the single authoritative atomic commit for tasks, up to 100 dynamic memories (20,000 total content characters), revision and receipts. The existing state backup is retained. Persona, core reference files and credentials are never overwritten by this API. Both worker and chat read fresh dynamic memory each invocation. The existing worker lock serializes chat writes with whole autonomous cycles, so a long-running cycle may temporarily return 409. This design is for the current single Railway instance/volume; multi-instance shared-volume deployment is unsupported.

Test environment acceptance: anonymous read rejected, save fictional memory, read it back, create/cancel a fictional task, restart, confirm persistence, run a worker cycle and verify it sees the cancellation/memory, then verify ordinary Kelivo/MCP interaction. Back up the full volume before production rollout. Legacy pending tasks are not silently cleaned up; review and cancel them explicitly once enabled. Historical chats and Kelivo memory need a separate export/import; this change cannot recover missing history.

Rollback: disable `AGENT_PERSISTENCE_ENABLED`; restore the previous code if needed. The old state reader tolerates extra fields, but the old worker does not honor `cancelled` tasks, so do not roll back the worker while active cancellations exist without reviewing that state.
