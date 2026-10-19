# 交接：日志/记忆页贴纸位置异常（给 Work，2026-10-19）

## 一句话需求
日志页与记忆页的卡片右上角要有一枚实色贴纸，露出一部分在卡片外，没有边框和阴影，贴在卡片之上；今日印记页保持原样。

## 环境
- 用户实际使用的页面：https://ziwei-home-web-test-ziwei-hermes-test.up.railway.app （Railway 服务 ziwei-home-web-test，serviceId 0e699897-01a7-4910-8009-589fe5bc6ce7）
- 仓库：junjiexiang0126/dylan-heartbeat，主线 main = e4e20953de1b
- 新家 zhiweilove.me（新加坡容器）尚未更新，本次不涉及

## 相关提交（按时间）
| 提交 | 内容 |
|---|---|
| dd8c5e78bbee | 新增 flow-glow.css：流光底 + 玻璃卡 |
| 4591ac9e618e | server.js 静态白名单补 flow-glow.css（否则 404） |
| 38578def225c | 亮底上玻璃不可见：底色 .58→.40、加外圈与顶部高光 |
| 5c8d03f067db | 玻璃补到真机实际使用的 .record-card |
| 1d22bedc4498 | 玻璃统一成一套参数（此前三套并存） |
| 81d37ceed810 | 贴纸统一改到右上角，删掉按种类的旧贴纸 |
| 1ffafac25f69 | 贴纸/文字 z-index 对齐规范 1/2 |
| 587007f | 今日印记贴纸恢复原样，不被接管 |
| 10e1d3e | 补 position:absolute（此前伪元素缺定位，变成 flex 第一个子项 → 贴在左上角） |
| 7b638ed | 贴纸改为卡片内真实元素 .card-sticker，实色、无边框无阴影 |

## 改动文件
- ziwei_web/public/flow-glow.css（新文件，已进白名单）
- ziwei_web/public/records.js（末尾追加装饰逻辑：给 #logs .log-entry 与 #memory .memory-entry 追加 <img class="card-sticker">，MutationObserver 跟随动态渲染）
- ziwei_web/public/index.html（挂载样式表一行）
- ziwei_web/server.js（files 白名单一行）

## 现象
1. 记忆页：贴纸出现在卡片左上角（用户 iPhone 真机，2026-10-19 多次反馈，最后一次反馈已在部署 e4e2095 之后发出，但用户尚未确认是否重开过页面）。
2. 日志页：曾出现贴纸与预览不一致、今日印记贴纸消失（后者已由 587007f 处理，未再反馈）。
3. 无头浏览器（Chromium，440×900，deviceScaleFactor 2）本地复现：**左上角问题不复现**。10e1d3e 之后测量 ::before 的 computed 位置为 top:-8px / right:-8px / left:398px（卡片宽 412px），即右上角正确。

## 已排查
- sw.js 不缓存任何页面或 API（仅 skipWaiting/claim），排除 Service Worker 缓存。
- 静态白名单已补，/flow-glow.css 线上返回 200。
- 线上 flow-glow.css 与 records.js 均已确认含 card-sticker 规则（部署后探测 8 次命中）。

## 尚未排除
1. iPhone Safari 对 `body:has(#logs:not([hidden]))` 的支持差异，导致流光层与装饰层表现不同。
2. `.memory-entry` 为 flex 容器，若某个未预期的 CSS 覆盖了 `.card-sticker` 的 position，会退回文档流（表现为贴在左上角）。
3. 用户端的 HTTP 缓存（页面强刷/重开图标未做）导致看到的仍是旧版。
4. Railway 构建缓存导致实际镜像与 e4e2095 不一致（部署记录显示 SUCCESS，commitHash 与 e4e2095 一致，但未核容器内文件）。

## 建议 Work 的下一步
1. 在 iPhone 真机 Safari 上打开页面的「记忆」页，用 Safari 远程调试看 `.card-sticker` 的 computed style（position/top/right）与它的 offsetParent。
2. 若 offsetParent 不是 `.memory-entry`，检查是否有祖先元素带 transform/filter/contain 形成新的包含块。
3. 核对容器内 flow-glow.css 与 records.js 的实际内容（sha256 与 github main 对比）。
4. 若真机仍不复现修复，回退方案：把贴纸从伪元素彻底解耦，用卡片内的绝对定位 span + 固定 z-index 层级，并在真机核对。

## 用户偏好（重要）
- 不要伪元素式装饰；贴纸应是卡片的一部分，卡片消失贴纸也随之消失。
- 贴纸实色、无边框、无阴影、不抢文字。
- 今日印记页的表情贴纸（exp6 六张 + 爪印）保持原样，不许改动。
- 改界面要先出本地渲染图给她确认，再部署。
