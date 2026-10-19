# 交接：Work 页布局异常（2026-10-19，给 Work）

## 一句话现状
Work 页（三人工作室）在手机上：吸顶标题被顶进顶部安全区、看起来像死图；输入区被挤出视口。
其他五页（聊天 / 朋友圈 / 首页 / 记忆 / 日志）用户表示满意。
**线上已回滚到 9567d5787693**，Work 仍异常，等待复核。

## 环境
- 用户实际访问：https://ziwei-home-web-test-ziwei-hermes-test.up.railway.app （旧家 Railway）
- 新家 zhiweilove.me **未更新**，用户明确本轮不要动
- 仓库 junjiexiang0126/dylan-heartbeat，主线 main
- 部署脚本 workspace/scripts/deploy_web.py <sha>

## 今日相关提交（时间顺序，均为 Web 前端）
| 提交 | 内容 | 是否可能影响 Work |
|---|---|---|
| 27ffad3 | 单一根壁纸层：body::before 纸纹停用、.ambient 停用、#chatWallpaper 隐藏、#app/.shell z-index:2 | 可能（层叠） |
| 97bdebb | html/body、.space-wallpaper 透明；无壁纸时才用 var(--bg) | 可能 |
| 64a71b1 | nav 改半透明玻璃；文字阴影（后已撤） | 否 |
| 87e61c0 | 去 background-attachment:fixed；100dvh；overscroll-behavior:none；.topbar padding-top 20px | 可能 |
| f4722f5 | 关缩放；输入控件 16px | 否 |
| fafa6d4 | 事件拦截禁缩放 | 否 |
| a968f89 | 底光全站 + 减淡 40%；#logs/#memory 透明 | 否 |
| f8aadff | .space-wallpaper inset 扩到四边安全区 | 可能 |
| 3f90cbe | viewport interactive-widget；black-translucent；standalone 100vh；safe-area max() | 可能 |
| 9567d57 | html,body 由 height:100% 改回 min-height:100%（当前线上） | 可能 |
| e35a8f3 | .work-panel 改 height:auto + min-height:0 | 已回滚 |
| ca4d88f | work.js 去掉 inline height 写入 | 已回滚 |
| 196f3fd | 撤回 height:auto，保留 work.js 改动 | 已回滚 |

## 已查到的确凿事实
1. `work.js` 的 `layout()` 里原本有：
   `root.style.height = Math.max(0, Math.min(nav.top, visualViewport.offsetTop + visualViewport.height) - gap - root.getBoundingClientRect().top) + 'px'`
   即：Work 面板高度由脚本算，并写成 inline style。
2. `work.css` 也有一条固定高度：`.work-panel{height:calc(100dvh - nav变量 - safe-area...)}`。
   两者叠着用，脚本的值优先级更高。
3. `chat.css` 最后一条把 `.chat-panel` 设为 `height:auto;min-height:0`，聊天页因此不依赖脚本算高度。
4. 静态 Chromium（440×900，无登录、无数据）里，`.work-heading` 位于 top 83px、面板高 708px，**布局正常**，无法复现。
5. CLI 实测 work.css 响应 `cache-control: no-store`，排除 CDN/浏览器缓存导致“改了没变”。
6. 线上 `/work.js` `/work.css` `/workbench.js` 均 200。

## 失败过的两次尝试（供 Work 避坑）
- 只改 CSS（.work-panel height:auto）→ 内容堆叠、输入框上浮。
- 只去掉 work.js 的 inline height、保留 CSS calc → 仍未解决（用户反馈“还是一样”），也可能与 9567d57 的 min-height 改动叠加。
- 两者同时存在（e35a8f3）→ 输入框上浮。

## 给 Work 的建议排查路径
1. 在 iPhone 真机 Safari 远程调试（或让用户装一个可用调试的包）捕获：
   - `#work` 的 `getBoundingClientRect()`、inline `style.height`
   - `visualViewport.height / offsetTop`
   - `nav.getBoundingClientRect().top`
   - 是否 `work.js` 的 layout() 在 `#work` 隐藏时执行、算出 0 或负值后没重算
2. 重点怀疑：`layout()` 在 `root.hidden` 为真时 return，但切到 Work 页那一刻的顺序（先显示面板再 layout，还是 layout 先跑）可能导致算到旧值；用户在 iPhone 上看到的是“算完之后没有重算”。
3. 若能拿到真机数据，优先判断是「inline height 太小」还是「.work-panel 的 calc 太小」，二者取一，别同时改。
4. 若要统一机制，建议：让 Work 与聊天一致（CSS 负责高度，脚本不写 inline style），但要同时确认三栏内部滚动容器（`#workMessages` 等）各自的 `min-height:0`。

## 边界
- 不改二级页面、贴纸、业务交互、长期记忆与数据。
- 新家 zhiweilove.me 本轮不动。
- 部署由用户安排；回滚 dot：9567d5787693（当前线上），被换下的是 196f3fd38bd0。
