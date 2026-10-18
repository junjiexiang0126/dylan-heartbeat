# Work 最终收尾记录（2026-10-18，泰国时间）

## 当前结论与发布基准

本轮 Work 执行故障修复、页面小调整、合并和上线核对已完成。Work 专项通过，不代表全站所有功能零缺陷；下方明确保留全站旧测试与文件视觉验收边界。用户已完成最后部署，本轮不再发起发布或真实模型任务。

| 项目 | 最终记录 |
| --- | --- |
| 仓库 | junjiexiang0126/dylan-heartbeat |
| 整合分支 | integration/ziwei-20261016 |
| PR | #40，已合并（MERGED） |
| 上线/合并代码 SHA | 612126d4492bc16e5c8f997d75d88a67b6f0ac16 |
| UI 修复 SHA | 2ee70b588aeeec6165415eb772bd13a167c7fdde |
| 合并与测试版本代码树 | 6101d58a25014bb5644800ae515091b8c4304284，两者完全一致 |
| Railway Web 服务 | ziwei-home-web-test |
| 实际部署 | 7fa359f3-0315-4b95-a0d3-c8cdf6f461e6，SUCCESS；2026-10-18 18:34:20 +07:00 |
| 源配置 | integration/ziwei-20261016，固定到上述合并 SHA，rootDirectory=/ziwei_web |
| Hermes Native | 01e35a1b84ecb11f6a907eb02932b001542f7c5c，部署 a8fca4c2-9ef9-43e8-a30a-cefdb48afa73，本轮未变 |
| 最终健康核对 | Web 与 Hermes 各1个运行副本，均 Online，无崩溃副本、无平台活动告警、无待应用变更 |

本记录之后的文档提交仅记录结果，不是新的运行代码，不需要重新部署。此前部署被拒的记录属于历史：后来用户已应用暂存变更，以上 SUCCESS 记录为最终状态。

## 改了什么、为什么、后续去哪里改

| 修改位置 | 修改内容与原因 | 后续检查要点 |
| --- | --- | --- |
| ziwei_web/work_service.js | 聊天模式不再向委派模型开放文档工具，审核明确交付文本，避免“不想要文档”的对话仍被转成文档任务 | auto聊天不能被规划结果升级成bundle；显式选工具时仍走原有授权和实际执行路径 |
| ziwei_web/work_service.js | 复用一次性交付修订，允许跨天修订原任务；旧任务新增调用计入实际执行日额度 | 不更改原任务日期、原文件、历史费用；保留单任务7次/每日48次/一次修订/并发和费用限制 |
| ziwei_web/public/work.js | 工具中心用格式标识、名称、状态和授权/使用按钮；文件标题、保存、停用收进默认折叠的设置；删除逐卡重复说明 | 保留configure的revision校验和权限请求，不把“使用”变成隐式授权 |
| ziwei_web/public/index.html、work.css | 连接检查改为整行44px基准触控按钮；紧凑工具卡、清晰边框与层级 | 颜色、字号、间距、圆角沿用主题变量；组件变量--work-tool-touch、--work-tool-card-radius可继续调整 |
| ziwei_web/public/index.html、work.js、work.css | workStatus从输入框后移到work-feedback，位于聊天记录上方；有持久化任务状态后清除“任务已受理” | #workForm之后不得重新添加独立状态段落；提示/错误不能夹在输入框和导航栏之间 |
| ziwei_web/playwright.config.js | 只在隔离测试禁用Service Worker，使WebKit正确拦截模拟接口；保留失败截图与trace | 生产Service Worker未修改；不能把模拟接口测试写成真实模型验收 |
| ziwei_web/e2e/work-studio.spec.js | 增补连接按钮大小、折叠设置、状态位置、320/390/430宽度和截图 | 模拟iPhone WebKit不是实体iPhone验收 |
| .github/workflows/work-checks.yml | 保留浏览器验收产物，供复查真实渲染 | work-browser-evidence默认保留7天，过期后按工作流重现 |

关联代码提交：94b2998afa3e688817e830296077aaf682139f55（聊天与浏览器隔离）、84cc5bdf5ff626d81d58b05ee0ccc2171ddb7300（跨天修订计费）、2ee70b588aeeec6165415eb772bd13a167c7fdde（本轮UI）。未整体合并Native的独立开发分支，Cron与今日印记相关差异未被覆盖。

## 已验证的证据

- 最终UI代码的Work工作流39122966681 / job117662158755为SUCCESS：45/45 Work测试、18/18 Native Work隔离测试、28/28 Chromium与iPhone配置WebKit浏览器测试通过；语法与差异检查通过。
- 浏览器专项包括移动端320/390/430、工具中心、搜索引用、原任务恢复和修订、私人聊天回归。实际WebKit截图已查看；产物ID12135037813，名称work-browser-evidence。自动化模型请求为测试替身，不是GLM真实调用。
- 真实模型与文件验收沿用下方H/F证据：H完成知微委派→实际GLM回复→知微审核；F原任务只追加一次知微修订，PPT恰好20页、每页50–80汉字，实际四格式下载与SHA256一致、旧文件保留。UI收尾不重复消耗模型次数。
- 新部署后真实登录会话恢复，Work页面加载正常；工具中心实际5张卡，设置均默认折叠，连接检查按钮实测337×44 CSS像素（本次桌面视口）。点击检查返回“知微已连接 · 白鸦已配置”，该按钮不调用模型。
- 新部署页面实测work-feedback在输入框上方，workStatus为空，无“任务已受理”残留。输入框底部840、导航栏顶部848 CSS像素，无交叠。
- 新部署仍显示H最终消息3711369f-184a-453a-b2e5-7f7c86adbf45、F最终消息a40c14e5-d047-445c-8d76-356fb6f1e77d，新四文件与旧四文件链接全部保留。没有重跑任务、重做文件或删除历史。

## 未完成与不应误报的事项

- 全站Web工作流39121424894（代码84cc5bd）结果：204通过、28失败、2跳过。与修改前6d9b4a7的工作流39093507979（92失败）逐一对照失败测试名称，剩余28项均为基线已失败名称，零新增失败名称，64项转为通过。剩余包括记忆/日志样式、部分WebKit语音、壁纸、Face ID等测试；不能宣称这些问题已解决或把全站称为全绿。
- 最终UI代码的全站工作流39122966553 / job117662157957最终为FAILURE：205通过、29失败、2跳过。28项与上次相同；另外1项为Chromium的raven.spec.js“unavailable WebGL has an honest static fallback and a retry entrance”，在对隐藏的#ravenCanvas执行scrollIntoViewIfNeeded时60秒超时。该项相对已核对基线是新增失败名称，不能声称零新增。此次Work没有修改渡鸦运行代码或该测试；具体时序原因尚未复现确认，单独登记为待排查测试，不伪造通过、不将其归为Work已经修复的问题。Work专项28项均通过。
- 实体iPhone、PPT/Word/Excel的Office引擎视觉验收仍未完成。PDF已渲染可阅读，但属于基础流式讲义，仍有Markdown标记；不是设计型20页PDF幻灯片。数值检查不等于内容教学准确性或精美排版验收。
- 费用为配置估算，不是供应商账单对账。原有额度仍有限制，未把每天三四份复杂文件一概保证为可完成。
- 已被用户接受并停止的Hermes私网安全工作没有重启；不据本轮结果推断其他旧公网依赖已验证。没有读取密钥值、更改人格/记忆/自主规则、重建服务、迁移或删除持久化数据。

## 以后修改的最小核对顺序

1. 从整合分支的最新提交开始，先核对Railway实际source.commitSha，不把旧分支或文档SHA当运行版本。
2. 样式只改Work组件与主题变量；保留原五页和私聊。使用320/390/430宽度检查工具面板、输入框、导航栏；授权/使用与设置分开，状态始终在输入框上方。
3. 运行npm run check、npm run test:work，以及工作流中Work/私聊的Chromium与WebKit专项；变更后检查产物截图。
4. 只有执行链路改动才安排有预算的合成真实任务；使用唯一标记，检查实际usage、最终回执、真实下载字节与刷新持久化，避免重复修订已使用过的一次性任务。
5. 发布只更新Web测试服务并确认SUCCESS、实际SHA、保留原文件。Native独立分支的Cron/今日印记差异要逐项整合，不能用Web分支整体覆盖。

---

# 前序真实验收证据（保留，以下旧状态以上方最终记录为准）

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
