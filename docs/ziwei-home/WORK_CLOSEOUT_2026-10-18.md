# Work closeout checkpoint — 2026-10-18 (Asia/Bangkok)

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

## Existing live evidence, not a fresh repair

Authenticated GET /api/work/messages returns the actual persisted model usage and file receipts. Today at 2026-10-18T10:44:29.089Z, task 3b0e5d61-49cf-4ac7-8996-33419cf5f311 recorded GLM execution (glm-4-flash-250414, prompt_tokens=119, completion_tokens=23), followed by native review and a completed chat. Task dcc11663-6f00-4da2-8eb5-04b1ab557b16 retains the previously accepted real four-format delivery. The production source calls the actual Zhipu endpoint; no API key value was inspected. Usage-based configured estimates are not reconciled provider billing.

Today's failed conversation tasks also remain unchanged: 4f9c21e6-22e5-4f43-a3e0-3207755f5b92 failed invalid_work_tool_arguments; 01a751d2-7f41-4ca1-afdf-b9072c104e26 failed work_coordinator_tool_call_required. The user subsequently said no document was wanted, so the old conversation was not resumed to manufacture an unwanted document.

F remains task 95b97c1d-ed32-4587-b724-fa99e758d10c. Its existing completed message and four originals are retained. Its documented first slide is 141 Han characters instead of 50–80. New strict content acceptance has NOT yet passed.

## Deployment boundary and next exact action

The environment was empty of staged changes before this request. Only Web source.commitSha is staged: 6d9b4a738108723ec1612a85c31b260bec75c99a -> 84cc5bdf5ff626d81d58b05ee0ccc2171ddb7300, patch 5e0ff6e7-dd27-47db-97a0-ec13f64ef478. Native and all variables/domains/volumes remain untouched.

accept-deploy returned: Cancelled — the user did not approve this action. No changes were made. It was not retried or bypassed. Until a new deployment is independently observed SUCCESS, the patch is not live and the new live acceptance remains pending.

After applying that single staged Web change and checking exact SHA, perform one bounded synthetic three-person chat with no files and verify real GLM usage / native review / no generated files. Then click the existing 检查并修订交付文件 for F once. Do not create F again, re-delegate it, re-call GLM for F, clear data, reset counters, replay a failed repair, or delete the originals. Download the actual new four files, check all 20 PPT slides and each 50–80-character body, confirm original IDs/files still exist and refresh preserves the new receipt. Report model or delivery failure truthfully if the single repair does not pass.

PR40 stays open/unmerged pending actual deployment, live acceptance, and clearly separated unrelated full-Web visual failures.
