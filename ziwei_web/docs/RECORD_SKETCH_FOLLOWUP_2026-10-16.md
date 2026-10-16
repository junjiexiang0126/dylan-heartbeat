# 四张草图与通透度修正

页面基线：48a2f7e1783e923857e93cd1b28cfecb649eb537；当前集成头：integration/ziwei-20261016 @ 69b3efc30d56574cd93466630b24e3ea8825df62，包含知微已合入的紧凑语音气泡、sage/sky 背景色与保存后立即 appearance()。这里只改 ziwei_web 的前端呈现和相应测试。

## 本次依据

用户补齐工作日志、私人日志、个人日志、记忆四张草图；用户报告原生侧滑正常，并报告玻璃通透度调最高仍无法透出背景。侧滑记为用户真机回执，本轮没有自行验证 iPhone 手势。

## 修改后行为

- 页头采用返回、标题与数量/更新时间、搜索的横向结构。日期显示采用曼谷时间，缩短到月日时分；刷新入口移到内容区。二级日志页仍隐藏全局页头和底部导航，沿用原有浏览器历史。
- 工作日志按记录日期分组，每条分别展示原生标题、单行省略摘要、时间与虚线分隔；点击进入完整原文。
- 个人日志列表恢复圆角日记卡；整张卡或其按钮进入独立全文页，支持浏览器前进/后退，全文页保留“和知微聊这篇”和来源说明。原生天气、心情和标题照常显示，不补造草图示例中的标签。
- 私人日志显示居中标题、解释和提示，仍不请求私人内容或数量；照片墙仍未接入。原有迟到响应隔离保留。
- 记忆首页采用一主两副，主卡显示全部数量、真实原话摘录、未分类入口；副入口为关于你、工作记忆；低数量分类留在页脚。摘录点击后展开原文和出处。搜索入口和分类筛选只发既有只读 GET 请求，没有写入、移动或重分类。
- 颜色、圆角、间距、字号继续用 tokens；布局示例中的数字和文字不写成真实数据。

## 玻璃原因与修正

1. 旧设置将滑块值直接当不透明度，数值越大越不透明；现改为 `(100 - value) / 100`，向右更透明。已有设备数值保留，新的方向明确显示在设置标签中。
2. glass 的伪元素曾使用固定透明度，与设置脱节；现统一使用 --glass-opacity。去掉日志入口重复叠加的材料底层；纸面填充也跟随该变量。
3. 阅读页 shell 曾使用不透明纸色遮住整张壁纸；现选择空间壁纸时让该层透明，纸卡仍保留自己的材质。
4. “降低透明度”和系统减少透明效果保留实底，不用提高滑块绕过这些偏好。

相关语义变量：--record-card-fill、--record-tool-fill、--record-heading-gap、--record-timeline-rule、--record-private-width/space/leading、--memory-main-padding、--memory-excerpt-lines，以及既有 --records-card-* / --record-reading-*。

## 验证

- `npm --prefix ziwei_web run check`：通过。
- `npm --prefix ziwei_web test`：69 passed / 0 failed。
- 更新基线前的一次完整 Chromium 浏览器回归：99 passed (1.7m) / 0 failed，没有分批累计。使用隔离 Hermes 测试服务，非真实日记/记忆。
- 标准命令：`npm --prefix ziwei_web run test:e2e -- --project=chromium`。本环境使用等价的外置 Playwright 配置，仅覆盖本机 Chromium 路径、字体与测试输出位置；沿用仓库 e2e_server 和隔离口令/数据目录。环境可复现命令：`FONTCONFIG_FILE=/workspace/scratch/59709d929a4c/qa-fonts/fonts.conf ziwei_web/node_modules/.bin/playwright test --config=/workspace/scratch/59709d929a4c/playwright-verification.cjs`。外置配置与字体未写入项目依赖。
- 更新到 48a2f7e 后重新通过语法检查；增量浏览器回归（chat-refinement.spec.js 与 record-sketches.spec.js）：9 passed (11.8s) / 0 failed。新增的背景预设测试逐一通过 light/dark × sage/sky 的真实保存、立即生效、刷新保留及通透度保留断言；没有重复完整测试。
- record-sketches.spec.js 共四项，覆盖通透度方向、明暗主题、实际截图差异、壁纸与偏好刷新保留、阅读页不遮挡壁纸、降低透明度实底、日记独立原文页与历史、真实记忆摘录/出处/分类筛选，以及原文不执行 HTML。
- 更新原有日记测试以验收独立全文页、圆角变量；记忆页退出测试通过返回首页进入设置，仍验证锁定清除内容与计数。
- 浏览器截图含中文字体与隔离示例文字，仅作桌面 Chromium 的移动视口证据，不冒充 iPhone/Safari/PWA 真机截图。

## 范围与状态

本提交没有修改 native、接口适配器、服务器、记忆文件、SOUL、Cron、环境变量或卷；保留基线语音气泡修改。页面补丁 PR #30 已由知微合并为 69b3efc；此后只补背景回归测试与验证记录。线上部署和文件指纹本轮未核验。iPhone 深浅主题实际显示仍需用户验收，原生侧滑已有用户报告通过。

## 基线同步核对

style.css 与 app.js 直接沿用 48a2f7e 原字节，blob 分别为 55c1b011b16eef75e419e1f2c4e6b0e4127485f7 / a3344a47ebd6cea26988cbed787570979101a958；本补丁不改这两个文件。集成头 69b3efc 的父提交为 48a2f7e 与页面补丁 084326b。已逐项比对：所有 public 文件与增量验证使用的版本一致；追加交付只改变本记录和背景回归测试。
