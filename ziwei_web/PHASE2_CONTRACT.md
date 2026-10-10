# 第二阶段实际接口与数据合同

依据 2026-10-10 现场 `/v1/capabilities`、真实 SSE 帧和已有原生源码。官方 Hermes 仍是唯一 Agent 与长期记忆权威。第一阶段 `PHASE1_CONTRACT.md` 仅作为历史记录，旧 `/api/web/*` HTTP 入口已关闭。

## 入站与原生运行

Web 密码/Passkey 会话、固定 Origin、CSRF 校验沿用第一阶段。只开放 `/api/chat/status`、`messages`、`requests`、`send`、`events`、`action` 和私有 `attachments`。浏览器不能指定原生 URL、会话、模型、system/instructions、工具、记忆或审批路径。

`send` 仅接受 UUID `requestId`、最多10000字符 `message`、最多6个已保存附件ID、可选 `replyTo`。引用复制到该条用户消息的引用资料，不作为系统指令。已存在 ID 必须内容、附件、引用目标相同，返回已有状态；不同内容返回409。不同设备必须复用同一个业务事件 UUID 才能去重，不以相同文字判断重复。

原生 URL 由服务端固定；默认只接受 HTTPS 根来源、禁重定向。测试 HTTP 仅 Node test 环境+显式开关+localhost/127.0.0.1。密钥仅服务器环境或私有密钥文件读取。固定原生 session 与 `agent:main:web:<session>` 入口键。

首次发消息前验证原生 durable runs 幂等能力，创建/核对固定空会话，不重建 Agent。调用：

- `POST /v1/runs`，`Idempotency-Key: ziwei-home:<requestId>`，`{input,session_id}`。没有给 Agent 添加表达长度、拆分数量、模型或人格指令。
- `GET /v1/runs/<本请求保存的run_id>/events?last_seq=<原生序号>`；现场合同是 `data` 中的 `event` 与 `seq`，不是第一阶段猜测的命名完成帧。
- `message.delta` 为流式文本；`message.interim` 按 Agent 真实过程消息分别保存；`run.completed.output` 是原样最终回复。忽略 reasoning 内容，不向 UI 展示工具参数/工具正文。审批仅展示等待提示，不提供绕过或代批接口。
- 已完成/失去原生流时从 `GET /v1/runs/<run_id>` 核对最终状态与输出；工具失败/中断不会伪装成成功。

## 保存、重试和顺序

独立 SQLite `chat.sqlite` 开 WAL、FULL 同步与事务。`requests` 永久保留 UUID、内容哈希、精确发送资料、run_id、原生游标和状态；`messages` 保存正文、引用、附件、来源及收藏/回收站；`events` 是持久事件流。数据库与附件0600、目录0700。原生历史仍在原生卷，Web 数据只属于业务保存，不是原生长期记忆。

同一目录限制一个 Web 进程，发送队列按接受顺序串行，最多20条未结束请求。日期与唯一序号共同排序；分页、搜索、收藏及档案检索在服务端执行。浏览器断开只退出订阅，原生运行继续；重启恢复已保存 run_id，持久游标去重过程消息与最终回复。

原生幂等保留现场为86400秒；丢失接收响应而不知道 run_id 时，最多在提交后1小时内以同一 UUID 和**同一原生请求内容**核对接收。超过此安全窗口不再提交；标记 uncertain 并阻塞后续队列，等待维护者调查。已知 run_id 永不转成新运行。端点/会话/密钥改变且已有请求时拒绝启动，要求审查迁移；无请求的首次配置可以启用连接，不清空资料/档案。

发送尚未得到服务端确认时，网页保留原 ID 供核对；完全离线且未送达服务端的草稿只在当前页面内存，关闭/锁定会丢失。没有宣称离线草稿落盘。删除移入回收站并可恢复，引用快照保留；不调用原生 DELETE。

## 附件能力及界限

每个20MB、最多6个、总已存附件1GiB；超过限额拒绝，不删除旧文件。文件名不参与磁盘路径；使用随机 UUID、原子完成后的元信息及 SHA256。检查内容魔数、图片尺寸上限；拒绝活动 HTML/SVG/脚本/可执行扩展。所有访问都需 Web 会话；禁缓存、nosniff、下载沙箱；普通文件强制下载；图片/GIF、MP4/WebM可内联。视频 Range 支持200/206/416。上传后无论是否发送，文件保留并占用配额。

图片/GIF/表情包：单个<=5MiB、同一消息图片合计<=10MiB时传原生 inline image_url；大图仅元信息。<=64KiB UTF-8 txt/md/csv/json传资料文本。其他文档与视频保存供用户查看/下载，并向 Hermes 提供准确元信息；明确说明其不能读取此二进制内容。**尚未接通 PDF/Office/视频内容解析或原生生成文件的私有下载闭环**，不能将“已保存/收到”称作“理解内容”。不启用现场关闭的原生 browser artifact 功能、不新增原生权限。

## 历史

只读校验已有私有备份后，离线事务导入独立 `source=archive`，保留 SHA256、原始路径/session/message编号。查询档案与新对话分开，不能从档案界面自动引用进入 Hermes，不调用原生 import/session rewrite/memory API。所有原生消息行（包括工具及空正文记录）都可查询；未知旧格式按原文件文本保留，不猜测角色。源冲突拒绝覆盖；重跑不产生重复。详情见 `../docs/ziwei-home/PHASE2_HISTORY_IMPORT.md`。

## 运行边界

不能在 `/data` 的任何子目录、HERMES_HOME 或其子目录保存 Web 业务数据，解析符号链接后再判定。生产必须独立卷（建议 `/web-data`）、单副本、HTTPS。开发仅监听127.0.0.1。恢复需停 Web、保存完整 Web 目录与私有配置，SQLite WAL 不能遗漏；原生备份另行使用既有 `hermes backup` 路径，不能拿唯一生产库演练。

当前可用页面是用户 Mac 的 localhost3190；没有新 Railway Web 部署。真实 iPhone、完整离线/弱网时序、跨企业微信统一事件编号和公网发布留待相应阶段/验收；没有实施第三至六阶段。

参考：[官方 API 源码](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server.py)、[Node SQLite 22.13 文档](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html)。现场帧为兼容性依据，不能用 main 文档替代已部署版本验证。
