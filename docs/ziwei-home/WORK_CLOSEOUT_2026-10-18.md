# Work live acceptance — 2026-10-18 (Asia/Bangkok)

## Scope and exact code

Security closeout remains accepted and untouched. No native deployment, branch merge, Cron/personality/memory/rule change, credential read, data deletion or quota reset was performed in this Work closeout.

Code is committed on feature/work-integration-20261017 / PR40:
- 94b2998afa3e688817e830296077aaf682139f55 — chat selector stays text-only; mock-routing browser isolation; failure evidence.
- 84cc5bdf5ff626d81d58b05ee0ccc2171ddb7300 — one-time cross-day delivery repair, with new attempts charged to the day of execution.

Native stays on 01e35a1b84ecb11f6a907eb02932b001542f7c5c. Its differences include the Cron Docker build and the impressions route; no whole-branch merge was attempted.

## Confirmed root causes and fixes

1. The UI calls auto mode 聊天, but the server previously let the coordinator select an authorized file tool for it. A conversation could therefore become a document task. Chat now offers no file tools to planning, fixes its selected output to auto, and instructs review to deliver text. Model-request, time, cost, concurrency and permission guards remain. Explicit file selections still use the existing GLM tool-call and native review pipeline. Chat still consumes existing shared model/cost limits; this patch does not claim unlimited free chat.
2. Yesterday's completed F task cannot use a same-day-only repair endpoint today. The existing one-time endpoint now accepts older completed deliveries without changing task creation date, task day, lifetime call count, original files or historical expenses. Today's calls on old tasks are added to today's 48-call check, including admission and recovery checks. The original seven-call lifetime cap and one repair window remain.
3. Local browser startup failed because required Playwright binaries were absent. The official CDN returned a 195-byte HTML Site Unavailable page instead of a ZIP, so local browser results are not reported as passed. The actual CI failure was separate: all 13 focused WebKit tests bypassed mocked API fixtures. Blocking Service Workers in the isolated test context restored Chromium/WebKit routing. Production Service Worker code was not modified. Failures now retain trace/screenshots and upload a CI artifact.

## Verification on final code

- 45/45 Work tests pass, including planner escalation denial and a cross-day repair that consumes the 48th real-day request, preserves original files/date and rejects a 49th request.
- 102/102 Web tests pass; 18/18 isolated Native Work Agent tests pass; syntax and whitespace checks pass.
- GitHub Work isolated checks run 39121425277, job 117657655390: SUCCESS. Final-source browser run: 26/26 pass, including four Work cases on Chromium and four on iPhone-profile WebKit, plus private-chat regression. Work geometry tests cover 320/390/430 widths; WebKit simulation is not a physical iPhone test.
- Preceding commit 94b2998 also passed 26/26 browser checks (run 39121305845). Tests use synthetic data and mocked model transports; they do not establish real-model success of the new code.
- Broader Web E2E had independent pre-existing memory/log token/layout assertions failing on the original deployed SHA. These were not removed or weakened. The full Web CI run for final source is separate (39121424894); don't call the entire PR green or merge solely because focused Work checks passed.

## Earlier live evidence retained

Authenticated GET /api/work/messages returns the actual persisted model usage and file receipts. Today at 2026-10-18T10:44:29.089Z, task 3b0e5d61-49cf-4ac7-8996-33419cf5f311 recorded GLM execution (glm-4-flash-250414, prompt_tokens=119, completion_tokens=23), followed by native review and a completed chat. Task dcc11663-6f00-4da2-8eb5-04b1ab557b16 retains the previously accepted real four-format delivery. The production source calls the actual Zhipu endpoint; no API key value was inspected. Usage-based configured estimates are not reconciled provider billing.

Today's failed conversation tasks also remain unchanged: 4f9c21e6-22e5-4f43-a3e0-3207755f5b92 failed invalid_work_tool_arguments; 01a751d2-7f41-4ca1-afdf-b9072c104e26 failed work_coordinator_tool_call_required. The user subsequently said no document was wanted, so the old conversation was not resumed to manufacture an unwanted document.

## Actual deployment and fresh live acceptance

Only Web source.commitSha moved from 6d9b4a738108723ec1612a85c31b260bec75c99a to **84cc5bdf5ff626d81d58b05ee0ccc2171ddb7300**. Railway deployment **7ad18815-c90f-451c-aae6-5eaf55f9fbf2** was independently observed **SUCCESS**. Native remains 01e35a1b84ecb11f6a907eb02932b001542f7c5c / a8fca4c2-9ef9-43e8-a30a-cefdb48afa73; no variables/domains/volumes changed. The agent's initial accept-deploy returned cancelled/user-did-not-approve and was not retried; the staged change was subsequently applied externally and its resulting successful deployment independently verified. This supersedes the preceding checkpoint's pending-deployment status. Later documentation commits are not the deployed source.

### H: real bounded three-person chat

Task d0efab74-f9e6-4168-aab7-2409e7229e29 completed with three actual calls: native plan, Zhipu GLM execute, native review. Native explicitly delegated a plain-text response. At 2026-10-18T11:06:09.614Z, GLM returned `白鸦在线 H8Q2`, message 1f4b49e5-c3e9-4b48-913a-0c0242bb866c; model glm-4-flash-250414, prompt 175 / completion 9 / total 184 tokens. At 11:06:16.128Z native delivered `知微已核对 H8Q2。`, message 3711369f-184a-453a-b2e5-7f7c86adbf45. File count stayed eight; no document tool was invoked. Configured upper-bound cost estimate CNY 0.02495 is not reconciled supplier billing. This is live evidence, separate from model fixtures.

### F: existing cross-day delivery repaired once

Existing task 95b97c1d-ed32-4587-b724-fa99e758d10c was repaired through its existing UI once, not recreated or re-delegated. The stored creation 2026-10-17T03:03:06.075Z and day 2026-10-17 stayed unchanged. Its lifetime calls moved 4 -> 5; one native review was added, no GLM execution was repeated, and contentRepairAttempts is one. New review usage d9b16bcc-1dfb-4004-bb8f-956955e3336f at 11:06:50.039Z: deepseek-flash, prompt 3740 / completion 1490, configured estimate CNY .0672. New final message **a40c14e5-d047-445c-8d76-356fb6f1e77d**, at **2026-10-18T11:07:03.238Z**, publishes these actual files:

| Format | Attachment | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| DOCX | 1afc3a2f-cd57-49de-ad8e-60eac1eef842 | 9916 | 8015adab93dd3559fcef6ae615a8ea70a0cd9ef97c53e1f77f49766b700f518f |
| PPTX | 728a82ff-862e-44b6-9223-3c73e3b6d786 | 188559 | 09e1345b8b16fd0a68c46600f52ad63bf6b1ec80b581eacdb875023fe26fdf64 |
| PDF | 57753b23-2a3f-4538-89a7-3432242b0723 | 118521 | c6364d9a73892ae30f1ce72ef2c757b168bc51bafb672b66506bf21f58d17466 |
| XLSX | 211d577d-0dcb-4733-bfb9-fb3eb20a9f2e | 9790 | a71a4e80d3c537ba43949ddc352a1c28e70c32957ad9a6f70d58de41d10edfb1 |

All four files were downloaded through authenticated UI links; actual SHA256 matches the server receipts. All three Office ZIP CRCs pass. PPT XML independently confirms exactly 20 slides; body Han counts, excluding headings and footers and including the timetable, are **77,78,55,56,63,64,55,63,69,64,53,59,66,66,59,61,61,65,73,78**. All satisfy the explicit 50–80 contract; server inspection has no issues. DOCX includes every slide body (68 paragraphs), XLSX contains all slide headings (68 rows), and PDF contains all 20 section headings over three physical A4 pages. All four contain WORK-LIVE-20261017-F. These are the original downloaded bytes, not locally regenerated replacements.

Original delivered message 657e6442-0469-4173-b4a8-7612e7c2283f and original file IDs 896e2f12-9504-4778-9ef4-e496f44d4a5a, d54c4286-4f69-4b8e-b89d-26f27e5e21fa, 312119e0-4f25-4506-b7ee-5da442d292e5, 3905a8a7-5d95-4359-b9f0-296a3c7463cd remain. Fresh authenticated reload confirms both H/F completed, call counts 3/5, new final messages, all four new attachments and all four old files. Reloaded Work UI displays final receipt and four working links; an actual desktop screenshot was captured.

## Acceptance limits and PR status

- Actual PDF rendered with Poppler and all three pages visually inspected: readable Chinese, no observed clipping/black boxes. It is a basic flowing handout, not a designed 20-page PDF slide deck; literal Markdown heading/pipe-table syntax remains. PPT is 20 slides, while PDF/Word are flowing notes and Excel is a worksheet. Do not call them equivalent visual slide exports.
- PPT/Word/Excel were structurally/content-validated but not rendered in an Office-compatible engine in this environment. Their server visualChecked remains false. Numeric contract and model review are not independent pedagogical/factual approval.
- Focused Work Chromium/iPhone-profile WebKit passes 26/26; physical iPhone remains unverified. Production Service Worker is unchanged.
- Broader full-Web run 39121424894 is still in progress at this checkpoint. Pre-existing memory/log radius/layout/wallpaper assertions were identified on the original baseline and remain separate. No whole-PR green claim and no unrelated test weakening.
- PR40 remains OPEN/UNMERGED, base integration/ziwei-20261016. Preserve both new Work code commits and the existing security patches during later integration. Do not overwrite Native's separate Cron/impressions changes with this Web branch. The accepted security closeout was not reopened.
