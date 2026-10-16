# 参考图视觉改版交接 · 2026-10-16

本补丁继续更新 PR #27，父提交为 2b74b80efd730bc67553cfcea09f925df3220126；最终完整 SHA 以 PR 头和交接消息为准。包含该 PR 中已有的知微自主分段、文件关闭返回、思考摘要显示开关、日记天气/心情显示。整合分支核对仍为 540ad9120640f96f1918f3953b39a096b87fe8d7，未覆盖新的原生成果。

## 本轮变化

- 以用户第二张参考图的奶油粉、纸张肌理、细线和手账层次为主，结合第一张的聊天气泡与第三张的一致性。原创 SVG 纸纹包含淡水滴、心形与飘带，没有复制参考图中的人物、文字、品牌或照片。
- 首页加入手账标题、真实日期日历、贴胶带的日记入口、横线纪念信笺；双头像、相伴天数、相识日期及今日状态仍来自既有数据。未确认的相识日期继续待确认。日历按 Asia/Bangkok 标记今天，只展示普通月历，不声称某天写过日记，不显示私人篇章统计。
- 日记便笺打开既有日志页并选中个人日志；没有新增原生接口或照片墙功能。私人日志依然只有说明，照片墙依然标记尚未接入。
- 消息操作改为细线图标，保留原回调、中文可访问名称及悬浮提示；收藏同时提供 aria-pressed。双方头像、代码原文与复制、长文展开仍保留。每条消息时间显示到秒，统一 Asia/Bangkok。
- 五页、文件面板、导航、表单和明暗主题共用纸感配色、细边和轻阴影。自定义空间/聊天壁纸覆盖装饰层且保持清晰，原有字号、玻璃通透度、降低透明度设置继续生效。首页心跳线改为静态。
- 新资源 /paper.svg 进入 server.js 显式白名单；已验证 HTTP 200 与 image/svg+xml。未放宽 CSP、未添加产品依赖。

## 本轮文件

1. ziwei_web/public/index.html
2. ziwei_web/public/app.js
3. ziwei_web/public/chat.js
4. ziwei_web/public/chat-render.js
5. ziwei_web/public/refinement.css
6. ziwei_web/public/tokens.css
7. ziwei_web/public/paper.svg
8. ziwei_web/server.js
9. ziwei_web/e2e/chat-refinement.spec.js
10. ziwei_web/docs/HANDOFF_PAPER_JOURNAL_2026-10-16.md
11. ziwei_web/docs/PAPER_STATIC_SHA256_2026-10-16.txt

全部在 ziwei_web/；未触及原生目录、记忆文件或平台配置。

## 验证命令与实际输出

工作目录 ziwei_web/：

```sh
npm run check
npm test
```

语法检查退出码 0；单元/集成测试实际输出：

```text
ℹ tests 63
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 23330.43912
```

第一轮定向浏览器验收：

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/design-previews TMPDIR=/tmp \
npx playwright test --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js e2e/chat-refinement.spec.js
```

```text
5 passed (16.5s)
```

最终完整浏览器命令：

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/design-previews TMPDIR=/tmp \
npx playwright test --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js
```

```text
89 passed (2.8m)
```

最终完整浏览器套件 89 通过、0 失败，退出码 0。首轮全套日志只到第 50 项、没有末尾汇总，未据此计算全套通过数；上述为补跑后的明确结果。本轮最终没有失败项需要归因到基线。

继续使用前次披露的临时 Chromium 153 与继承仓库配置的本机验证配置；中文字体仅供本地视觉检查。没有改变依赖。检查 320/390/820/844 等尺寸、深浅主题五页实图、输入与导航间距、图标按钮原行为、代码、文件返回、摘要持久化以及壁纸退出清理。新增月历验收覆盖 UTC 与曼谷跨日、31 天和周前空格，并验证只进入 shared 日记入口。没有把普通月历装饰算成后端日记数据。

## 候选静态指纹与部署

PAPER_STATIC_SHA256_2026-10-16.txt 给出当前 server.js 映射的全部 25 个静态响应体候选指纹。它只描述提交文件；不代表线上已更新。部署负责人应先整合双方成果、对齐实际跟踪分支，再用最终完整 commitSha 显式部署，并下载响应体逐字节比较。若合并后修改了静态文件，应以合并后的树重新计算指纹。

本轮核对 Railway 网页最新成功部署仍是 7e4c0802-7554-4f3c-bac8-c904bb34a5c4 / 540ad912。跟踪分支 feature/interaction-workbench 当时仍停在 671882c75a29；本轮未自行移动该共享跟踪分支，避免未经协调触发双方部署。上一版线上字节验收不能替代本补丁的上线验收。

## 没做 / 做不了 / 未验证

- 未合并整合分支、未触发部署，未做这个候选版本的线上 SHA-256 验收。
- iPhone 真机、Safari/WebKit、实际系统文件分享面板未验证；浏览器中的 PWA 模拟不等价于真机。
- 未发送线上试验消息，真实 Hermes 是否选择分段及摘要质量仍待发布后核验。思考摘要开关不提供模型内部完整推理链，不改变模型内部推理预算。
- 未改原生网关、WeCom、记忆、SOUL、Cron、服务器配置、环境变量或持久化卷；未跑或宣称原生 29 项测试全绿。
- 日记真实 title/weather/mood/visibility 字段和 shared/private 过滤仍由原生负责人交付。前端不推断天气/心情，也没有绕过 private 的入口。
- 照片墙、图片入站、教师个人评估及家长小结泰文栏未做，继续保留既有边界。
