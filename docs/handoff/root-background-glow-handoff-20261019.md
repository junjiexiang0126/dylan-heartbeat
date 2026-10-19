# 知微接手：先合并 PR #64，再按用户指令处理根背景与底光

记录时间：2026-10-19，Asia/Bangkok。仓库：junjiexiang0126/dylan-heartbeat。

## 1. 当前授权与执行顺序

用户最新要求：
1. 先让知微**单独合并 PR #64 到 main**。合并前读取该 PR 最新头和检查结果；如已合并，核对合并 SHA，不重复合并。
2. 本次合并只包含今日印记入口材质和交接文档；**不要合并 PR #63**，不要把根背景/底光改动混进这一步。
3. 完成后报告实际合并 SHA、检查结果和未部署状态；等待用户另行下达根背景修改指令。
4. 根背景修改必须从包含 PR #64 的最新 main 新开分支。后续底光调整也是后续任务，本文的规格和方法不代表现在授权执行。
5. 本轮不部署。部署另按用户安排。

Codex 本轮仅补本文，不执行合并、部署或样式修改。

## 2. 已完成、已验证、未完成

### PR #62：已合并

main 合并提交 c84827b5ecc2985f7af85ea1509de56f394b6d4b。
日志/记忆入口使用高透玻璃和用户提供的四张透明水彩 PNG。原背景未按“唯一根壁纸”重构。

### PR #64：今日印记入口，待知微合并

https://github.com/junjiexiang0126/dylan-heartbeat/pull/64
分支 fix/impressions-entry-glass-20261019。
受测代码版本 354e1d66b49c1dea43d5ce03daea3b975a67e26d；本文会作为其后的纯文档提交加入同一 PR，最新头以远端为准。

用户已明确选择：只改**日志页的“今日印记”入口卡**，不是点进去的时间轴。
运行时代码仅在 ziwei_web/public/flow-glow.css 为
#logs > .log-entry-grid > .log-entry[data-log-kind="impressions"]
接入现有 --zw-glass-* 与 --log-entry-* 材质，移除该入口旧渐变描边。保留原入口爪印与点击行为。
impressions.css、impressions.js、index.html、表情素材、二级时间轴、单条详情未修改。

HTTP 专项运行 39253423251：20/20 通过；Chromium/WebKit、320/390/430/440px，对照入口实际背景、边框、圆角、内边距、阴影和模糊。完整页面 WebKit 截图已核对。
https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39253423251
Work isolated、unified regression、Web polish 在受测提交上成功。完整 Web 流水线状态需交接时重新核对；其 WebKit 是既有 continue-on-error，不能只看到绿标就称全量通过。iPhone 真机尚未验收。
记录：docs/handoff/impressions-entry-glass-20261019.md。

### PR #63：不要合并

https://github.com/junjiexiang0126/dylan-heartbeat/pull/63
该方案扩展 body 流光并补根画布渐变，**不符合用户后续明确的唯一可更换根壁纸要求**。其已通过专项也不代表方案应合并。不要整包 cherry-pick。
该 PR 的贴纸有限重试也尚未合入 main；不要将其误报为线上已有功能。

### 爱心破图：仍有真机待核查项

用户截图中日志私人入口和记忆主卡的爱心曾破图。只读 GET 核查四张 PNG 全部 200、image/png，CRC 和 PNG 校验通过。
爱心 1,599,980 字节，SHA256 6796ba36c5e76b79606a44eef42e6131e891559efc36d51feb83cb14b1aebf34，与仓库一致；不能据截图断言缺文件、图片损坏或已经彻底修复。此次 PR #64 没有解决这项偶发问题。

## 3. 用户确认的根背景规格（待另行指令）

**一张可更换、固定全屏的空间根壁纸 + 一套全站统一底光 + 其上的毛玻璃和内容。**

- “选择空间壁纸”更换的是全站唯一根背景；六个导航页面共用。
- 壁纸等比裁切铺满屏幕，不拉伸、不平铺、不留边；允许 cover 为铺满而裁切边缘。
- 内容滚动，根壁纸不跟随滚动；长页面、回弹、横竖屏、工具栏伸缩也不能露出另一套网页底图。
- 毛玻璃透出当前壁纸；保留已确认的玻璃参数与通透度设置，不把玻璃换成彩色渐变。
- 不重画、更换或额外加工用户提供的图片来掩盖布局问题。
- 清理重复纸纹、页面独立背景与重复环境光。聊天/Work 不再被独立聊天壁纸替换；旧缓存数据保留，不能直接删 IndexedDB。
- 单一壁纸来源可按浏览器兼容需要选择绘制实现，但不能再让几个背景容器各自管理不同图片。不要把仅新增一个 content 区图片层当成根背景完成。
- 不修改二级页面内容、贴纸、业务交互、长期记忆、人格、自主规则和持久化数据。

## 4. 只读排查证据与代码位置

2026-10-19 已从线上测试站 GET 核对：
flow-glow.css、refinement.css、chat-render.js、chat.js、style.css、theme-init.js、index.html
全部与 main c84827b 对应文件相同。该结论限于这些静态文件，不据此推断整个后端部署版本。

现有背景由多种来源按条件叠加/替换，并非每层一直同时出现：
- index.html：#spaceWallpaper、#chatWallpaper 是两个独立图片容器。
- refinement.css：.space-wallpaper 已是 position:fixed; inset:0；图片 100% 宽高、object-fit:cover。因此不能未经浏览器验证就断言代码没写固定全屏。
- chat-render.js：空间壁纸保存在 IndexedDB ziwei-chat-appearance / preferences / space-wallpaper，登录显示后切换 body.has-space-wallpaper。
- chat.js：独立聊天壁纸保存在同库的 wallpaper 键；app.js 对 chat 和 work 均启用 ZiweiChatAppearance。
- refinement.css：body.chat-has-wallpaper .space-wallpaper{display:none}，所以聊天/Work 可覆盖全站壁纸。
- refinement.css：body::before 的 --paper-texture 来自 tokens.css 的 /paper.svg；图中含波纹、爱心与颗粒。已有自定义壁纸 class 时，这层按代码应隐藏。不能直接断言它仍覆盖了已成功启用的用户壁纸。
- style.css / refinement.css：.ambient 是另一套环境光；有空间壁纸时隐藏，聊天视图也隐藏。
- flow-glow.css：body::after 是四组彩色径向流光，只在日志/记忆页开启；**已部署版本没有在自定义空间壁纸启用时关闭或统一这层**，所以换图片后这组固定色光仍继续叠加。
- style.css：html/body 根画布背景为 --bg 纯色；原 .ambient 的顶部还避开 safe-area-inset-top。
- app.js / theme-init.js：theme-color 从纯色 --bg 写入并缓存；不要只改 meta 就声称修好了 Safari。
- 壁纸仅保存在当前设备、浏览器与站点 origin 的 IndexedDB；不同域名或浏览器不共享。跨域没显示不等于仓库缺图片。

顶部白边：根画布与图片分层、纯色浏览器界面等是需区分的因素。尚未在用户 iPhone 上读取实际容器边界/图片状态，**没有证实唯一根因**。
应在用户允许的浏览器环境观察 class、img 是否成功解码、视口与背景矩形、根画布计算样式，分别测普通滚动、回弹和工具栏伸缩。
Safari 原生状态栏/工具栏不等同于网页可绘制的安全区；不能承诺 CSS 能强制其显示完整图片，也不能用 Linux WebKit 代替真机结论。

## 5. 后续底光调整方法（先记录，待用户另行下令）

用户反馈：目前颜色太重、光晕太多，后续要淡化、减少。

当前已部署 flow-glow.css：
- --glow-1 / --glow-2 / --glow-3 / --glow-4：四组 RGB 光色。
- --glow-strength：默认 .62，夜间 .34，sky/sage 各 .60。
- body::after 的四个 radial-gradient：位置、范围、衰减终点决定光源数量和光团形状；峰值 alpha 分别 .95、.92、.90、.88，还会乘整体 opacity 并相互叠加。
- zw-glow-drift：34 秒漂移。勿为改光色而擅自改毛玻璃、图片或动画偏好。

建议在根背景整理完成后：
1. 把全站底光收成唯一组件/绘制层与一套配置变量；保留旧变量映射或明确迁移记录，避免多份主题覆盖。
2. **先降整体强度**，不是给用户壁纸加白色遮罩。应在两张不同壁纸及日夜主题上预览。
3. **再减光源数量**：可预览 1–2 处宽缓、低饱和的柔光，替代四角重叠亮团；这是建议方案，不是用户已确认的具体数量或色值。
4. 参数化强度、色值、光源位置/范围/衰减、动画开关。可采用 --space-glow-opacity、--space-glow-color-1/2、--space-glow-size-1/2 等语义变量，具体命名由实现决定，不要写死在各页面。
5. 可用白天约 .12–.20、夜间约 .06–.12 作为**预览起点**，并非验收值或已批准修改。根背景重构若改变合成方式，不能机械照搬旧 opacity。
6. 不要同时降低整体 opacity 和所有渐变峰值，再把变暗归功于某一个参数；记录每次实际调整并给对照预览。
7. 减少底光不应改玻璃变量 --zw-glass-*、卡片边框/阴影或贴纸像素。最终效果是“看清壁纸，光只做轻微氛围”，具体视觉由用户确认。

## 6. 后续验收与交付

- 根背景阶段：连续替换两张明显不同的壁纸；六页逐一切换、滚动到页尾；刷新保留；检查长页面、横竖屏、回弹、工具栏收放与自定义壁纸优先。
- 底光阶段：相同壁纸/视口下提供调整前后对照；六页强度一致；日夜主题可读；现有透明度滑杆和降低透明度设置有效。
- 区分代码核查、Chromium/WebKit HTTP 预览、iPhone Safari/PWA 真机。合成 API 数据不算业务真实调用。
- 每一轮独立提交/PR，记录改动文件、参数前后值、验证证据、实际合并 SHA。避免用旧功能分支整体覆盖后续主线。
- 部署权限仍按用户安排，代码提交/合并不等同于已部署或真机验收。
