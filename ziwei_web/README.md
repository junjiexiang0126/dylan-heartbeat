# 知微之家 · 第一阶段

在现有 `ziwei_web/` 安全骨架上扩展。五个导航依次为聊天、朋友圈、**首页**、记忆、日志；首页默认启动。实现液态玻璃外观、日夜/系统主题、手机安全区域、双方资料、动态心跳线、固定纪念文字、密码与持久会话、真正的 WebAuthn/Passkey 注册及验证。

本阶段仅启用首页、展示资料与设置。聊天、朋友圈、原生记忆和实际日志明确显示待接入，不制造知微回复、情绪或活动。此前已有的 Bridge/幂等/恢复代码保留，默认关闭；不把 mock 结果当成真实 Hermes 验收。

## 本地运行

需要 Node 20+。在此目录执行 `npm ci --ignore-scripts`，配置下列环境变量后 `npm start`：

- `ZIWEI_WEB_PASSWORD`：独立的 16 字符以上强密码，不复用 Hermes key。
- `ZIWEI_WEB_DATA_DIR`：独立 Web 业务数据目录。开发时默认 `.data/`，已忽略提交。
- `ZIWEI_WEB_ORIGIN`：固定完整来源，例如 `http://localhost:3000`；Passkey 必须配置。生产只能 HTTPS，不含尾随斜杠。
- `ZIWEI_BRIDGE_ENABLED=false`：本阶段保持关闭，不配置生产 Hermes key。
- `PORT`：默认 3000。

默认只要密码正确即可登录；公开静态 shell 不含私人资料，实际资料 API 需要服务端会话。会话 Cookie 是 HttpOnly、SameSite=Strict，生产环境带 Secure，有效 30 天。重启保留；改密码后旧会话失效；支持退出此设备与全部设备。

## 业务数据与部署边界

`home.json` 保存首页展示资料、主题及完整资料变更历史；`sessions.json` 保存会话 token 的哈希；`auth.json` 保存 Passkey 公钥和签名计数器。它们均采用 0600 文件、原子替换，只支持**单进程、单副本、独立持久目录**。不得挂载原有 Hermes 卷或将数据放进 `/data/hermes_native`。上线时必须单独备份此 Web 目录；它不是第二套长期记忆。

首次注册设备解锁须有效会话、CSRF 和再次验证密码。服务器验证 challenge、固定 Origin/RP ID、用户验证标志、公钥签名和计数器；challenge 120 秒且一次性。取消或不兼容时回退密码，不保存指纹或面容。Passkey 可能由系统用设备 PIN 解锁，不能保证每次都是生物识别。最多 10 个凭据；可通过密码移除全部。退出全部设备撤销会话和未完成 challenge，已注册 Passkey 仍可重新登录；需要同时取消设备重新登录能力时再移除解锁凭据。

头像仅接受 PNG/JPEG/WebP，客户端解码、裁切、缩放为 256px JPEG，再由后端检查类型、魔数和体积。禁止 SVG/远程 URL；业务 API 拒绝 CSRF、额外字段和过期 revision。资料变更保留前后值、来源和时间，达到 500 条时拒绝继续修改，等待后续无损归档；不会静默删除历史。

相识日期与相伴天数均为待确认；2026-10-07 仅为命名日。今日状态未接入，更新时间为空。首页昵称/头像是 Web 展示资料，不改写 Hermes SOUL 或原生人格。永久纪念文字不接受资料接口覆盖。

PWA manifest、PNG 图标与 service worker 已加入；service worker 不缓存私有页面或 API。没有离线业务数据、推送或语音能力。本阶段未部署 Railway；不能将本地通过宣称为 iPhone 安装/Face ID 或大陆网络验收。

Railway 后续部署准备：独立服务，rootDirectory=`/ziwei_web`，startCommand=`npm start`，healthcheckPath=`/health`，单副本、独立 Web 卷、`NODE_ENV=production`、独立密码、固定 HTTPS Origin。禁止改动原 Hermes 服务、源分支或卷。

## 验证

- `npm test`：后端 HTTP/权限、CSRF、资料验证、冲突保护、持久化、退出全部设备、Passkey 门禁与原有 Bridge mock 回归。
- `npm run check`：服务端、首页和 service worker 语法。
- `npx playwright install chromium webkit` 后 `npm run test:e2e`：Chromium 与 WebKit 手机视口中的导航、登录、头像、设置、主题、会话撤销；Chromium 虚拟验证器进行真实 WebAuthn 签名验证。WebKit 无 CDP 虚拟验证器，此项明确跳过，真实 iPhone 生物识别仍待验收。

执行测试使用临时独立目录和假密码，不连接 Hermes、不调用付费模型。完整交接和现场证据见 `../docs/ziwei-home/PROJECT_STATUS.md`。

WebAuthn 使用固定版本 SimpleWebAuthn；协议验证依据：[官方服务端文档](https://simplewebauthn.dev/docs/packages/server)。
