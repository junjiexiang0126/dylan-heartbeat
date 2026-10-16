# 交接：修「下载后出不去」的 bug（知微代做，2026-10-16）

给 ChatGPT：**语 让你在我这次改动的基础上继续。** 本文只讲我动了什么、为什么、还差什么，你接着往下做就行。

## 一、她报的 bug

> 打开我发的图片文件、点下载之后没有关闭按钮，只能退掉后台重新进来。

## 二、根因（我查过代码，不是猜的）

- 图片走 `<dialog id="chatImageViewer">`，里面有 × 关闭、保存原图、上/下一张、缩放；朋友圈的 `#momentImageViewer` 同样有关闭按钮。**这两个不是问题所在。**
- **文件（非图片）走的是另一条路**：`public/chat.js` 里直接渲染 `<a class="file-link file-card" download>`。点它就是**在当前上下文里跳转/下载**——iOS 的 Safari/PWA 一旦跳进下载页，**没有"返回"这个动作**，所以她只能杀掉 App。
- 同类隐患：`#chatImageSave`（保存原图）、`#momentImageSave`（保存图片）也是 `<a download>`，同样可能把页面顶走。

## 三、我的改动（本轮）

新增

- `public/save-file.js` —— 统一的"保存/分享"入口，三级回落：
  1. `navigator.share({files})`（iOS 弹系统分享面板，"存储到文件"很顺，**页面原地不动**）；
  2. 回落到 `target="_blank" rel="noopener"` 新标签页打开，主页面保持不动；
  3. 都不行就返回 `failed`，由调用方提示，**不假装成功**。
  依赖是可注入的 `env`，所以能在 Node 里单测，不需要浏览器。导出 `window.ZiweiSave = {saveOrShare, bind}`，同时 `module.exports` 便于测试。
- `test/save_file.test.js` —— 6 条单测：分享成功、回落新标签页、用户取消、取不到文件体、无 document 时如实失败、`bind` 必须阻止默认同页跳转。

修改

- `public/index.html` —— 在 `moments.js`/`chat.js` 之前引入 `<script src="/save-file.js" defer>`（顺序不能反）。
- `public/chat.js` —— 两处：语音的"下载原音频"、文件卡片 `<a>`，改为 `window.ZiweiSave.bind(...)`，不让默认跳转发生。
- `public/chat-extra.js` —— `#chatImageSave` 不再同页跳转；`#chatImageViewer` 增加**点浮层空白处关闭**。
- `public/moments.js` —— `#momentImageSave` 同样处理；`#momentImageViewer` 也补了点空白关闭。

## 四、还没做完的（你接手第一件事）

1. **跑测试与语法检查**（我这一轮的检查命令超时了，没拿到结果）：
   `cd ziwei_web && node --check public/save-file.js && npm test && npm run test:e2e`
   我预期会过，但**没跑完就不算过**——如果挂在 `npm test` 上，先看是不是既有用例本身需要起服务。
2. **真机验收**（只有语能做）：iPhone 上点文件卡片的"下载"、点图片浮层的"保存原图"，**都应该不用退出 App 就能回到原处**；浮层点空白应能关闭。
3. **可选增强**：`ziwei-save-result` 事件已派发（`shared` / `opened` / `cancelled` / `failed`），可以据此给一句 toast，比如"已保存"。

## 五、边界（我守的规矩，请你也守）

- 我只动了 `ziwei_web/public/` 和 `test/`，**没碰** `server.js`、Hermes 原生侧（`hermes_native/`）、配置、记忆、Cron。
- 部署用显式 commitSha，线上文件逐字节核对，留回滚点。
- 改动没跑完测试前**不许部署**，也不许说"已修好"。


## 六、环境问题（我今晚查清的，你接手时别重复踩）

1. **这份克隆里没有 `node_modules`**，所以 `npm test` 整套全红——报的是 `Cannot find module '@simplewebauthn/server'`、`server did not start`。这不是代码坏了，是依赖没装。`npm install` 之后服务就能起。
2. **`data_directory.js` 的护栏会在本机误伤**：它拒绝把数据目录放在 `/data` 下，而本容器的 `TMPDIR` 正好是 `/data/hermes_native/cache/scratch`，于是 `os.tmpdir()` 生成的测试数据目录被拦下，报 `Use a separate Web data volume outside the native profile`。
   跑测试时加 `TMPDIR=/tmp` 即可绕过（我实测能让 `webServer` 起来）。
3. **浏览器 e2e 需要 Playwright 自己的 `chrome-headless-shell`**：本机有完整 Chromium（`/opt/hermes/tools/chromium-1208/chrome-linux64/chrome`），但 `headless: true` 走的是 headless shell 那个二进制，所以只靠 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向完整 Chromium 不够——要么 `npx playwright install chromium-headless-shell`（当时下载卡住了，白天网络好再试），要么在配置里改成用完整 Chromium 的 headless 模式。

结论：**改动本身语法检查 + 6 条新单测已全绿**；浏览器级验收还差上面第 3 条这一步。



## 七、实测结果（2026-10-16 上午，知微补）

- 依赖装好后：`npx playwright test --project=chromium` → **75 passed / 6 failed**。
- 那 6 条失败**与本次改动无关**，我在**未改动的基线**（同一提交 `1bf58d9` 的干净工作树）上跑同样几条，**失败的是同样的 6 条**（11 passed / 6 failed）：
  `chat-mvp.spec.js:76`（对 `#chatWork` 文案的断言过时）+ `records.spec.js` 4 条 + `memory-entrances.spec.js` 1 条。
- 这 5 条的失败方式是环境导致的：用例把截图写死在 `/workspace/scratch/<hash>/*.png`，本容器里没有（也不允许创建）`/workspace`，于是 `ENOENT`。**要在这台机器上跑通，得把截图路径改成可变目录（例如 `process.env.SCREENSHOT_DIR`）。**
- 跑测试要带两个环境变量：
  `TMPDIR=/tmp`（绕开 `data_directory.js` 的护栏）与
  `PLAYWRIGHT_BROWSERS_PATH=/data/hermes_native/tools/ms-playwright`（默认路径 `/opt/hermes/tools` 不可写，安装会报 `EACCES`）。
- 结论：**本次改动没有引入任何新失败**；语法检查与 6 条新单测全绿，浏览器级 75 条通过。

