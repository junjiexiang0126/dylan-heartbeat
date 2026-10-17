# Work studio acceptance checkpoint — 2026-10-17 (Asia/Bangkok)

PR #40 remains open. Do not merge until the live acceptance below passes.

## 09:07 resumption and request-client fix

Both deployed services are SUCCESS: Web `284ea4608508161aa55ca2dceab45c312db37c8b`, deployment `8aa32b86-0018-4027-8616-b6b6593be712`; native `d6df6842cf7aabe75e7282e247866f528a7f4591`, deployment `d635979f-4f25-4f34-a11b-21b074292aa2`. The zero-model worker check passed at `2026-10-16T21:18:38.485665686Z` (HTTP 200, 4752 ms), establishing that official dependency activation repaired initialization.

The real 20-slide task `WORK-LIVE-20261017-B` then failed at native planning with `work_agent_failed`: HTTP 502 at `2026-10-16T21:19:09.383379816Z` (11293 ms). GLM, review and file delivery are still not verified live. Do not spend on another model task until the request-client fix is deployed.

Source inspection identified that current Hermes creates/cache-checks request-local OpenAI clients rather than dispatching through its shared client. The old guard wrapped only the latter. Its SDK optimization also moves messages into `extra_body`, conflicting with strict override checks. The fix guards both client factories and the initial client under one shared call budget, prevents double wrapping, enforces the official endpoint/model, disables SDK retries and Work-only recovery, and keeps SDK payloads on the typed path within this isolated subprocess. Private chat configuration is unchanged.

Validation of this fix: 10 native guard tests passed; 2 additional contract tests passed using OpenAI SDK 2.24.0, HTTPX 0.28.1, and the official Hermes `agent.sdk_transform_bypass` implementation. Their HTTP transport is mocked: these demonstrate the client/SDK contract, not real model success. They verify intact message payloads, the on-wire output token ceiling, reported usage, and a shared budget across fresh SDK clients. The previously passed Web/Work/mobile suites were not rerun because the frontend and Web service code are unchanged.

Only the native test service requires redeployment for this fix. Preserve the Web service at its successful version and retain all volumes. The final native commit SHA will be recorded in PR metadata and the deployment handoff.

## Confirmed operator requirements

- Preserve the existing five pages, private chat, native identity and sole authoritative Hermes memory.
- Work is the sixth page, using the formal chat appearance and its shared render/actions/viewer helpers.
- Work-only tools may be installed directly for both agents; reuse of private Hermes tools is not required.
- Typical workload: 15–30 slides per courseware deck, 3–4 work assignments per day. Daily model budget: CNY 10.

## Current implementation

The web runtime has pinned DOCX, PPTX, PDF and XLSX generators, registered behind Work permissions. GLM receives a function schema and must return an actual `work_document_create` function call for document tasks. Native Hermes uses a constrained JSON command protocol for `work_delegate`, `work_document_deliver`, or its own `work_document_create` revision. These are Work adapters; arbitrary shell, installed private-profile skills, email, calendar and MCP adapters are not exposed by this implementation.

Generated drafts are persisted but inaccessible through the download route until approval. A container/CRC check and SHA-256 receipt accompany each file; this does not prove visual quality. The native reviewer receives the draft text and actual file inspection receipts. Rejected drafts can go through two bounded revision rounds; asking for missing user input stops automatic revision. Tool receipts, messages, tasks, files and usage survive reopening. Restarted tasks never silently resubmit.

Limits: concurrency 1; 7 model transport attempts per task; 10-minute task deadline; 90-second stage deadline; 8 tasks / 48 transport attempts per Bangkok day. GLM is pinned to `glm-4-flash-250414` with at most 10,000 output tokens; native planning 1,500 and review 6,000. PPT generation supports up to 32 slides and has a 30-slide content preservation check. Quoted/attached context remains bounded and explicitly reports truncation.

Budget: reserve before each transport (native CNY 2; GLM CNY .75), then adjust to reported usage using the configured conservative CNY 10/M input and CNY 20/M output rates. Missing usage and transport failures retain their reservation. Preserve prior task reservations. Stop before a subsequent call when the remaining daily CNY 10 is insufficient. These are local estimates/reservations, not provider invoices; billed amounts remain null. File formats from one assignment share its model work.

## Validation evidence

- Latest Work automated suite: **27/27 passed** (`WORK_CJK_FONT=/tmp/work-cjk-font.otf npm run test:work`). Model transports are mocked. Actual local HTTP authentication/CSRF/upload/download and restart persistence are included.
- Native worker guard tests: **6/6 passed**. These use a fake AIAgent, not a live native model.
- Latest focused Chromium mobile tests: **2/2 passed**, covering widths 320/390/430, formal/private computed bubble style equality, light/dark, composer/nav geometry, search, quote, mention and tool center.
- Syntax checks and `git diff --check` passed.
- Earlier unchanged baseline: Web 95/95; native 124/124; full Chromium suite 113/115, followed by 4/4 focused rechecks after repairing two stale baseline assertions. This is not a single fresh 115/115 run. Physical iOS/WebKit has not been tested.

## Live evidence and blocker

Observed successful deployments before this checkpoint:

| Service | Deployment | Commit |
| --- | --- | --- |
| ziwei-home-web-test | ebc3b25e-395c-4391-adf5-8e0f5415d0aa | d53c96774e52935bc0546e95bc62f1cfd7d11ccb |
| ziwei-hermes-test | 5d047004-3322-4545-913b-0d839b55cd9c | d2e16973b497552f8ecdfa0470394c3e5f2af70e |

The authenticated live page displayed the sixth Work navigation item and the independent tool center. A synthetic four-format acceptance task (`WORK-LIVE-20261017-A`) failed at native delegation. Railway HTTP evidence: **2026-10-16T20:52:20.289569892Z POST /ziwei/web/work/turn → 502 (8117ms)**. No successful live GLM execution, native review or file delivery has been established. Do not report otherwise.

The patch adds official dependency activation to the fresh native subprocess and safe phase/type diagnostics. This is a candidate repair, not a confirmed live resolution. The zero-model readiness endpoint checks worker initialization without creating tasks or using model tokens.

Deployment acceptance through the connector returned `Cancelled — the user did not approve this action. No changes were made.` The operator has already authorized test deployment and can apply the final staged patch in Railway. Do not bypass the cancellation or touch old production/data volumes. The native acceptance branch is based on the actual deployed `47e3de4`, preserving its newer status/photo/WeCom functionality; do not replace it with older pinned source `231b4e5`.

## Resume after the operator deploys

1. Read deployment metadata for both services in project `7afe77af-0481-4a21-858d-2339fc24ab8f`, environment `eddf4e4f-1199-45a1-8397-5053c7e9586d`. Verify exact final staged SHAs and terminal SUCCESS; never infer from source config alone.
2. Reuse the authenticated cloud tab, reload, open Work → tool center → check work connection. This makes no model request. Resolve any safe diagnostic before spending on tasks.
3. Run one synthetic 15–30 slide assignment using the authorized document bundle. Verify real native delegation, GLM function call, native approval and actual downloads of all four formats, with model usage and persisted tool receipts. Preserve real bills as unknown unless independently obtained.
4. Download and inspect the actual live files, including Chinese content and all PPT slides. Render files for visual acceptance; local ZIP checks are insufficient.
5. Verify revocation, refresh/re-login, and an authorized restart of the web test service preserve history/files/usage and the original pages. Do not delete persistent records to reset test quotas.
6. Merge PR #40 into `integration/ziwei-20261016` only after these pass. Report final app/native SHA, PR state, deployment IDs, genuine evidence and remaining limitations. Avoid rerunning unrelated passed suites.
