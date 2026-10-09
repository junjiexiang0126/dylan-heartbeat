# 知微分支审计与统一开发主线

审计时间：2026-10-10，Asia/Bangkok。仓库：junjiexiang0126/dylan-heartbeat。

## 开发与部署基线

统一开发分支：`develop/ziwei-hermes-unified-v1`。起点为实际运行的官方 Hermes 版本 `1e0ffac3151d5473a957cc33e10c6ddc534f5481`，不是旧报告中的 `4784957` 或 `e6d404f`。新整合结果只提交 GitHub、接受 CI 验证，不部署、不重启、不改变 Railway 的源分支。

Railway 只读快照：

- 项目 `aware-essence`，环境与服务均为 `ziwei-hermes-test`。
- 服务 `d0a928bf-3db2-4085-9812-8a28be4d0b1b`；环境 `eddf4e4f-1199-45a1-8397-5053c7e9586d`。
- SUCCESS 部署 `d3755011-e2f6-4232-8dfa-11fdbd5c643e`，创建时间 `2026-10-09T20:51:53.554Z`。
- 来源 `fix/ziwei-security-guardian-audit-20261010@1e0ffac`，构建根目录 `/hermes_native`；原有 Volume 挂载 `/data`；没有待提交平台补丁。
- 项目 `feisty-gentleness` 的 production 服务 `756ff5d4-2047-4979-af0e-9dddff90bfe9` 仍配置 `junjiexiang0126/dylan-heartbeat@main`，`checkSuites=false`。虽然没有最新部署或域名，也不能据此确认写入 main 不触发部署。因此整合 PR 保留，禁止本轮合并 main。
- 两个项目的四个环境均已只读检查。旧 production 服务、挂载及未挂载卷均保留，未修复或启动旧 xhs-mcp。

## 全部分支与提交包含关系

审计读取了全部远程分支、4 个现有 PR，以及完整 Git DAG。下列源分支所有提交都已成为统一分支的祖先；不是仅复制文件或只比较分支名。通过 `git rev-list --count develop/ziwei-hermes-unified-v1..origin/<分支>` 验证均为零。公开仓库中没有待导入的人格原文或运行记忆，本次没有读取、覆盖或改写持久卷中的私密资料。

| 源分支 | 审计时 HEAD | 整合方式与处理 |
| --- | --- | --- |
| main | 830c4a5 | Hermes 基线已有；main 不更新 |
| feature/ziwei-hermes-test-v1 | 242562d | 原生分支已有完整祖先历史；保留隔离原型和 52 项契约测试 |
| feature/ziwei-hermes-native-v1 | b5d6806 | 当前部署基线已有；旧部署记录保留为历史 |
| fix/ziwei-native-backup-profile-v1 | e6d404f | 当前部署基线已有；PR #2 被统一 PR 取代 |
| fix/ziwei-security-guardian-audit-20261010 | 1e0ffac | 当前实际部署基线；Guardian、目录安全、API 候选预检完整保留；PR #4 被统一 PR 取代 |
| fix/ziwei-terminal-cwd-absolute-v1 | 3d95e7e | 真正 merge；保留绝对工作目录修复和回归测试；PR #3 被统一 PR 取代 |
| feature/ziwei-autonomous-wake-v1 | 7c8b0b8 | 随 chat-state-sync 的祖先完整合入；旧 worker 不在原生容器中启动 |
| feature/ziwei-chat-state-sync-v1 | 092d1ae | 真正 merge；保留任务取消、原子写回、revision、幂等回执、独立认证和动态记忆；PR #1 被统一 PR 取代 |
| feature/ziwei-shared-memory-read-v1 | 137f4d0 | 真正 merge；保留只读状态/记忆 API；以下旧读者逻辑由较新实现替代 |

旧分支全部保留，不删除、不强制推送，不移动当前部署分支。关闭被统一 PR 完整包含的旧 PR 只整理审阅入口，不表示这些 PR 单独被合并到 main。

## 冲突解决与功能边界

实际解决 `server.js`、`autonomous_agent.js`、`test/autonomous_integration.test.js` 三个文件的冲突：

1. 采用 chat-state-sync 的后续完整记忆读取：支持平铺及 identity/memory/goals/history 子目录、24,000 字符的单源上限、动态 memoryEntries。旧 shared-memory-read 的三文件/10,000 字符读取和追加 chat system 的方式明确被较新实现替代，避免丢失人格、共享历史、取消终态、写回 revision 或动态记忆。
2. 只读状态/记忆路由使用独立 AGENT_READ_TOKEN，默认未配置时拒绝访问；写回仍须 AGENT_PERSISTENCE_ENABLED 与独立 AGENT_STATE_KEY。认证和限流逻辑保留，读权限不能调用写接口，写权限不能代替只读 token。
3. 同时保留真实 Node Gateway/worker HTTP 集成、客户端模型/thinking/tool forwarding，以及只读状态/记忆、写回后再次读取的验证。新增验证只读 API 能读到后续写入的动态记忆。
4. Hermes 新建 profile 的 terminal.cwd 改为 `/data/hermes_native/workspace`；bootstrap 的“不覆盖已存在配置”规则不变。此补丁不能宣称已修复现有线上 profile 的 cwd。
5. 原生 Docker 构建上下文仍仅 `/hermes_native`，官方 pinned image、Guardian、Cron gate、profile bootstrap 和原生记忆实现不替换。根目录 Node 和 `/hermes_test` 是保留的兼容/原型代码，不能把它们的测试结论当作原生 Hermes 具有相同细粒度 HTTP 权限或预算实现的证据。
6. 校正原生 README 中已过时的 toolset 和 background_review 描述；人格/身份正文不变。新增统一主线导航及回归 CI；Python 缓存忽略。

## 验证

本地执行：

- `npm ci --ignore-scripts`：成功。
- `npm test`：33 通过，0 失败；真实 Node 子进程/HTTP、mock 模型上游，覆盖取消、记忆写回、认证、限流、tool forwarding。
- `python3 -m unittest discover -s hermes_native/tests -v`：36 通过，0 失败；覆盖 Guardian、候选认证、目录安全、profile 保留和 Cron gate。
- `python3 -m unittest discover -s hermes_test/tests -v`：52 通过，0 失败；覆盖隔离 SQLite/HTTP/MCP、记忆、预算、任务和恢复契约。
- 冲突整合后的 HTTP 用例额外执行：验证独立读写 key 的隔离以及动态记忆只读回读。
- `git diff --check`：通过；所有源分支独有提交数为零；核心原生控制器与当前部署版本保持相同文件内容。

新增 `Ziwei unified regression` CI，PR 到 main/统一主线时验证全部 121 项回归。现有 `Official Hermes preparation` CI 扩展到统一主线/main PR，并继续只在一次性容器/卷中验证固定官方镜像、真实 Gateway、候选 preflight、Gateway/Guardian 进程监督与容器重启持久化。CI 不访问 Railway，不使用真实模型密钥，也不发 Bark。

最终 CI 和统一 PR 链接见该文档对应提交的 GitHub PR 检查页。没有本地 Docker，因此原生容器验证由 GitHub Actions 完成；历史 CI 成功不能代替本次整合版本的结果。

## 遗留事项

- main 仍绑定一个 production 服务，本次不修改平台配置；不能安全满足“不会触发生产部署”的合并条件。
- 线上仍运行 1e0ffac；本轮没有线上部署、重启、付费模型调用、Cron 故障注入、记忆迁移或备份恢复。CI 回归不能代替新代码的线上验收。
- 原生和旧 Node 的数据格式、API 权限及预算实现不同；保留兼容实现不等于自动迁移现有数据或开第二个 worker。
- 原生持久配置和 scripts 是保留文件；后续上线若需更新，必须先独立核对与备份，不能靠代码 merge 自动覆盖。
