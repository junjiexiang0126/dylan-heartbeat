# 知微 PWA Phase 1 接口合同（待实测冻结）

## 已实现
- GET /health：无认证，返回 Web 服务健康状态，不包含 Hermes 信息。
- GET /api/session：当前浏览器登录状态与 CSRF token；`chatReady=false`。
- POST /api/login：同源校验、密码、单用户会话 Cookie（HttpOnly、SameSite=Strict；生产环境 Secure）、失败限速。
- POST /api/logout：Cookie + 同源 + X-Ziwei-CSRF；撤销会话。
- 其他 /api/*：未登录 401；已登录 503 `hermes_bridge_not_enabled`，不向 Hermes 转发。

## 不可越过的安全门
- Hermes API_SERVER_KEY 只能存在于 BFF 服务端密钥环境，不得出现在静态文件、响应或日志。
- 不做通配反向代理。最终白名单只能包含验收后的聊天、会话历史及受控记忆只读接口；工具、管理、终端、任务执行等路由一律拒绝。
- 保持网页独立 session key，企业微信会话不复用；唯一长期记忆仍在 Hermes。
- 未取得真实 SSE 帧样本、断线终态及历史分页实测前，不能启用真实聊天。
- 网页消息的提交、执行、完成须有服务端幂等键与终态；不能仅靠浏览器重试。
- 附件、音视频和记忆写入不在本阶段授权范围。

## 当前局限
- session 文件采用原子 rename 持久化；只支持单进程、单实例。正式部署需要独立持久化目录和单实例限制；不能把 session 文件放入现有 Hermes 卷。
- 登录失败计数目前在内存，重启会重置；没有分布式限速或边缘 WAF。
- 仅凭单密码不应允许高风险管理操作。
- 暂未部署、未跑测试、未进行真实 Hermes SSE 验收。请在隔离环境执行 `npm test`。

## 隔离 Bridge v0（2026-10-10）
- `ZIWEI_BRIDGE_ENABLED` 默认关闭；需要显式设为 `true`，并配置 `ZIWEI_HERMES_URL`、`ZIWEI_HERMES_API_KEY`、`ZIWEI_HERMES_WEB_SESSION_ID`。默认仅接受 HTTPS upstream。
- 白名单：`GET /api/web/history?limit=1..100&offset=0..` 固定转到 `/api/sessions/<固定会话ID>/messages?order=latest`；`POST /api/web/stream` 固定转到 `/api/sessions/<固定会话ID>/chat/stream`，只接受 `{"message":"..."}`。
- 浏览器不能指定上游 URL、session id、API key、工具调用或额外请求字段。固定 `X-Hermes-Session-Key: agent:main:web:yu`。聊天要求有效 Cookie、同源 Origin 和 CSRF。
- 本轮仅按知微阶段 0 **源码报告**准备 POST chat/stream 请求体，未取得生产原始帧或实际 POST 结构的端到端证据。即使 mock 测试通过，也不能视为真实 Hermes 兼容验收。
- mock 测试运行在本地假 Hermes，不调用 DeepSeek，不读取生产记忆。
- 当前单进程 session 和限速实现仍不适合无持久化卷、多副本生产环境；禁止直接作为生产登录系统上线。

## 上线前稳定性门槛（新增）
- 网页同一时刻只允许一个流式聊天请求；并发请求返回 `409 chat_in_progress`。**这是单进程锁，不是跨实例分布式锁**。
- 流式转发监听 Hermes 的 `assistant.completed` 和 `event: done`；缺失时追加 `bridge.incomplete`（`retrySafe:false`）。不能将中断自动重发，以免重复执行。
- `bridge.incomplete` 仅表示无法确认完整交付，**不是证明 Hermes 没有完成执行**。恢复时应先读取 Hermes 历史核对，仍不能保证 exactly-once。
- 仍缺：持久化消息幂等账本、跨进程锁、连接断开后的终态核对、断线恢复验收、长期会话创建格式的生产兼容确认。
- 在以上项目验收前，`ZIWEI_BRIDGE_ENABLED` 必须保持 `false`，不部署为可用聊天网站。

## 幂等键协议（开发态）
- `POST /api/web/stream` 请求体必须包含 `{"message":"...","requestId":"UUID"}`，同一个逻辑发送只能使用同一个 UUID。
- BFF 在调用 Hermes 前原子落盘 `chat-requests.json`，状态先记 `uncertain`，完整收到 `assistant.completed` + `done` 后标为 `completed`。
- 重复 UUID 永不自动重新调用 Hermes；返回 `409 request_already_seen`；同 UUID 不同消息返回 `409 request_id_conflict`。
- 此机制**仅限单进程、单副本、独立持久化卷**；不是分布式 exactly-once。服务器中断后应查询 Hermes 权威历史，再决定是否由用户发起新请求。
- 账本只保存消息 SHA-256，不保存消息明文；需要安全备份并保证目录权限，30 天后过期。多实例部署前须改为事务性共享存储。

## 断线恢复（开发态）
- `GET /api/web/recover?requestId=<UUID>`：需已登录；不触发新的 Hermes 对话。
- BFF 在发送前读取 Hermes 最新消息 ID 作为 baseline；恢复时从 Hermes 读取最新 100 条，寻找 baseline 之后**唯一**的同文用户消息及其唯一助手回复。
- 返回 `completed`（流已完整结束）、`history_confirmed`（权威历史中可见对应回复）、`uncertain`（证据不足）或 `503 recovery_unavailable`。所有状态 `retrySafe:false`，不自动重新提交消息。
- 仅匹配字符串类型 content；消息被压缩、分页超过 100 条、重复文本、工具复杂消息或其他歧义时保守返回 uncertain。`history_confirmed` 不等于流完整送达客户端。
- **限制**：单进程、单副本；没有跨副本锁，尚未进行真实 Railway 断线/重启验收，不能视为生产就绪。
