# Work studio acceptance checkpoint — 2026-10-17 (Asia/Bangkok)

PR #40 remains open and unmerged into `integration/ziwei-20261016`. Genuine end-to-end acceptance has not passed. The operator handles Railway deployment. Do not repeat earlier tasks or erase records to reset budgets.

## Latest confirmed state and prepared Web repair (10:11 onward)

| Test service | Deployment status / ID | Deployed commit |
| --- | --- | --- |
| ziwei-home-web-test | SUCCESS / `3b58c344-7e30-4d01-ad81-ae7f0fa5789a` | `a7be4180c7832000b7454b206b500a6e666e68e8` |
| ziwei-hermes-test | SUCCESS / `7c4a4977-790e-45aa-9add-40c8f5e60f17` | `de1ac1e4802fe898a631c5c02ab481f7fa081a89` |

The native cached diagnostic is deployed. Runtime evidence at **2026-10-17T03:11:36.612498875Z** proves the F review selected **work_document_create**, **approved:true**, **arguments:{}**, no text field (`textType:missing_or_not_string`, `textLength:0`). Reading this evidence consumed **zero model calls**. This is now a proven missing-body error, not an inferred extra-field problem. No live task was submitted in this repair turn.

### Prepared repair — deploy Web only

The PR now validates native review commands before publication. A malformed command receives at most one explicit correction request with the concrete validation error and complete Work task/draft. This uses the original task's seven-call limit, original deadline and daily budget. It has a distinct native cache ID. Transport errors are not automatically retried. An invalid final command remains failed and its drafts remain inaccessible. A rejection after protocol correction stops instead of starting another GLM round.

Work persists a review checkpoint before review. The authenticated, CSRF-protected **continue saved-draft review** action can recover an eligible same-day command-validation failure exactly once, with **one native request / 90-second review window**, no new task admission, no new delegation/GLM call and no reset of original calls, dates, reservations or fees. Recovery is explicit, not automatic after deployment or restart. Legacy drafts such as F can be reconstructed only from their own text-only Work request, last GLM message and matching unpublished file receipts; missing quotes/attachments are not guessed. This is a separately admitted recovery window after a failed task, not a reset of its original ten-minute run. Permissions, concurrency, seven-call cap, 48 daily calls and CNY 10 budget still apply. Recovery fails honestly if native cannot supply a valid command. File publication, delivery receipt and final message commit atomically.

Only the Web test service needs this repair. Native remains at its successful `de1ac1e` deployment. No production, volume, memory or private-chat change is required. The operator still handles deployment.

### Verification of this repair

- Work automated suite **34/34 passed**, including authentic local Office/PDF bytes, local HTTP auth/CSRF/upload/download/persistence, bounded correction, distinct native IDs, reopen-and-resume without GLM replay, eight-task admission retention, idempotency, call/budget exhaustion and permission denial. **All model responses in this suite are mocked.**
- Focused Chromium mobile **3/3 passed**, widths 320/390/430, light/dark shared formal-chat geometry, existing controls, plus the new recovery action sending once with CSRF and hiding during review. This uses isolated local fixture data, not live model acceptance.
- Syntax/whitespace checks passed. Unchanged native suites were not repeated.
- **Live end-to-end delivery remains unaccepted:** no four final files have yet been downloaded or visually inspected. Do not merge PR #40 until that is done.

### Next action after the operator deploys the prepared Web commit

1. Verify terminal SUCCESS and exact new Web SHA; retain native `de1ac1e`.
2. Refresh the authenticated Work UI. Choose **继续审核已保存的草稿** for the latest eligible failed task F. Do not send F again. The existing F plan and GLM output remain the evidence for real delegation/execution; the recovery adds only one real native review.
3. If the review corrects and approves the draft, download the four actual published files, check 20 slides and task content, then render actual downloads using `soffice`/`pdftoppm`. Never substitute regenerated local files. If rejected/invalid, report the exact new evidence; do not replay recovery or reset limits.
4. Check refresh/re-login preserves message/task/file/receipt/usage identities; existing live revocation already passed. Deployment itself provides a persistence boundary without an unsolicited volume restart.
5. Merge only after real acceptance, then report exact SHAs, PR state, deployed IDs, live evidence and remaining limitations.

Task F was sent once at **10:03:06**. Native plan HTTP 200: `2026-10-17T03:03:15.553218465Z` / 9458 ms; review HTTP 200: `2026-10-17T03:03:48.362691823Z` / 7403 ms. Reported plan/GLM/review tokens: **1622 / 1932 / 3130**; estimate approximately **CNY .0846**, not billed cost. Four real GLM drafts are retained unpublished. UI cumulative attempts **22**, remaining budget approximately **CNY 2.44** after settlement; preserve legacy reservations and all historical drafts. Daily new-task quota may be exhausted; use the bounded recovery rather than resubmitting an assignment.

## Earlier task E and deployed canonical-command fix

The operator deployed the Web review-tool fix above successfully at 09:49:52. Task `WORK-LIVE-20261017-E` was submitted once at **09:51:48**. Native delegation succeeded, GLM made a real document function call and generated four unpublished drafts, then the first native review returned HTTP 200 but failed Web parsing with **`invalid_hermes_json`**. The task stopped safely with no published files or automatic resubmission.

Native HTTP evidence: `2026-10-17T02:51:56.775386554Z` plan HTTP 200 / 8562 ms; `2026-10-17T02:52:37.691325923Z` review HTTP 200 / 16320 ms. UI-reported tokens: native plan **1501**, GLM **1757**, native review **4917**. Configured estimate approximately **CNY .1163**, not provider billing. Total displayed model requests are 19; remaining daily budget approximately CNY 2.53 after all current tasks settled. Preserve legacy reservations and all draft/history data.

The exact malformed review text was not retrieved, so do not claim its precise syntax or a specific output hook as a proven root cause. Native previously returned `AIAgent.run_conversation().final_response`, a human-facing presentation surface. The repair returns the canonical JSON object from the **single guarded provider response** instead, after the native conversation succeeds. This keeps actual model output and usage while preventing subsequent chat-presentation transformations from changing a machine command. Complete JSON objects containing literal control characters inside strings are parsed and re-serialized losslessly; partial JSON, prose and non-object outputs remain rejected. It never infers approval, changes fields, adds a model attempt, or raises limits.

That native fix was deployed at **`28ecc6f72fb6923a1ea1cff8384fe26e32813014`**. Web remained at `a7be418`. New/affected validation: **18 native guard tests + 6 actual-SDK/official-Hermes-transform contract tests passed**, with fake AIAgent / mocked HTTP, including 20-section multiline document preservation, escaping, presentation-hook separation, one HTTP attempt, rejected-output preservation and failure on incomplete objects. These tests are not real-model acceptance. Syntax/whitespace passed. Do not repeat prior unchanged suites.

Task F below verified that this repair crossed the JSON parsing boundary, but argument validation still blocked delivery.

Before the current deployment, the operator deployed native `b95064d`. Real 20-slide task `WORK-LIVE-20261017-C` was sent once at 09:28:17 and failed native planning with `work_model_call_limit`. Railway evidence: `2026-10-17T02:28:32.138285840Z POST /ziwei/web/work/turn → 502`, 14142 ms; safe worker log at `02:28:32.243255540Z` reports `stage=plan code=work_model_call_limit`. At that checkpoint GLM execution and native review were unverified; D and E below subsequently established those real calls. Live file downloads still remain unverified. No completed files exist from C.

Previous real attempts: A failed native initialization (`hermes_http_502`, `2026-10-16T20:52:20Z`); official dependency activation then repaired zero-model initialization (`HTTP 200`, `2026-10-16T21:18:38Z`). B failed native planning (`work_agent_failed`, `2026-10-16T21:19:09Z`). These failures are retained in history.

The Work UI still shows all six navigation items. Document bundle authorization, configured filename and historical messages survived both web and native deployments. At 09:35, live permission check `WORK-PERM-20261017`: revoke bundle permission, submit through the normal composer, observe `tool_permission_denied` before task admission; restore the pre-existing bundle permission. The rejected text did not enter history, model request count stayed **2**, estimated/reserved usage stayed **CNY 4**, and daily remaining budget stayed **CNY 3**. An older **CNY 3** task reservation remains separately retained. These are estimates/reservations, not a verified provider bill. Do not reset them.

## Earlier task D evidence and deployed Web correction

On the successful deployments above, zero-model readiness passed again. A new synthetic 20-slide task `WORK-LIVE-20261017-D` was submitted exactly once at **09:41:40**. Native Hermes successfully delegated, GLM issued three real document function calls across the initial draft and two revisions, each generated four actual draft files, and native Hermes reviewed all three drafts. The task reached its seven-call bound and ended honestly as `needs_revision`, with no published download links.

Native HTTP evidence (all `POST /ziwei/web/work/turn`, HTTP **200**):

| UTC timestamp | Stage | Duration |
| --- | --- | --- |
| 2026-10-17T02:41:48.303955093Z | Plan | 8012 ms |
| 2026-10-17T02:42:21.062145155Z | Review 0 | 8145 ms |
| 2026-10-17T02:42:54.577483891Z | Review 1 | 7748 ms |
| 2026-10-17T02:43:24.119939154Z | Review 2 | 8250 ms |

The UI reports these seven actual requests with reported token counts: native plan 1426; GLM 1529; native review 2829; GLM 2078; native review 2878; GLM 1658; native review 2663. Their configured cost estimate totals approximately **CNY .1902**; this is not the provider invoice. Three completed GLM `work_document_create` receipts and three four-file inspection receipts persist. Twelve unapproved drafts are retained; none was delivered. The reviewer caught incorrect character descriptions and later rejected many pages shorter than 50 characters. Real GLM and real native review are now established; successful end-to-end delivery and visual quality are still not established.

Another operator-originated Work discussion began at 09:44. Do not resubmit or interrupt it, and read the current budget only after pending reservations settle. Do not publish its conversation content in the repository.

The native response repair is now live and demonstrated successful planning/review. Its first-error handling, one-wire-attempt bound, explicit non-thinking JSON mode and existing 1500/6000 output limits remain unchanged. The exact original cause of task C is still unproven.

The now-deployed Web correction is: the review payload now explicitly offers native `work_document_create`, with the same authorized document schema, alongside delivery. Previously the worker prompt mentioned self-revision but the actual review tool list exposed only delivery. Each review now receives its remaining revision rounds. At the final bounded review, native Hermes is instructed to correct a fixable draft itself through the actual tool, or honestly refuse if information is missing or it cannot safely correct it. No extra model attempt, retry, budget increase or private tool access is added.

That Web correction was deployed at `a7be418`, with native then at `cf113ee`. Its targeted tests: **6/6 passed** (model transports mocked), including final native correction within exactly seven calls, only four final native-generated files published, rejected drafts inaccessible, revocation preventing publication, and missing-information refusal preserved. Syntax and whitespace checks passed. Unchanged suites were not repeated.

The native branch preserves the actual deployed `47e3de4` lineage and its newer status/photo/WeCom work. Do not deploy the older pinned `231b4e5` baseline or the app PR's native tree wholesale. Volumes, old production, keys, memory and private history remain untouched.

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
| Latest native response/guard unit tests | **18/18 passed**; fake AIAgent, no real model |
| Latest actual SDK + official Hermes transform contracts | **6/6 passed**, OpenAI 2.24.0/HTTPX 0.28.1; HTTP mocked. Includes on-wire JSON/thinking/output ceilings, 401/truncation cause preservation and exactly one HTTP request despite swallowed recovery |
| Changed web diagnostic test | **1/1 passed**, seven safe/unsafe error cases; native HTTP mocked |
| Prior Work suite | **27/27 passed**; actual local HTTP auth/CSRF/upload/download/restart, model transports mocked; includes four daily assignments, 30-slide content preservation, revocation during review and unpublished-file denial |
| Prior focused Chromium mobile | **2/2 passed**, widths 320/390/430, formal/private computed style equality, light/dark, composer/nav, search/quote/tool center |
| Syntax and whitespace | Passed after latest changes |
| Earlier unchanged baseline | Web 95/95; native 124/124; Chromium 113/115 then 4/4 focused rechecks after two stale assertions were corrected. This was not one fresh 115/115 run |

No physical iOS/WebKit acceptance. Local Office/ZIP tests do not establish live GLM success or visual quality of live-generated files.

## Deployment context

Project `7afe77af-0481-4a21-858d-2339fc24ab8f`, environment `eddf4e4f-1199-45a1-8397-5053c7e9586d`. Web test service `0e699897-01a7-4910-8009-589fe5bc6ce7`; native test service `d0a928bf-3db2-4085-9812-8a28be4d0b1b`. Follow the latest repair/recovery instructions above; the historical native-only diagnostic deployment is already complete.
