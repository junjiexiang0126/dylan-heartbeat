# 给 VPS 助手：知微实时语音隔离部署交接（2026-10-20）

## 任务和授权
用户明确授权**在新加坡 VPS 新建隔离语音测试服务**。本次禁止重启、修改、替换、迁移或删除正式 `ziwei-web`、正式 Caddy 路由、Hermes 主实例及其数据库、权威记忆和持久卷；禁止自动合并 `main`、修改生产 DNS/证书或直接上线正式域名。不得打印、上传或在聊天中粘贴任何密钥。

仓库：`junjiexiang0126/dylan-heartbeat`
分支：`feat/realtime-voice-integration-20261020`
先核对 HEAD；交接文档和只读脚本以 GitHub 当前内容为准。
生产：`https://zhiweilove.me/`，`ziwei-web` 容器，正式入口不变。

## 阶段 A：只读盘点（现在就做）
1. 在 VPS 运行 `bash ziwei_web/realtime_voice/scripts/vps_voice_preflight.sh`（先在本地 checkout 开发分支）；该脚本只读，不读取 env 值。
2. 核对 Docker 容器/网络、Caddy、端口、磁盘/内存、DNS 与 TLS/WSS/UDP 可达性；检查是否已有 LiveKit 运行。只汇报非敏感信息。
3. 核对 `ZIWEI_REALTIME_VOICE_ENABLED`、`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`、`ZHIPU_API_KEY`、`MINIMAX_API_KEY`、`MINIMAX_VOICE_ID` 是否已准备，**仅输出 present/missing**。MiniMax 声音 ID 由用户持有；不得在对话中索取真实 API 密钥。
4. 检查隔离测试实例是否能在**不挂载生产 Web 数据目录为可写**、不复用生产进程锁的条件下调用既有 Hermes 原生接口。若不能安全共享会话，停止并汇报阻塞，**不可复制生产密钥/会话文件到测试目录后直接试运行**。
5. 检查 `ziwei_web/Dockerfile` 使用 `npm ci --omit=dev --ignore-scripts`，而 LiveKit 的 `@livekit/rtc-node` 含 native SDK；必须在隔离构建中验证 `require('@livekit/rtc-node')` 和真实 WebRTC loopback。不能只凭镜像构建成功就认为能收发音频。
6. 确认真实 Web 入口调用 `RealtimeVoiceService`，不要误用旧的 `token_route.js` 单纯签发 token 逻辑；验证 POST 路由的登录、CSRF、owner 隔离及浏览器连接参数。
7. 当前 README 部分描述（15 分钟限额、page hide 挂断）可能是旧文字。以当前 `service.js`、`providers.js`、`public/livekit-call-transport.js` 及测试为准，先核对代码与文档不一致项，避免误判。

## 阶段 B：搭建隔离环境
- 仅新建单独的 LiveKit 容器和独立的 voice Web staging 容器、网络、持久目录及秘密配置。明确使用不同的容器名、主机端口和测试 URL。
- LiveKit 需 WSS 信令及可达的 UDP WebRTC 媒体路径（必要时 TCP fallback）。不要只开 HTTPS 就认定通话可用。
- staging 使用独立 HTTPS 入口与身份认证；**不在正式 `zhiweilove.me` 路由上插入或覆盖规则**。若必须更改正式 Caddy 配置或防火墙全局规则，先停下来请求新的授权。
- 仅在 staging 环境开启 `ZIWEI_REALTIME_VOICE_ENABLED=true`，正式环境保持关闭。
- 先完成无付费 API 的 LiveKit loopback，再测真实智谱 ASR、MiniMax TTS、Hermes 连接，最后进行 iPhone 真机通话。
- 有阻塞先报告，不得用临时暴露公网无认证接口、复制生产数据库、关闭 CSRF、明文记录密钥等方式绕过。

## 阶段 C：真实验收
1. 用户在 iPhone Safari 打开 staging 并授权麦克风；发出一句中文，确认智谱转录准确、Hermes 实际生成答复、MiniMax 用指定克隆 voice ID 合成、手机听到声音。
2. 测中文/英文各一句；插话打断、静音/恢复、挂断、网络断开重连；确认后台/锁屏在 iOS 上的真实限制。
3. 记录各环节耗时、真实供应商请求次数/用量、失败原因（脱敏），不把估算费用写成实际账单。
4. 若通过，保留 staging 等用户验收；**未经另行批准不合并、不上线正式服务**。

## 最终汇报格式
- 代码 HEAD、staging URL（无令牌）、新建的容器/端口（不含秘密）
- 真实通话：通过/失败/未测（附各环节证据）
- Hermes 记忆和生产服务：未变更的核查证据
- 阻塞项及用户需要提供的非敏感信息
- 回滚办法（只影响新增 staging 资源）

## 注意
旧网页 E2E 三项失败暂缓；不要以修旧测试为由修改已验收前端。目标是尽快打通真实语音通话。

## 验收记录（2026-10-21 补充）

- **iPhone 真机验收已通过**：用户于 2026-10-21 通过 iPhone 真机完成语音通话验收，确认实时语音通话链路可用（LiveKit → 智谱 ASR → Hermes → MiniMax TTS）。
- **当前状态**：语音功能当前没有问题；长期稳定性（打断/静音/恢复、长时间通话、网络波动重连等）仍需在后续日常使用中慢慢测定，暂未作为验收阻断项。
- **VPS 部署快照（2026-10-21）**：
  - `voice-livekit` 容器运行中，本地 7880 健康检查 200；7881（TCP）与 7882-7892（UDP）对公网开放供 WebRTC 真机连接。
  - `ziwei-web` 容器（镜像 `136c56c7`）内 7 个语音环境变量均已注入（含 LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / ZHIPU_API_KEY / MINIMAX_API_KEY / MINIMAX_VOICE_ID）。
  - Caddy 在 `zhiweilove.me` 站点块内配置 LiveKit 反代（127.0.0.1:7880），与交接文档原计划的独立 staging 子域方案不同，采用正式域名路由方式。
- **本次会话变更（2026-10-21）**：
  - 删除遗留唤醒代码 `wake_up.js` 及全部运行时引用（package.json、railway_start.js、server.js、集成测试），提交 `a9c1b3b`，已推送到功能分支（截至本记录写入时尚未合并 main，合并时点由用户决定）。
  - 清理部署遗留：删除两个被替换的旧容器（ziwei-web-old-pre / ziwei-web-old-fs）、构建缓存（884.5MB）及 10 个老标签镜像；保留在跑镜像与回滚点 rollback-20261021-0230、rollback-20261020-1353。
  - 生产服务（ziwei-web、ziwei-hermes、Caddy、生产数据）全程未做变更。
