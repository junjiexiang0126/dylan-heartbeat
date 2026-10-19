# 交接：日志/记忆页统一材质与贴纸（第二版，给 Work，2026-10-19）

用户 2026-10-19 明确：**停止修改，不接受、不合并、不部署**，只做只读核查，然后把结果与代码交给 Work。
分支 `feat/unified-glass-stickers`、提交 `4292b28` 原样保留，不得删除、覆盖、合并或部署。

## 一、用户指出的两个问题与只读核查结论

### 问题 1：预览图里贴纸全是加载失败图标
**结论：预览方式错误，不是代码里的路径错误。**

- 预览页 `workspace/tmp/preview/index.html` 用 `file://` 协议打开；
- 贴纸引用的是站点根路径 `src="/stickers/sticker-sakura.svg"`；
- 在 `file://` 下，根路径被解析成 `file:///stickers/sticker-sakura.svg`（文件系统根），该文件不存在 → 破图；
- 素材本体存在且完好：`ziwei_web/public/stickers/sticker-sakura.svg` 1270B、`sticker-rose.svg` 960B、`sticker-bow.svg` 850B；
- 线上 `/stickers/sticker-sakura.svg` 现返回 404，属正常——该分支未部署，白名单尚未上线（`git show 4292b28:ziwei_web/server.js` 已含三条映射）。

**如果要在本地正确预览**：需要跑一个本地静态服务器把 `ziwei_web/public` 挂到根路径（`python3 -m http.server` 在 public 目录下起服务，然后用 `http://127.0.0.1:PORT/` 访问），不能用 `file://`。

### 问题 2：卡片变成彩色渐变，不是奶白毛玻璃
**结论：同样是预览环境不完整，不是样式值本身。**

- 预览页只加载了 `tokens.css`、`records.css`、`records-material.css`、`flow-glow.css` 四个样式；
- 真实页面还加载了 `style.css`、`refinement.css`、`chat.css` 等，纸感底、纹理、面板背景都在后者；
- 缺了纸底之后，卡片下方没有可透的奶白纸面，`records-material` 的 `linear-gradient(165deg, var(--card-fill-top), var(--card-fill-bottom))` 直接显形，看起来就是彩色渐变。

## 二、这一版代码实际改了什么（未部署）

文件：
- `ziwei_web/public/flow-glow.css`（重写，共用变量 + 玻璃 + 贴纸组件）
- `ziwei_web/public/records.js`（给卡片追加 `<img class="card-sticker">`，MutationObserver 跟随）
- `ziwei_web/server.js`（静态白名单新增三条 SVG）
- 新增 `ziwei_web/public/stickers/sticker-{sakura,rose,bow}.svg`

关键设计：
- 共用变量：`--zw-glass-bg` `.46`、`--zw-glass-blur` `blur(18px) saturate(150%)`、`--zw-glass-border`、`--zw-glass-radius` `20px`、`--zw-glass-shadow`、`--zw-card-pad-*` `16px`、`--zw-sticker-size` `52px`、`--zw-sticker-offset` `-10px`、`--zw-sticker-z` `2`；两页只引用这些变量。
- 贴纸定位：卡片 `position:relative; isolation:isolate; overflow:visible`；贴纸 `position:absolute; inset-block-start/inline-end: var(--zw-sticker-offset)`，不用 right/left。
- **修过的真 bug**：`#memory .memory-entry>*` 这条内容层规则（id+class+子代，特异性高于 `.card-sticker`）会把贴纸的 `position:absolute` 覆盖成 `relative`，贴纸因此掉回文档流贴在左上角。已改为 `>*:not(.card-sticker)`。
- 今日印记：`.imp-card`、`.imp-sticker`、`[data-log-kind="impressions"]` 全部不接管，并显式隐藏该卡上的 `.card-sticker`。

## 三、自动化测试（唯一可信的量化证据）
Chromium 四档宽度 320 / 390 / 430 / 440，测量贴纸外接矩形相对卡片的位置：
四档一致为「右上探出 12.4px、上探 12.4px」（含 -8deg 旋转的包围盒，`object-fit:contain` 后 58×58）。
脚本：`/tmp/test_sticker.js`（临时文件，未入库）。

注意：该测试同样跑在 `file://` 预览页上，贴纸图片加载失败不影响几何测量，但**不能证明素材能正常显示**。

## 四、交给 Work 的判断点

1. 是否需要保留「SVG 贴纸 + .card-sticker 真实元素」这一结构，还是改用现有 PNG 素材（`petals.png` 等，饱和 0.48、平均 alpha 239，本身不算淡）。
2. `records.js` 里 MutationObserver 全文档监听是否有性能或重复注入风险（当前用 `:scope > .card-sticker` 去重）。
3. 生产环境贴纸路径 `/stickers/sticker-*.svg` 是否能被 `server.js` 白名单正确服务（需部署后实测 200）。
4. 预览流程缺陷：本地必须用 http 服务 + 加载全部真实样式表，否则结论不可信——这条应写进仓库的验收说明。

## 五、边界
- 只涉及 Railway 测试前端；不动 Hermes 核心、记忆数据、日记、数据库、其他页面。
- 不部署，等用户在 iPhone 真机统一验收。
