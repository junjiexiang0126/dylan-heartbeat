# 记忆与日志页面结构交接

基线 integration/ziwei-20261016 @ afa25e1af4fb3e7878de87b7fec763c0dcf1b5df（已包含 PR #28 的三项补丁）。本提交仅处理两页结构、样式和相应浏览器测试。提交 SHA 以本 PR 头提交为准。

## 行为

- 日志首页保留工作 / 个人 / 私人 / 照片墙四个入口，点入独立阅读页后隐藏首页入口、全局页头及底部导航；标题下面显示总条数与原生记录的最近更新时间。未知时间明确显示“未提供”，核对后台时间单独保留，不冒充记录更新时间。
- 纸页横向推入；减少动态效果偏好下不播放动画。左上返回与浏览器 history 后退/前进走同一路径，支持 iOS 原生侧滑所依赖的历史记录。iOS 手势本身尚未真机验证，没有额外绑定冲突的自定义边缘触摸手势。
- 工作日志是一行省略摘要的时间线，点条目进完整原文；已有列表返回的 preview 是工作记录完整 body，沿用它，不调用后端不支持的 work?id。状态、证据、来源与原文仍保留。搜索放入右上图标，按原查询参数搜索。
- 私人日志继续不发请求，没有条数、日期或内容；照片墙仍只显示未接入说明。迟到响应不会写入这两个页，回退也会清除旧列表显示。锁定后清除原文及页面缓存，历史前进不能重新打开旧数据。
- 记忆首页主卡为“全部记忆”，未分类数量和入口在主卡内，计数取接口 total / counts，不累加可能重复归类的分类数量。主卡摘录直接使用原文第一行；关于你 / 工作记忆为两个副入口，计数不超过 1 时降为页脚小字。关于知微与长期记忆保留页脚入口，不丢分类。
- 记忆的全部、未分类及各分类均能进入只读原文页面；搜索、保护状态和来源说明保留。没有重新归类或写入记忆。
- 颜色、字号、间距、纸页动画、主副入口尺寸与阅读页边距通过 tokens 配置。新样式只作用于这两页或阅读页激活期间，没有增加脚本，因此静态白名单无需新增。

## 文件清单

- ziwei_web/public/index.html
- ziwei_web/public/records.js
- ziwei_web/public/records.css
- ziwei_web/public/tokens.css
- ziwei_web/e2e/record-pages.spec.js（新增）
- ziwei_web/e2e/records.spec.js
- ziwei_web/e2e/memory-entrances.spec.js
- ziwei_web/e2e/log-entrances.spec.js
- ziwei_web/e2e/design-tokens.spec.js
- ziwei_web/e2e/chat-refinement.spec.js（仅更新记忆入口结构断言）
- ziwei_web/docs/RECORD_PAGES_STATIC_SHA256_2026-10-16.txt
- 本交接文件

## 验证命令与实际输出

```sh
npm --prefix ziwei_web run check
npm --prefix ziwei_web test
```

```text
check: exit 0
ℹ pass 69
ℹ fail 0
ℹ skipped 0
```

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/record-previews TMPDIR=/tmp \
ziwei_web/node_modules/.bin/playwright test \
 --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js
```

浏览器为当前环境可用的 Chromium，配置沿用仓库 e2e_server 隔离数据与测试密码，仅覆盖本机浏览器执行路径；仓库标准命令是 `npm --prefix ziwei_web run test:e2e -- --project=chromium`。

首次单进程执行在记录 62 项通过后中断，未取得完整回执，不把这次执行当全套通过。最终按文件拆为两批，覆盖清单中的全部 96 个不同测试，使用同一配置与隔离数据目录；各批加独立 --output 路径。文件参数分别为：

```text
chat-appearance.spec.js chat-audio.spec.js chat-call-screen.spec.js chat-completion.spec.js chat-compose.spec.js chat-files.spec.js chat-font.spec.js chat-minimal.spec.js chat-mvp.spec.js chat-profiles.spec.js
chat-refinement.spec.js design-tokens.spec.js face-id-entry.spec.js interactions.spec.js log-entrances.spec.js memory-entrances.spec.js moments.spec.js phase1.spec.js phase2.spec.js record-pages.spec.js records.spec.js
```

```text
第一批：45 passed (1.5m)
第二批：50 passed (2.4m), 1 failed
```

第二批唯一失败是旧测试仍断言四张 `.memory-entry`，而本次规格要求一主两副，共三张。更新这条结构断言并增加主卡和页脚入口检查后，仅复跑该文件（产品代码没有再改）：

```sh
# 上述 Playwright 命令追加文件参数
chat-refinement.spec.js
```

```text
5 passed (16.4s)
```

因此清单中 96 个不同测试均取得通过记录，未解决失败为 0；这不是一次连续全量执行的绿色回执。两页定向 15 项在最终产品代码上另跑，实际输出 `15 passed (28.8s)`。

新增的三项浏览器测试覆盖：二级页无底栏、工作摘要到完整原文、历史后退/前进、私人页零请求、20 条未分类主入口、0/1 条分类在页脚、分类只读、深浅主题、320/390/900 宽度、锁定清除与历史前进隔离。既有测试继续覆盖迟到响应、接口错误、原文 XSS 与样式变量。

截图使用 Chromium 390×844 视口与明确标注的隔离测试文字，仅作浏览器证据，不是真实日记，也不是真机。

## 没做 / 做不了 / 未验证

- 缺少 `知微之家-二级页草图-20261016.docx`：当前收到的 v2 清单没有内嵌图片，按标题及“二级页 草图 四合一”查询均无匹配；只落实用户这次明确写出的结构，未声称与四张草图一致。需要原 docx 或四张原图再逐项比对，尚未验收这一项。
- 无可控制的真实 iPhone，未取得真机深浅截图；Safari/PWA 侧滑、safe-area、系统字体与触感仍未验证，不能用 Chromium 截图替代。
- 未部署、未核对线上字节或 SHA256。新增指纹文件仅是本提交四个静态文件的候选值，不是上线证明。
- 未改数据接口、后端分类与保护规则、只读口径，未动原生目录、记忆文件、SOUL、Cron、服务器配置、环境变量与卷；未跑原生测试。
