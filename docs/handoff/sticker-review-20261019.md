# 日志与记忆：完整页面视觉复核（2026-10-19）

## 版本与边界

- 交接基线：`b876b2d82101aecf14b4ed206c80821bc363e848`，材质代码 `4292b28ff2e834ecf31c6171f9770201996e33c8`。
- 原版预览提交：`191a968da39ede5dd6147fb7c83f8f97b7946b8f`。
- 修复代码：`33d59f971997fa9e7d40664b4efca91278e73ff6`；最终测试提交 `0b170e7778985947998033c02c614428db1cca38`（只完善验收脚本，不再改应用样式）。
- 独立复核 PR：[#62](https://github.com/junjiexiang0126/dylan-heartbeat/pull/62)，目标为原功能分支，保持 Draft；不合并主线，不部署 Railway，不修改新家。
- 仅修改前端材质和装饰初始化；没有修改 API、记录数据来源、只读口径、人格、长期记忆、数据库、自主规则和部署文件。

## 正确预览与证据

本地 HTTP 静态服务已启动，但云端浏览器无法访问开发容器 localhost；本地 Playwright 浏览器下载返回非 ZIP。没有用 file:// 或不完整 HTML 代替。

因此使用 GitHub Actions 的本地隔离应用：真实 `server.js` 监听 HTTP 3188，浏览器经本地 HTTPS 3187 代理访问；加载原 `index.html`、全部 14 张 CSS、真实 JS、贴纸和应用交互。只对 records API 返回合成测试记录，后端为已有 fakeHermes fixture；不是线上数据或真实 Hermes 调用验收。

- 原版：[CI 39227133926](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39227133926)，成功，artifact `12174427212`。
- 第一次修复验收：[CI 39227640320](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39227640320)，白昼截图全部生成，但扩展测试未通过：Chromium 夜间断言没有区分原有 active 高亮（.18）和普通卡片（.10）；WebKit 生成多张截图耗尽 30 秒测试时限。只修正测试选取非 active 卡片并给多图测试 120 秒上限，没有放宽材质、定位或图片加载断言。
- 最终修复验收：[CI 39228198032](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39228198032)，**成功，2/2 浏览器项目通过，artifact `12175121944`**。16 张白昼截图 + 4 张夜间截图，两份 audit.json 中全部 14 张样式表已加载、失败资源为空；四档两页贴纸绝对定位且外框上/右约露出 12.37px。
- 浏览器：Chromium 和 Playwright WebKit（iPhone 13 配置）；宽度 320/390/430/440，两页各截图，另含修复后 390px 夜间截图。
- 文件：每个项目目录的 `logs-*.png`、`memory-*.png`、`audit.json`。截图应结合 JSON 验证图片真实解码、定位及样式加载，不只看空盒子的坐标。

## 四项技术核查

| 项目 | 原版确认 | 修复或结论 |
| --- | --- | --- |
| 三张 SVG | XML 有效，无脚本或外部资源引用；真实服务三条路径均 200、MIME image/svg+xml，浏览器 naturalWidth > 0 | 保留清晰饱和的 SVG，不需要为加载故障换回 PNG；旧 PNG 素材保留在仓库，其他用途不受影响 |
| 全文档监听 | document.body 的 childList/subtree 每次变化都会扫描两页；去重避免重复图片，但不能避免聊天流式 DOM 更新时的重复扫描 | 入口是 index.html 中稳定节点，仅内容/hidden 改变；改为 DOM 就绪时装饰一次，移除 MutationObserver。刷新、分类进入/返回不重建入口 |
| 静态资源 | server.js 精确白名单已有三个映射及 SVG MIME | 真正经过应用服务器验证三条 200；未知贴纸路径 404，无须开放整个目录。此分支未部署，线上路径尚未验收 |
| 定位与层叠 | 两引擎下 absolute 均正确，但旧 PNG 伪元素仍显示并压住标题；记忆副卡被更高特异性的透明底覆盖；主卡有两层玻璃，贴纸相对内框定位 | 取消被替代入口的旧 PNG 和第二描边；统一实际生效的玻璃参数；主卡保留外层一张玻璃，贴纸挂在外框。保留逻辑定位、overflow:visible、isolation、-webkit-backdrop-filter |

原版完整页面确实仍有很强的背景色彩，不能把所有差异都归于旧预览漏 CSS。修复将背景流光由 .62 降到 .18（夜间 .12），卡片使用奶白半透明底与真实 backdrop-filter，未改成彩色渐变卡片。

## 可配置位置与保留内容

`public/flow-glow.css` 的 `--zw-glass-*`、`--zw-card-*`、`--zw-sticker-*` 为共享变量。默认玻璃白色 alpha .46、模糊 18px、饱和 150%、圆角 20px；贴纸 52px、偏移 -10px、旋转 -8deg。颜色来自 SVG 本身，没有给贴纸添加边框、投影或降透明度。

`public/impressions.js`、`public/impressions.css`、六张 expression PNG 完全未修改；入口不注入新 SVG。原分支已有的今日印记入口爪印历史覆盖规则也原样保留，本次不借机调整。

保留所有入口、摘录、分类计数、搜索、阅读和返回行为。新增测试也验证实际点开记忆、返回、刷新后贴纸数量不重复和通过设置切换夜间主题。

## 验证层级

- **代码已验证**：静态白名单、MIME、SVG 自包含、固定入口生命周期、全文档监听移除、限定 CSS 选择器；今日印记文件无差异；JS 语法和 diff 空白检查。
- **浏览器预览**：以两次 CI 实际结论和 audit.json 为准，检查完整页面、所有样式加载、图片解码、卡片单层材质、右上溢出、日夜主题和入口/返回。不是线上生产验收。
- **单元测试记录**：本地 `npm run check` 通过；102 项首次 101 通过，`unavailable native records...SSE tail` 在预期 cursor 7 时收到 8；该单项原样重跑通过。没有为此改后端或放宽断言。后续 CI 的全量结果以对应运行记录为准。
- **尚待 iPhone 真机**：Safari 与已添加到主屏幕的 PWA，检查右上贴纸在滚动/返回/横竖屏和自选壁纸下是否裁切、是否挡文字、玻璃模糊与点击是否正常。物理设备未验收；不能将 Chromium 或 Playwright WebKit 的通过视作真机通过。

未经用户确认，不合并、不部署；后续若整合到 main，应仅整合本需求的前端与测试文档，先检查主线并行运维改动，避免用整条分支覆盖主线。

## 补充 CI 结论

最终测试提交 0b170e7 的 [Web polish regression checks 39228197971](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39228197971) 已成功：102/102 单元测试、语法检查及该工作流中的聊天/Work/Raven 浏览器回归通过。[Work isolated checks 39228198241](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/39228198241) 也成功。更广的 Ziwei Web isolated tests 39228198112 在记录此结果时仍运行中，不将其算作通过。
