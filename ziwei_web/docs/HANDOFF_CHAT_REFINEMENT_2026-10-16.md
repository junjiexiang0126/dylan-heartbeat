# 聊天交互与整体样式交接 · 2026-10-16

本次变更仅在 ziwei_web/，提交 SHA 见当前提交与 PR。基于最新整合头 540ad912，纳入前序日记天气/心情提交 56b32607，再叠加本次修改。合并本 PR 即包含前序 PR #26 的前端改动，无需重复拣选。

## 用户要求与结果

- 五页统一樱花粉/奶油白、柔和玻璃表面和深色主题。背景图片保持清晰，玻璃作用于卡片、状态、输入栏和气泡；五个底部页签、日志和记忆各四入口保留。
- 设置新增玻璃通透度、降低透明度及本机空间壁纸。全局壁纸可用于五页；聊天自选背景优先于空间壁纸。空间壁纸仅存本机 IndexedDB，锁定后立即隐藏并清除显示层 src，不上传后端。
- 气泡、菜单操作、代码区和输入区统一间距与颜色，字号改变时气泡内边距和圆角跟随缩放。新消息采用轻量入场效果；不会伪造输入状态或修改服务端时间。
- 文件卡片进入站内文件面板，固定提供右上关闭、底部返回、保存/分享。文本直接预览，PDF/DOCX/XLSX 通过已有提取器做文字预览；无法提取时仍保留完整文件保存入口。保存前先准备完整 File，再由一次新点击打开系统分享，避免 iOS 异步请求耗掉分享手势。iPhone PWA 不支持文件分享时明确提示用 Safari 保存，禁止自动跳入无法返回的原生预览。
- 所有原有保存入口默认交给站内面板，兼容图片和语音下载。桌面下载仍交给浏览器；发出下载请求不宣称文件已落盘。
- 新增“显示思考摘要与执行进度”展示开关，默认关闭并记住本机选择。只展示实际提供的 summary、已有过程消息及工具进度，不读取或生成私人日记、私人记忆或模型内部逐步推理。
- 前序日记天气/心情展示仍在补丁内，字段缺失显示未记录，真实字段继续由原生负责人提供。

## 知微自主选择分段的传输约定

普通文本保持一条；不按字数、换行或标点拆分。前端服务在准备本轮发往 Hermes 的 input 时附加可选展示约定，不修改 SOUL、人格文件、记忆或原生配置，也不改变原始用户消息的保存内容。

知微若选择多条，返回：

```json
{"type":"ziwei.reply.v1","messages":["第一条完整消息","第二条完整消息"],"summary":"可选的简短结论依据或行动摘要"}
```

仅接受这个显式类型且有 1–20 个非空字符串的消息数组；代码块留在同一条中。普通或无效 JSON 原样作为一条保存。可选外围 JSON 代码围栏可识别。附件 MEDIA: 原路径行放进最后一条。

每一项成为独立、稳定 ID 的真实 Web 聊天记录，按 Agent 的原顺序保存；最后一条沿用 reply-<requestId>，继续兼容附件回传和朗读。完整原始输出保存在同一 ChatStore 的 presentation:<requestId> meta，摘要独立为 summary 记录。使用现有事务、run 去重和恢复机制；没有第二记忆库、没有新增数据库或后台定时任务。

集成测试验证两条消息与摘要分开保存、原始输出不丢、重启后仍为两条、同一 run 不执行第二次。真实模型可选择不分段；并非每次都强制生成消息数组。原生历史档案导入逻辑本轮没有重构。

## 静态文件与页面安全

新增 chat-render.js、file-viewer.js、theme-init.js、refinement.css 均已加入 server.js 的显式白名单。theme-init.js 承接原有启动取色脚本，避免被现有 CSP 阻止；未放宽 CSP。移除旧 viewport-debug.js 的失效引用，保留该旧文件。

摘要、消息、代码及文件名/预览均通过 textContent 写入；不运行回复或附件中的 HTML。文件读取和新增文字预览仍受现有 Web 会话鉴权保护，预览 ID 由既有附件校验处理，没有任意路径访问。

## 文件清单

- `ziwei_web/chat_presentation.js`
- `ziwei_web/chat_service.js`
- `ziwei_web/docs/HANDOFF_CHAT_REFINEMENT_2026-10-16.md`
- `ziwei_web/e2e/chat-files.spec.js`
- `ziwei_web/e2e/chat-mvp.spec.js`
- `ziwei_web/e2e/chat-refinement.spec.js`
- `ziwei_web/e2e/log-entrances.spec.js`
- `ziwei_web/package.json`
- `ziwei_web/public/chat-render.js`
- `ziwei_web/public/chat.js`
- `ziwei_web/public/file-viewer.js`
- `ziwei_web/public/index.html`
- `ziwei_web/public/records.css`
- `ziwei_web/public/records.js`
- `ziwei_web/public/refinement.css`
- `ziwei_web/public/save-file.js`
- `ziwei_web/public/theme-init.js`
- `ziwei_web/public/tokens.css`
- `ziwei_web/server.js`
- `ziwei_web/test/bridge.test.js`
- `ziwei_web/test/chat_presentation.test.js`
- `ziwei_web/test/save_file.test.js`

## 验证命令与实际输出

工作目录 ziwei_web/。

```sh
npm run check
npm test
```

语法检查退出码 0。最终单元/集成测试：

```text
ℹ tests 63
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

本机仍使用前次披露的临时 Chromium 153（官方 Playwright 浏览器下载受当前环境限制），临时配置继承仓库配置并指定浏览器及服务工作目录；中文 Noto Sans SC 字体仅用于本地验收，没有增加产品依赖。实际完整浏览器命令：

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/design-previews TMPDIR=/tmp \
npx playwright test --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js
```

```text
88 passed (2.2m)
```

最终完整套件 88 通过、0 失败，退出码 0。其后针对未完成的 JSON 展示封包不应出现在流式预览这一小调整，重跑 chat-refinement.spec.js；实际输出 `4 passed (11.7s)`，退出码 0。

此前 chat-mvp 的既有失败用例给 /api/chat/requests 注入了恢复状态，但当前客户端从 /api/chat/messages 的 requests 字段恢复。本次只修正测试模拟响应，使其匹配实际接口；没有绕过断言或为它修改产品恢复行为。

检查了 320/390/844 宽度、明暗主题五页截图、输入区和底部导航、代码横向滚动、文件下载完整字节、PWA 分享取消及不支持分享时不打开新窗口、摘要选择持久化、真实数据清理及四入口。壁纸的锁定隐藏与本机持久化另有验收用例。

## 没做 / 做不了 / 未验证

- 本轮仅提交和创建统一 PR，未合并共享分支、未部署，未对这个新版本进行线上 SHA-256 验收。已部署的旧提交不能作为本补丁上线的证据。
- 没有修改 hermes_native/、WeCom 补丁、记忆、SOUL、Cron、Railway 服务配置、环境变量或持久化卷；后端测试没有在本轮重跑。
- 未进行真实 iPhone/Safari/WebKit 验收。自动化中的 iPhone PWA 场景是浏览器模拟，不替代设备上的系统分享面板验收。
- 未通过线上账号发送真实试验消息；真实 Hermes/DeepSeek 是否选择新格式、分段及摘要质量，需部署后在真实聊天中核验。测试回复均来自隔离协议 fixture，不冒充真实 Agent 行为。
- 展示开关不改变模型内部推理模式或预算，不承诺显示内部完整思考链。没有摘要时不伪造摘要。
- PDF/Office 是尽力提取的文字预览，不是原版式渲染；部署环境缺提取器时会明确提示不可预览，但文件保存/分享和关闭返回仍可用。
- 原生日记标题/心情/天气/可见性等真实字段及 shared/private 过滤仍由知微负责，照片墙出图未接入。

## 统一部署交接

1. 后端负责人先提交需要一同发布的原生成果，合并本 PR 时保留双方最新结果。本 PR 本身不包含未提交的原生补丁。
2. 对齐实际跟踪分支与最终提交，不能只更新 integration 而让 Railway 关联分支仍停在旧头。此操作可能触发两侧自动部署，应由统一发布负责人协调，本轮没有擅自推进。
3. 用合并后的最终完整 commitSha 显式部署现有网页服务，不使用本机临时提交或一个过时的分支头。新前端服务代码需要更新 Web 进程；不需要为本次前端修改重启原生网关。
4. 重新下载白名单静态资源，与最终提交逐字节并核 SHA-256（包括新增脚本/CSS、index、chat、tokens、save-file）。保留当前稳定提交作回滚点。
5. iPhone 验收：点击文件卡片→预览→保存/分享→取消或返回→关闭回到原聊天；知微自主选择多段或长代码；开关摘要；切换五页、明暗主题和本机壁纸。只对 shared 日记做展示验收，私密过滤单独由原生负责人验收。
