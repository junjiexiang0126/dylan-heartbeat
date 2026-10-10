# 知微之家 v1.0 项目状态

更新：2026-10-10，Asia/Bangkok。

## 当前阶段

**第一阶段：开发完成，本地隔离验收通过；公网部署与真实 iPhone 验收待完成。** 本次停止在第一阶段。不得自动开展第二至六阶段；等待用户另行启动。

分支：`feature/ziwei-pwa-phase1-foundation`。沿用现有 [PR #10](https://github.com/junjiexiang0126/dylan-heartbeat/pull/10)，目标 `develop/ziwei-hermes-unified-v1`，不合并/修改生产主线。

恢复起点提交：`f98d69de294335a5de577524df47610eca5deb99`。本轮功能提交哈希在提交后补录；最终文档提交可从 PR 当前 HEAD 核对（文档不嵌入自身尚未生成的哈希）。

## 完成功能

- 底部聊天、朋友圈、中央首页、记忆、日志；默认首页。
- 玻璃风格、日夜/跟随系统主题、背景色调、手机响应式及安全区域、减少动态效果。
- 双人头像/昵称、心跳线、命名日、不可由资料更新覆盖的永久纪念文字。
- 相识日期和相伴天数“待确认”；今日状态明确“待同步”，没有虚构状态或时间。
- 独立密码认证、30天可撤销持久会话、CSRF、限速、当前与全部设备退出；真正的 Passkey 注册/签名验证/移除基础，设备不兼容则使用密码。
- 资料及主题落盘，revision 冲突保护；头像裁切/缩放、类型与体积校验；保存资料变更前后值与来源。
- PWA manifest、PNG 图标、无私有数据缓存的 service worker；未启用离线业务/推送。

昵称和头像是 Web 展示资料，没有修改 Hermes 原生身份/人格。聊天等四页是明确的未接入状态；不生成示例回复、动态、记忆或日志。此前已经存在的 Bridge 开发代码保留，本轮保持关闭。

## 测试和证据

详见 [PHASE1_ACCEPTANCE.md](PHASE1_ACCEPTANCE.md) 与 [首页日间](evidence/home-light.jpg)、[首页夜间](evidence/home-dark.jpg)。

本轮 `npm test` 11通过；语法检查通过；浏览器端到端 Chromium/WebKit 3通过、WebKit虚拟生物识别1明确跳过。虚拟验证器不是实际 iPhone Face ID 验收。GitHub 新提交的 CI 状态将在提交后核对并补录。未复跑没有受修改影响的整套 Hermes 审计；核心原生与 Gateway 文件相对线上 `3ef373a` 无差异。

## Railway 实际状态

本轮只读查询，不以旧聊天或旧文档推断：

- aware-essence / ziwei-hermes-test 环境 `eddf4e4f-1199-45a1-8397-5053c7e9586d`，服务 `d0a928bf-3db2-4085-9812-8a28be4d0b1b`；SUCCESS 部署 `ce3565ad-547f-4136-be9a-e579ef67be46`，Git 来源 `develop/ziwei-hermes-unified-v1@3ef373ad598e5f353026d28b50559001fe0ab5d4`，root `/hermes_native`。
- 原 Hermes 卷 `b57605cd-b47a-4066-bac4-3dd908098250` 挂载 `/data`、1000MB、live；健康 API 返回 Hermes 0.21.6 / ok。现有 Gateway 日志可见运行活动。
- 原 production 服务/旧卷保留。feisty-gentleness 的 probe 仍是探测分支，不是首页版本。
- **本轮没有 Web Railway 部署。** 本地页面 `http://localhost:3190` 仅运行在用户 Mac；没有正式/公网访问地址。
- 未读取密钥值，未向 Hermes 发聊天/工具执行请求，未动卷、重启或调整平台权限。

## 备份、资料缺失与待办

已有两份私有应用备份本轮 CRC/哈希通过；`after-v41` 的历史隔离恢复证据保留，不重复完整审计。不是当前实时快照；原生备份与隔离恢复路径见验收文档。 connector 无容器文件读取工具，线上最新备份和数据字节一致性未重新验证。

原始 v3 与 v3.1 文件原文未在仓库/克隆历史/本机 Codex 文件找到；已恢复定稿规格，用户允许据此继续。请获得 ChatGPT 文件资料中的原文后补充差异核对，不编造条款。

相识日期由最早真实记录核实后再交用户确认。今日状态真实接入、真实 iPhone 安装/解锁、公网部署、大陆网络为待验收，不得宣称已通过。

Web 持久化仅单进程/单副本；生产强制独立持久目录；最多10个Passkey/128活跃会话/500条完整资料历史，达限拒绝而不删除历史。需要后续无损归档、多实例存储与更强边缘限流。现有 Hermes 公网 + local 后端警告与记忆容量风险保留，不在本阶段做生产修复。

## 下一阶段接手

用户启动第二阶段后：先读本文件和验收报告，核对 GitHub PR HEAD、CI 与 Railway 真实部署；获取已确认的 Hermes API/SSE 合同，在隔离会话接真实聊天，继续已有 Bridge/幂等/恢复实现。附件和历史导入先核实来源与备份；不得把历史索引当成长记忆。不得因已有 mock 测试就开启生产 Bridge。

## 不得触碰的边界

官方 Hermes 是唯一 Agent 核心和长记忆权威；SOUL、原生 memories、sessions、workspace、原卷、旧 production 服务及私有备份不可清空/覆盖/删除。禁止在同一卷存 Web 会话资料。不能把 Web 资料历史扩展为第二套长期记忆。不得开启另一个 Guardian/Gateway/自主 worker；不得顺手合并到绑定在线 Hermes 的统一分支、部署/重启原服务或新增敏感权限。高风险/不可逆行为需明确批准；失效审批不反复重试。
