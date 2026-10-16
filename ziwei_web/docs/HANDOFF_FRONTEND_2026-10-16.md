# 知微之家前端交接验收 · 2026-10-16

本次代码与本报告同一提交，提交 SHA 见 GitHub 提交页或 `git rev-parse HEAD`。基础提交为 `671882c75a29aa49b03a2a9c1aa3b02c64bf37ce`。只修改 `ziwei_web/`。

## 实际改动

- 线上日志页基线只有两个切换按钮。本次补为工作日志、个人日志、私人日志、照片墙四张入口卡。
- 工作日志与个人日志继续读现有 Web 适配接口；个人日记卡标题仍直接使用原生 `title`，没有用日期补标题。
- 私人入口只显示说明，无读取接口、条数、日期、标题、全文或可见性开关；刷新、可见性变化和定时轮询不会为这个入口发请求。切换后使旧请求失效，迟到的共享响应不能重新填充列表。
- 照片墙仅说明尚未接入，没有上传、出图或假照片。
- 新增 `--log-entry-*` 变量控制颜色、间距、圆角、字号和卡片高度；原记忆四入口及底部五页签没有重排。
- 五处写死的 `/workspace/scratch/<hash>/` 截图、两处向项目外写图的相对路径，统一使用 `SCREENSHOT_DIR/<browser>/`。未设置时使用 `testInfo.outputPath()`。
- 阅读位置测试隔离 EventSource：继续检查游标和手工派发的 archive 事件，但不接收其他真实测试事件，避免读取次数被无关流事件干扰。未改产品聊天代码。
- 没有新增浏览器脚本；新增 helper 仅供测试使用，无需加入服务静态白名单。

## 改动文件

| 文件（均位于 ziwei_web） | 用途 |
|---|---|
| `public/index.html` | 四日志入口、说明区与阅读区 |
| `public/records.js` | 入口切换、禁止私密读取、迟到响应隔离 |
| `public/records.css` | 变量化入口样式 |
| `public/tokens.css` | 日志入口样式变量 |
| `e2e/helpers/screenshot-path.js` | 可配置截图路径 |
| `e2e/records.spec.js` | 截图路径、隔离事件源 |
| `e2e/memory-entrances.spec.js` | 截图路径 |
| `e2e/face-id-entry.spec.js` | 截图路径 |
| `e2e/moments.spec.js` | 截图路径 |
| `e2e/log-entrances.spec.js` | 私人边界、迟到响应、原生标题、样式覆盖验收 |
| `docs/HANDOFF_FRONTEND_2026-10-16.md` | 本报告 |

## 验证命令与输出

工作目录：`ziwei_web/`。本地安装依赖使用 `npm ci --ignore-scripts --no-audit --no-fund`，未修改 lockfile。

### 语法、单元测试、截图路径

```sh
npm run check
npm test
```

语法检查退出码 0。单元测试实际输出：

```text
ℹ tests 58
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

额外对五个截图相关 JS 文件执行 `node --check`，均退出码 0；Node assert 验证未设置目录、指定目录、Chromium/WebKit 路径隔离，输出：

```text
screenshot paths: default + override + browser isolation PASS; 5 files syntax PASS
```

### 浏览器测试

本机没有 Playwright 官方浏览器。`npx playwright install chromium webkit` 在 Chromium 下载阶段失败，输出 `End of central directory record signature not found`，WebKit 未安装。

因此使用临时安装的 `@sparticuz/chromium@153.0.0`（`Chromium 153.0.8010.0`）执行 Chromium 测试。临时配置继承仓库 Playwright 配置，仅覆盖测试/输出/服务工作目录与本地浏览器路径及启动参数，移除包默认的 `--single-process` 和 `--disable-web-security`。使用 `/etc/fonts`；临时浏览器、配置和依赖均未写进项目。该结果不能替代官方固定版本及 iPhone WebKit 验收。

实际全量命令：

```sh
FONTCONFIG_PATH=/etc/fonts \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/previews TMPDIR=/tmp \
npx playwright test --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js
```

最终完整复验实际输出：

```text
1 failed
  [chromium] › e2e/chat-mvp.spec.js:76:1 › existing requests show their actual server state after entry
82 passed (2.0m)
```

测试命令退出码为 1，因上述基线失败，不宣称整套全绿。新增 2 条日志入口用例通过。

原先受截图路径影响的 5 条用例已实际跑过截图步骤，日志、记忆相关独立运行结果 `8 passed (12.9s)`。

首轮全量曾出现 `81 passed / 2 failed`；其中阅读位置用例出现 `Expected: 3 / Received: 4` 的读次数波动。隔离其事件源后定向重复运行三次，输出 `3 passed (9.6s)`。未修改基线的同一位置用例定向重复三次也通过，因此不宣称已经在基线上复现此偶发计数失败。

保留的基线失败：`chat-mvp.spec.js:76`，期望 `#chatWork` 为“恢复连接中”，实际为空。使用干净 worktree `671882c7` 和同一临时浏览器配置单独复验：

```sh
playwright test --config=/workspace/scratch/97e6279ec1ad/playwright-baseline.config.js \
chat-mvp.spec.js -g 'existing requests show their actual server state after entry'
```

```text
Expected: "恢复连接中"
Received: ""
1 failed
```

这验证了它是修改前已有的失败；未擅自修改产品聊天行为或放宽断言。

## 线上版本与字节校验

通过 Railway 插件读取测试环境 `eddf4e4f-1199-45a1-8397-5053c7e9586d`；没有部署或更改服务配置、源绑定、密钥、环境变量与卷。

| 服务 | 实际部署 | 实际提交 |
|---|---|---|
| 网页 `ziwei-home-web-test` | `2aa7e787-606f-44bd-9ebd-e10c96ab140c` / SUCCESS | `671882c75a29aa49b03a2a9c1aa3b02c64bf37ce` |
| 原生 `ziwei-hermes-test` | `36218947-79c0-41c9-96d1-5dcbbead9c38` / SUCCESS | `1bf58d9e0b33d48c955cf2b53ab7b5dd403a184e` |

两个服务都跟踪 `feature/interaction-workbench`。读取时该分支与 `integration/ziwei-20261016` 均指向 `671882c7`，整合分支已不再停在交接所述的 `1bf58d9e`。

在修改产品文件前，按 `server.js` 白名单对线上静态资源取回原始字节、对比 `671882c7` 文件并计算 SHA-256，实际输出 `live static files: 20 matched / 20`。以下是**现有线上旧提交**的证据，不能当作新提交已部署的证据：

| 路径 | 线上及 671882c7 SHA-256 | 结果 |
|---|---|---|
| `/tokens.css` | `ce055d88062f2a2938a174f98a0f7f2538f1de2cea71996eca589d6145b9a8f9` | 200 / 一致 |
| `/records.js` | `8b627b2a42e183b6774e31b61080a7947d12109b3c418083571952e84f78f84f` | 200 / 一致 |
| `/records.css` | `d16ac33c344a4b17575a16c12d3abe80005ed8068b3087012e91c2bcb02a7679` | 200 / 一致 |
| `/save-file.js` | `9211ac6f3fb2493d223aeca4e2dcaac89281933fb3ae08a079011b60173718d1` | 200 / 一致 |
| `/` | `029ee0020ed0d8bbbe7598f6d324eefba12990f6266a4de8401150c0692b3a8d` | 200 / 一致 |
| `/index.html` | `029ee0020ed0d8bbbe7598f6d324eefba12990f6266a4de8401150c0692b3a8d` | 200 / 一致 |
| `/app.js` | `d0354915f7c3993784cc289b29f074ae04598fab9189814c1b3917904e120418` | 200 / 一致 |
| `/chat.js` | `33aece6823dcb4d8030706f90e47b13f34e9f39c01805c3ede271d66123d3dd6` | 200 / 一致 |
| `/chat-extra.js` | `9787b929f995211490e5c7739ad0136c3e5a3eb52da05e36e0b57c2b98376d1c` | 200 / 一致 |
| `/chat-call.js` | `993327ed944b53a85d7a9f2f776c831741806230224251d639f51cb948ea3f1e` | 200 / 一致 |
| `/workbench.js` | `30153f2f0e5cb818e72f489ae77f2f9f25e75b1832186699a1cff4cd4de545ec` | 200 / 一致 |
| `/moments.js` | `d93357611b58d0c385edcbf59d0ed8551d066595f7ff9958ec785f0ec6b741eb` | 200 / 一致 |
| `/moments.css` | `39d4af87177f9d512858923a6c5d14ccaaacaa1048f290ee56b8b6a0d98abaa4` | 200 / 一致 |
| `/style.css` | `8ccfa4c1fe0117b871b909aecb7af416b4cdafae3a68bdff41cb15e1968d59a1` | 200 / 一致 |
| `/chat.css` | `b43f98a35c0d8340108f02f57774e309db609ca3cafde31ed44f17f7a20c5a13` | 200 / 一致 |
| `/manifest.webmanifest` | `9152537729bf1e532f2057c5ddc129512e5acf4a5c6ccae44d86110604736177` | 200 / 一致 |
| `/sw.js` | `9c7c7bfb0700786781693585c1bf0af4b6e086933b0cd476664bfa9d9c3ac288` | 200 / 一致 |
| `/icon.svg` | `0b21fcce89f43fd7ec67f88cb265f528cb7681e071010543efe8a2521d85bb86` | 200 / 一致 |
| `/icon-192.png` | `e3b80df6369f7805d0496fefa7ebfcccbe6328c6f5930e35f897b37db00e126b` | 200 / 一致 |
| `/icon-512.png` | `3084429f2de21c3ec86edf8b3012df937830f05a2bc2da5692c4ecc987493b00` | 200 / 一致 |

原生地址 `https://ziwei-hermes-test-ziwei-hermes-test.up.railway.app`，无 Authorization 头的只读探测输出：

```text
/ziwei/web/memory 401
/ziwei/web/logs 401
/ziwei/web/diary 401
/ziwei/web/diary?id=diary-0000000000000000 401
```

最后一项仍因未鉴权而为 401；它不是“带密钥的未知 id 返回 404”的验收证据。

## 没做 / 做不了 / 未验证

- **未部署、未推进自动部署跟踪分支。** 本轮交付推送提交和 PR；仍有一项确认存在于基线的失败。上线时须先让最终 SHA 包含两侧成果，再显式按 commitSha 部署，重新对新提交逐文件比较字节和 SHA-256；本次旧提交 20/20 校验不能沿用。
- `hermes_native/`、WeCom 补丁、记忆、SOUL、Cron、服务器配置与环境变量没有改动；未重跑后端 29 项测试，不把交接记录的通过数当作本轮实测。
- 没有读取运行环境中的 Bearer 密钥；未复验带密钥的未知日记 id 404、真数据读取与真实私密日记过滤。前端私密入口测试使用隔离数据，不证明已部署原生版本的 shared/private 过滤正确。
- 未运行 WebKit；未做 iPhone 主屏幕 PWA、Face ID、保存/分享、真实中文字形及原生日记内容的真机验收。本机缺少中文字体，截图可核布局，不能据此验收中文字体外观。
- 照片墙上传/出图、图片入站原图缺失、企业微信收文件真机复验、家长小结泰文栏、按学生个人生成教师评估均未做。
- 后端 title/mood/visibility/手写“一句”和“标签”仍由原生侧负责。本轮只验证前端直接使用 title。
- 另发现旧 `index.html` 引用了 `/viewport-debug.js?v=2`，白名单未收录，测试浏览器报告 MIME 拒绝执行；这份旧脚本会默认注入调试浮层，因此未擅自启用。它不是本次新增脚本。
