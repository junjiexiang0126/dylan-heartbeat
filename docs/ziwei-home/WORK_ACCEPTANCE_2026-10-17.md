# Work studio acceptance checkpoint — 2026-10-17 (Asia/Bangkok)

PR #40 remains open and unmerged into `integration/ziwei-20261016`. Final strict content acceptance has not passed. Real end-to-end delivery and download have now succeeded; see the latest checkpoint below. The operator handles Railway deployment. Do not repeat earlier tasks or erase records to reset budgets.

## Latest closeout checkpoint — 2026-10-17 15:07 onward (Bangkok)

PR #40 remains **open and unmerged** into `integration/ziwei-20261016`. The operator handles deployments. Final content acceptance remains blocked by the overlong first slide, not by model connectivity or file download. No new live task/model request was submitted during the 15:07 closeout.

| Test service | Deployment ID / terminal status | Deployed SHA |
| --- | --- | --- |
| ziwei-home-web-test | `f83c811a-44d5-4d72-bd42-d749b3a9459c` / SUCCESS | `aa4872a79ebc58487039ee5693b9214550d0d991` |
| ziwei-hermes-test | `7c4a4977-790e-45aa-9add-40c8f5e60f17` / SUCCESS | `de1ac1e4802fe898a631c5c02ab481f7fa081a89` |

### Real saved-task recovery succeeded at 10:29

The operator deployed Web `aa4872a`. After login was visibly restored, the existing F task was resumed once through **继续审核已保存的草稿**, with no new delegation, GLM call, task admission, budget reset or data deletion.

Native HTTP evidence: **2026-10-17T03:29:58.639210848Z**, `POST /ziwei/web/work/turn`, **200**, **14019 ms**. Native diagnostic at `03:30:00.747356415Z` records `work_document_create`, `approved:true`, `argumentKeys:[text]`, `textType:string`, `textLength:1974`. Its `modelCalls:0` describes the diagnostic inspection, not the real review; the review itself is the counted HTTP request. UI reported **4595 tokens / estimated CNY .0625**. Actual supplier billing is not verified.

The UI reached **已完成交付** at **10:29:59**, with delivery message `657e6442-0469-4173-b4a8-7612e7c2283f`. All four real files were downloaded through the authenticated viewer's Save control. These exact original downloads were parsed and rendered; no locally regenerated document was substituted. Refresh retained the same message ID, four attachment URLs and expense totals. Last observed usage after settlement: **23 cumulative attempts**, configured estimate/reservations **CNY 4.6192**, remaining daily budget approximately **CNY 2.38**, plus the separately retained legacy task reservations described below. These numbers are a historical observation, not a claim about the balance at 15:07.

| Format | Attachment ID | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| DOCX | `896e2f12-9504-4778-9ef4-e496f44d4a5a` | 9990 | `e49b8862f834dc41d89b4d2f23feaef50fed870b4ac37a84032d734e21a1e666` |
| PPTX | `d54c4286-4f69-4b8e-b89d-26f27e5e21fa` | 188729 | `f4cf311fa5db35ec83bc6a9648458303f64c0970b3ebc18dd181548326ef429b` |
| PDF | `312119e0-4f25-4506-b7ee-5da442d292e5` | 120733 | `6bb5690db13ea7047c86ce5b9cde2f1b1b4a287d2845b14644b1a3ae0ba7117b` |
| XLSX | `3905a8a7-5d95-4359-b9f0-296a3c7463cd` | 10133 | `1e047b38140b94795e43df99b24a83aebca67c4d4f6af875121f3c4a4e922abe` |

### Actual file inspection and remaining failure

- **PPTX:** 20 slides; all 20 numbered headings preserved. LibreOffice rendered all slides, and their contact sheet was visually inspected. Plain text teaching slides, no claim of illustrated or presentation-designer quality.
- **DOCX:** 90 paragraphs and 20 logical page headings; LibreOffice rendered 4 physical pages as flowing teaching notes.
- **PDF:** original export is 4 physical A4 pages containing the same 20 logical sections. Parsed Chinese text and all pages were inspected. It is not a 20-page slide PDF.
- **XLSX:** 90 rows / 3 columns, 104 populated cells, no formula cells. LibreOffice rendered 5 printed pages; wrapping and Chinese text were visible.
- **Failure:** first slide has **141 Han characters** including its timetable, exceeding the requested 50–80. Slides 2–20 have 53–73 Han characters by the same count. The native claim of compliance therefore did not establish strict acceptance. Do not merge or call this fully accepted.

Original download hashes and page counts were observed in this session. Temporary render/screenshot files did not survive an execution-environment restoration later in the session. They must not be linked as though they still exist. Source files remain accessible through the recorded authenticated Work attachment URLs; the original render observations above remain historical evidence, not a fresh 15:07 render. The first-slide regression fixture is explicitly a transcription of the observed source, not a replacement live artifact.

### Final Web repair prepared for deployment

`work_requirements.js` checks **only explicit numeric page/character contracts** in the user's request, for authorized PPT/bundle tasks. It counts Han characters in each numbered section, excludes page headings/whitespace/punctuation, includes table text, and checks count/order/preamble. It does not assert factual or pedagogical correctness.

Native approval is insufficient when this deterministic check fails. One correction request can be made within the original seven-call task bound, deadline and daily budget; it receives exact failed counts and the latest candidate text. A second noncompliant response stays unpublished. Successful delivery retains its source checkpoint and structural inspection.

**检查并修订交付文件** provides one explicit same-day repair for an eligible existing completed task. For legacy F it reads the actual delivered DOCX, never substitutes the rejected GLM draft, and passes its complete content plus exact counts to a single native review in a new bounded 90-second review window. It preserves original dates/calls/admission totals, all original files and fees; no new GLM call or counter reset. Publication occurs only after the newly generated text passes the structural check. Missing context, permission revocation, exhausted calls/budget or another invalid result stop safely. It cannot repeat its repair window. Restart does not automatically rerun it.

Validation on this final source: **43/43 Work tests**, **4/4 focused Chromium mobile tests** (320/390/430 widths), syntax and whitespace checks passed. Models in automated tests are mocked; actual local HTTP/auth/CSRF, DOCX extraction and real document bytes are exercised. Includes direct approval of invalid content, one counted correction, repeated-invalid refusal, legacy delivered-document repair, preservation of original files/quotas, permissions/budget rejection and zero-model checks of compliant content. Unchanged native suites were not repeated.

### Remaining actions — do not restart the project

1. Deploy only this final Web repair to **ziwei-home-web-test** in environment **ziwei-hermes-test**. Retain native `de1ac1e` and all volumes. A staged source pin is not a deployment.
2. Verify exact terminal SUCCESS, restore the Work UI's authenticated session if necessary through secure browser authentication, and use **检查并修订交付文件** once for F. Do not send F again or erase budget records. Existing calls are retained; if limits no longer permit repair, report that limitation.
3. Download the four newly generated files, verify their hashes/content and re-render the actual new downloads. The 141-character original first slide must not be presented as the fixed version. The new repair has not yet been tested with a real model on Railway.
4. Merge PR #40 only after strict content acceptance passes. Final report must identify app/native SHAs, PR state, test boundaries, deployment versions and remaining limitations (including physical PDF/Word pagination and untested physical iOS/WebKit).

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
