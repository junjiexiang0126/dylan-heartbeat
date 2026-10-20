# 知微实时语音｜隔离联调执行清单（2026-10-20）

## 授权边界
用户仅授权在新加坡 VPS 新建**隔离的语音测试服务**。不得修改、重启、替换现有 `ziwei-web`、Caddy 正式域名路由、Hermes 数据/记忆、生产容器或持久卷。不得合并 main 或上线正式前端。此文档不代表已经部署。

## 先决条件（VPS 终端只读核查）
- 核实系统/架构、可用 CPU/RAM/磁盘、Docker/Compose、已有监听端口与防火墙、现有容器名称/网络、是否已有 LiveKit 实例。
- 检查 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`、`ZHIPU_API_KEY`、`MINIMAX_API_KEY`、`MINIMAX_VOICE_ID` 的**存在性**，不打印值，不把 .env、密钥、token 或 inspect 快照提交仓库。
- 核实 MiniMax voice ID 对应账号及 API 区域；核实 Hermes 已有 Web session 是否可从测试服务独立读取，**不允许两个实例同时写生产 Web 数据目录**。
- 核实可用于测试的独立 HTTPS/WSS 子域名和 LiveKit WebRTC UDP/TCP 端口；不修改正式域名或端口。

## 隔离部署设计（部署前必须完成）
1. LiveKit 独立容器、独立配置/密钥、独立 Docker 网络及专属域名/端口；避免与正式服务冲突。
2. 语音 Web 测试实例使用独立数据目录、单独会话认证和专用测试入口；生产正式站点保持不变。测试实例访问 Hermes 需要明确的只读/受控会话方案，禁止复制或覆盖权威记忆。
3. `ZIWEI_REALTIME_VOICE_ENABLED=true` 仅在测试实例；正式实例仍关闭。只允许用户本人登录访问测试入口。
4. API 凭据通过服务器秘密管理/环境注入，不进仓库、日志、截图或聊天。
5. 先用无付费 API 的 LiveKit loopback 验证连通，再依次测真实智谱 ASR、Hermes、MiniMax TTS，最后用 iPhone Safari/PWA 测整条链路。
6. 验证静音/取消/插话/断线重连及费用记录；iOS 后台限制需如实报告，不能承诺锁屏永久通话。
7. 回滚仅停止并移除**新增的测试容器及其专属资源**；不得删除或清理任何正式资源。

## 验收门槛
- 双向真实音频：用户语音 → 智谱文本 → Hermes 真实回复 → MiniMax 指定克隆声音 → 手机播放。
- 至少一轮打断、静音恢复、挂断、网络恢复验证。
- 无泄露密钥；无生产服务重启/变更；记录测试实例、提交 SHA、测试证据与已知限制。
- 三项旧网页 E2E 失败暂不处理，不阻塞语音联调。

## 当前状态
仅代码准备阶段；当前 ChatGPT 连接没有 VPS SSH/终端工具，尚未创建或启动任何 VPS 服务。必须通过获授权的 VPS 操作渠道执行，不能将 GitHub CI 成功当成真实服务已上线。
