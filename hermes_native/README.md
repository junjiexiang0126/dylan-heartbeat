# Ziwei on official Hermes

Native headless Chromium persistence, task leases, compatibility limits and
isolated acceptance checks are documented in [browser persistence](../docs/ZIWEI_NATIVE_BROWSER_PERSISTENCE.md).

The existing Railway test service runs the pinned official Hermes image. The thin layer contains profile validation, first-boot seeding, startup checks and a cheap Cron preflight. It does not implement an Agent loop, scheduler or competing memory database.

Build root: `/hermes_native`. Start command: `python /opt/ziwei-native/entrypoint.py python /opt/ziwei-native/bootstrap.py`. Persistent profile: `/data/hermes_native`. Keep one replica and the existing `/data` volume. Never modify the legacy production profile or clear the volume.

Provide DeepSeek and Gateway credentials through Railway secrets. `API_SERVER_KEY` must have at least 32 characters. `HERMES_WRITE_SAFE_ROOT` must be exactly `/data/hermes_native/workspace` when memory approval is disabled. Hermes exempts its own profile from the project-instruction gate; the file-tool safe-root boundary protects `SOUL.md`, config, scripts and gate state. The current template enables the official API/Cron toolsets plus Kanban and TTS, with terminal, browser, web, code execution and bounded delegation available through the native toolset definitions. Agent scheduling is enabled. The reviewed core patch boundary and workspace file-write filter remain in place; these are not a general security sandbox for terminal/Python execution.

SOUL contains the operator-imported identity. Native `memories/MEMORY.md` and `USER.md` hold mutable curated entries. Shared history, goals, daily experiences and file task evidence live in workspace. Imported private sources and migration manifests stay on the volume and private backups; never commit them here. Old session records are preserved and do not become a second active memory index.

`bootstrap.seed` never overwrites persistent configuration or a reviewed preflight script. Official Cron only accepts scripts beneath `HERMES_HOME/scripts`; jobs must use `script=autonomy_gate.py`, not the image copy under `/opt/ziwei-native`. The profile script is outside the Agent file-write allowlist. Preflight returns `wakeAgent=false` on idle, malformed state, six consumed daily opportunities or three consecutive failures. A missing script is a native Hermes error that can still invoke the model; verify the profile script before enabling jobs. Lock/state errors inside the script fail closed with exit status zero.

The test profile schedules six opportunities at 08/10/12/14/16/18 in its configured Asia/Bangkok timezone. Opportunities can skip or rest. A task's completed status needs nonempty file evidence under workspace; file presence proves a saved artifact, not the correctness of arbitrary external work. The task states are pending, in_progress, completed, failed, waiting_user and deferred.

Current bounds: 8 native model iterations, a 240-second Agent run budget, one API attempt, no automatic recovery ladder, one parallel Cron job, 10-second preflight timeout, 90-second Cron inactivity timeout and a provider request output cap of 2048 tokens per call. The repository template enables post-chat background review (main provider, 60-second timeout); explicit memory tools and scheduled review remain available. Existing persistent profiles may retain a different reviewed setting because bootstrap does not overwrite configuration. This is not a hard currency or aggregate-input-token budget. Native usage audits must be checked; legacy ZIWEI_BUDGET variables do not enforce a budget on official Hermes.

The OpenAI-compatible API adapter reports `supports_async_delivery=false`. `deliver=local` saves Cron output and is not user delivery. An outbox draft must keep generated/enqueued/sent/client-received/read statuses separate. No outbound channel has been connected in this phase.

Use native `hermes backup` for WAL-safe SQLite snapshots; verify archive CRC, database integrity and isolated `hermes import` before trusting a recovery point. Isolated imports must not start another Gateway. Restore selected profile files for rollback, never replace the only live database to test recovery. Credentials in full profile backups require private local storage.

Validation: `python3 -m unittest discover -s hermes_native/tests -v`. CI builds the pinned official container and checks Gateway transport, legacy-volume preservation and restart persistence without model calls. Live model, memory and scheduled-activity results belong in the private acceptance report; CI alone does not prove them.

Unified development branch: `develop/ziwei-hermes-unified-v1`. The repository also preserves the legacy Node task/memory APIs and worker for compatibility and tests; the `/hermes_native` Docker context never launches that worker or its alternate memory database. The terminal cwd template uses the literal `/data/hermes_native/workspace`; existing profiles are deliberately not rewritten. See [branch audit](../docs/ZIWEI_BRANCH_AUDIT_20261010.md) for exact source ancestry and deployment boundaries.
