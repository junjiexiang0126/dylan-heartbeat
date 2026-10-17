# Work studio acceptance checkpoint — 2026-10-17 (Asia/Bangkok)

PR #40 remains open and unmerged into `integration/ziwei-20261016`. Genuine end-to-end acceptance has not passed. The operator handles Railway deployment. Do not repeat earlier tasks or erase records to reset budgets.

## Current live state, checked at 09:26–09:35

| Test service | Deployment status / ID | Deployed commit |
| --- | --- | --- |
| ziwei-home-web-test | SUCCESS / `8aa32b86-0018-4027-8616-b6b6593be712` | `284ea4608508161aa55ca2dceab45c312db37c8b` |
| ziwei-hermes-test | SUCCESS / `757e748a-d84d-4ecd-869e-3757f2306652` | `b95064d3e8e44808be2f6767697d83e042ad22ca` |

The operator successfully deployed the previous worker repair. New real 20-slide task `WORK-LIVE-20261017-C` was sent once at 09:28:17 and failed native planning with `work_model_call_limit`. Railway evidence: `2026-10-17T02:28:32.138285840Z POST /ziwei/web/work/turn → 502`, 14142 ms; safe worker log at `02:28:32.243255540Z` reports `stage=plan code=work_model_call_limit`. GLM execution, native review and live file downloads remain unverified. No completed files exist from this attempt.

Previous real attempts: A failed native initialization (`hermes_http_502`, `2026-10-16T20:52:20Z`); official dependency activation then repaired zero-model initialization (`HTTP 200`, `2026-10-16T21:18:38Z`). B failed native planning (`work_agent_failed`, `2026-10-16T21:19:09Z`). These failures are retained in history.

The Work UI still shows all six navigation items. Document bundle authorization, configured filename and historical messages survived the native deployments. Live permission check `WORK-PERM-20261017`: revoke bundle permission, submit through the normal composer, observe `tool_permission_denied` before task admission; restore the pre-existing bundle permission. The rejected text did not enter history, model request count stayed **2**, estimated/reserved usage stayed **CNY 4**, and daily remaining budget stayed **CNY 3**. An older **CNY 3** task reservation remains separately retained. These are estimates/reservations, not a verified provider bill. Do not reset them.

## Candidate repair awaiting operator deployment

Native candidate: `cf113ee560bfd5ee7ff1fd2f6c8b2163fa28af8e`, branch `feature/work-native-acceptance-20261017`.

Official Hermes source confirms that iteration-budget finalization can issue an extra summary request. The deployed guard correctly refuses another request, but previously its limit error could mask the first empty/truncated/provider failure. The exact first response from C was not logged, so its original cause is not proven.

DeepSeek's official documentation and Hermes provider profile establish that `deepseek-flash` defaults to thinking enabled. Work now explicitly disables thinking in both AIAgent configuration and actual SDK payload, requests `json_object`, forces non-streaming, and keeps the existing planning/review output limits (1500/6000). This is a candidate compatibility repair, not evidence of live success. Private-chat model settings are untouched.

The guard validates the first response before Hermes recovery, preserves safe original failure codes across swallowed retries/summary requests, refuses truncated/empty/refused/unexpected tool responses, and returns token usage from the actual single provider response. It still permits at most one wire attempt per native stage, with SDK retries disabled and one shared budget across request-local clients. The web diagnostic whitelist recognizes the new safe response codes; no arbitrary provider text is exposed.

The native branch is based on the actual deployed `47e3de4` lineage and preserves its newer status/photo/WeCom work. Do not deploy the older pinned `231b4e5` baseline or the app PR's native tree wholesale. Native and web volumes, old production, keys, memory and private history remain untouched.

## Confirmed requirements and implementation

- Sixth Work page preserves the five existing pages and private chat; formal chat styling, themes, wallpaper, avatars, actions, viewer and mobile composer are shared.
- User, native Hermes 知微 coordinator and GLM 白鸦 executor. White Raven receives only explicit Work input, quotes and attachments; no independent long memory or private transcripts.
- Work-only DOCX/PPTX/PDF/XLSX adapters for both agents. Arbitrary shell, installed private-profile skills, email/calendar and MCP adapters are outside this implementation.
- GLM must issue an actual `work_document_create` function call. Generated drafts remain inaccessible until native approval; receipts include real container/CRC checks and SHA-256, explicitly `visualChecked:false`. Native review may request two bounded revisions or create a corrected final document itself.
- SQLite persists Work messages, tasks, permissions, files, tool receipts and usage. Interrupted tasks never automatically resubmit.
- Confirmed workload: 15–30 slides, 3–4 assignments/day, CNY 10/day. One assignment can produce four formats without repeating model work. PPT export supports up to 32 slides.
- Limits: concurrency 1; 7 model attempts/10 minutes per task; 90 seconds/stage; 8 tasks/48 attempts per Bangkok day. GLM `glm-4-flash-250414`, 10000 output tokens. Unknown usage retains conservative per-transport reservation (native CNY 2, GLM CNY .75); reported usage replaces it at configured CNY 10/M input and CNY 20/M output. Billed amounts remain null.

## Validation already completed — do not rerun unchanged suites

| Validation | Result and boundary |
| --- | --- |
| Latest native response/guard unit tests | **15/15 passed**; fake AIAgent, no real model |
| Latest actual SDK + official Hermes transform contracts | **5/5 passed**, OpenAI 2.24.0/HTTPX 0.28.1; HTTP mocked. Includes on-wire JSON/thinking/output ceilings, 401/truncation cause preservation and exactly one HTTP request despite swallowed recovery |
| Changed web diagnostic test | **1/1 passed**, seven safe/unsafe error cases; native HTTP mocked |
| Prior Work suite | **27/27 passed**; actual local HTTP auth/CSRF/upload/download/restart, model transports mocked; includes four daily assignments, 30-slide content preservation, revocation during review and unpublished-file denial |
| Prior focused Chromium mobile | **2/2 passed**, widths 320/390/430, formal/private computed style equality, light/dark, composer/nav, search/quote/tool center |
| Syntax and whitespace | Passed after latest changes |
| Earlier unchanged baseline | Web 95/95; native 124/124; Chromium 113/115 then 4/4 focused rechecks after two stale assertions were corrected. This was not one fresh 115/115 run |

No physical iOS/WebKit acceptance. Local Office/ZIP tests do not establish live GLM success or visual quality of live-generated files.

## Resume after the operator deploys

Context: project `7afe77af-0481-4a21-858d-2339fc24ab8f`, environment `eddf4e4f-1199-45a1-8397-5053c7e9586d`. Web service `0e699897-01a7-4910-8009-589fe5bc6ce7`, native `d0a928bf-3db2-4085-9812-8a28be4d0b1b`.

1. Read exact deployment SHAs and terminal SUCCESS; source pin/staged changes alone are not deployment evidence. Use the native candidate above and app PR's latest commit for the web safe-diagnostic change.
2. Reuse authenticated Work UI. Do not resubmit C or the rejected permission-test text. Check zero-model native readiness first.
3. Send one new synthetic 20-slide task only after the new worker is live and budget admission permits it. Verify genuine native delegation, GLM function call, native review, real tool receipts and reported usage. A failed native stage retains CNY 2; do not loop on repeated attempts or clear budgets.
4. Download all four actual live files; inspect Chinese text/20-slide count and render actual downloads with available `soffice`/`pdftoppm`. Do not substitute regenerated local files as live evidence.
5. Check refresh/re-login and an idle authorized web-test restart preserve exact message/task/file/receipt/usage identities. Live revocation-before-model check has already passed; do not repeat it unless the relevant implementation changes. Preserve all volumes and original pages.
6. Only after genuine acceptance passes, merge PR #40 into `integration/ziwei-20261016`. Final report must contain app/native SHAs, PR state, tests and their mocked/live boundaries, Railway deployment IDs/SHAs, real evidence and outstanding issues.
