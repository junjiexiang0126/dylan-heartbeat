# 知微之家第一阶段验收证据

日期：2026-10-10，Asia/Bangkok。仅本次六阶段计划的第一阶段；不是旧 Hermes 原生迁移项目的“第一阶段”。

## 代码和功能

恢复起点：`feature/ziwei-pwa-phase1-foundation@f98d69de294335a5de577524df47610eca5deb99`，现有草稿 PR [#10](https://github.com/junjiexiang0126/dylan-heartbeat/pull/10)，目标 `develop/ziwei-hermes-unified-v1`。该起点的 `web` 与 `retained-components` GitHub CI 已成功。本轮复用现有 Web/BFF 和 Bridge 文件，不重建项目；不提前接通真实聊天。

完成五导航、中央默认首页、玻璃外观、日夜/系统主题、三种背景色调、320/390/430/820px 布局、安全区域、动态心跳与减少动态效果支持、双人头像昵称、命名日、永久纪念文字、资料保存及完整变更历史。相识日期与相伴天数为“待确认”；今日状态未接入 Hermes，明确显示“等待同步”，更新时间暂无。

完成密码认证、30 天持久会话、Cookie 安全属性、CSRF、认证限速、改密码使旧会话失效、当前/全部设备退出、Passkey 注册/验证/移除、一次性 challenge、Origin/RP ID/用户验证/签名/计数器校验。生产必须指定独立持久目录；不允许将 Web 数据放在原 Hermes profile。

## 本轮实际执行

| 检查 | 结果 | 实际覆盖与边界 |
| --- | --- | --- |
| `npm test` | 11 通过，0 失败 | HTTP 权限、CSRF、资料校验、纪念文字不可覆盖、revision 冲突、会话及资料重启保留、全部设备撤销、文件权限、限速、Passkey 门禁/错会话/伪造/重复 challenge；原有 Bridge/SSE/恢复 mock 回归 |
| `npm run check` | 通过 | server、home_store、前端和 service worker 语法 |
| `npm run test:e2e` | 3 通过，1 明确跳过 | Chromium/WebKit 中实际登录、五导航、头像解码缩放/保存、昵称文本防注入、设置主题、刷新持久化、横向溢出检查、会话撤销；Chromium 虚拟验证器实际产生 WebAuthn 签名并由服务器验证 |
| WebKit Passkey 专项 | 跳过 | CDP 虚拟验证器只适用于 Chromium；不能当成真实 iPhone Face ID 通过 |
| 独立 Web 包依赖审查 | 当时 0 vulnerabilities | 固定依赖/lockfile；不是完整安全审计结论 |
| 根目录回归范围修复后 `npm test` | 33 通过 | 明确测试发现范围，Gateway 运行逻辑与依赖未改动 |
| `git diff --check` | 通过 | 无空白错误 |
| 原 Hermes/Gateway 文件保护 | 通过 | 与 `3ef373a` 比较 `hermes_native/`、根 `server.js`、`railway_start.js` 均无差异 |

测试过程中发现并修复头像 blob 预览被 CSP 拦截；随后重新通过头像端到端测试。初次浏览器测试因本机缺少测试浏览器而失败，安装独立测试浏览器后执行成功。没有将这些失败冒充首次通过。

首个功能提交 `02143a2` 的前端 CI 通过；统一回归因根目录 `node --test` 意外收集独立 Web 测试、该 job 未安装 Web 依赖而失败。随后把根目录测试范围明确为 `test/*.test.js`，Web 仍由专门 CI 安装自己的依赖和验收；没有改动 Gateway 运行逻辑。该回归失败与修复均保留，不将首个 CI 宣称全部通过。

截图来自真正运行的本地服务、390×844 视口：

- [日间首页](evidence/home-light.jpg)
- [夜间首页](evidence/home-dark.jpg)

本地预览：`http://localhost:3190`，独立测试密码/目录，Bridge=false。只供此 Mac 的本地预览，未部署公网页面；不作为 Railway 或实际 iPhone 验收。

## Railway 只读现场核对

| 项目/环境/服务 | 实际结果 |
| --- | --- |
| aware-essence `7afe77af-0481-4a21-858d-2339fc24ab8f` / ziwei-hermes-test `eddf4e4f-1199-45a1-8397-5053c7e9586d` / ziwei-hermes-test `d0a928bf-3db2-4085-9812-8a28be4d0b1b` | SUCCESS 部署 `ce3565ad-547f-4136-be9a-e579ef67be46`；实际来源 `develop/ziwei-hermes-unified-v1@3ef373ad598e5f353026d28b50559001fe0ab5d4`，root `/hermes_native`，新加坡单副本 |
| Hermes 持久卷 | `b57605cd-b47a-4066-bac4-3dd908098250`，1000MB，挂载 `/data`，仍 live；没有修改 |
| Hermes 健康 | `https://ziwei-hermes-test-ziwei-hermes-test.up.railway.app/health` 实际 HTTP 成功，`status=ok, platform=hermes-agent, version=0.21.6`；日志显示 Gateway 在运行及原生活动。健康检查不证明所有业务或卷内每个文件完整 |
| 原 production 旧服务 | aware-essence production 的 `dylan-heartbeat` 服务与 `096576e6-34a6-4a81-bc9b-8bfc5d7d85b0` 卷保留；未启动、重启或删除 |
| 前端探测服务 | feisty-gentleness production 的 `ziwei-web-probe`，SUCCESS `77adcf6b-3a61-427e-bf5c-b56fc16fe494`，来源仍为 `feature/ziwei-web-connectivity-probe-v1`；不是本轮完整首页版本 |
| 本轮部署 | 无。没有 Railway 配置写入、部署、重启、卷操作或付费模型调用 |

实际状态比旧 `ZIWEI_BRANCH_AUDIT_20261010.md` 中的 `1e0ffac` 已更新；本文件以本轮 API 查询结果为准。运行时自更新补丁不等于 Git commit，未读取其完整在线代码树。

已有日志仍提示公网 API + local 终端后端、原生记忆容量接近上限。这些为现有系统风险，本轮没有扩大入口、删除记忆或修改安全策略。

## 备份与恢复路径

本机已有私有备份，本轮只对 ZIP CRC 和 SHA-256 做读取校验，没有提取私人内容或提交公开仓库：

| 私有备份文件名 | 校验 |
| --- | --- |
| `ziwei-after-v41-20261009.zip` | 1,745,724 字节，419 entries，CRC 全通过；SHA-256 `bdadb585ce133c7baa286d5e73beb559f2f5188b296eea7df0f005296326bf26` 与历史交付报告一致 |
| `ziwei-before-browser-deploy-20261010T035620Z.zip` | 58,508,756 字节，2349 entries，CRC 全通过；SHA-256 `57a32085db27bbd0d10bfbf3ef4e8c64919a99fe4cf3920f3cb9465dd90e77cf` |

私有文件位置为本机 `Documents/Codex/2026-10-09/files-mentioned-by-the-user-4/outputs/`；勿放进公开 GitHub。旧验收报告记录 `after-v41` 已在隔离目录用原生恢复，7 数据库完整及10核心文件一致。本轮没有重做该完整恢复审计，也不将旧快照称为当前最新实时备份。

恢复路径：固定当前 Git/官方镜像 → 使用 Hermes 原生 `hermes backup` 处理 SQLite WAL → CRC/哈希 → 私有位置保留 → **单独隔离 profile** 执行 `hermes import`、数据库完整性和文件核对 → 不启动第二个 Gateway → 需要回滚时再经批准选择性恢复。不得在唯一在线 profile 上做恢复试验；Railway 部署回滚不等于回滚数据卷。现有 connector 无容器文件读取/备份工具，本轮未验证在线备份目录最新文件和字节级数据一致性。

## 资料来源与待验收

已读取“审查前端方案”聊天中的定稿产品规格；永久纪念文字与命名日直接来自该规格。用户明确确认相识日期未核实，不能用命名日替代。

`frontend-spec-v3-for-ai.md` 和 `ziwei-frontend-spec-v3.1-amendment.md`：已搜索当前仓库、全部克隆远程历史文件名与本机 Codex 文件；未找到原文。现有 PR 文件也没有这些文件。用户告知 v3.1 在 ChatGPT 文件资料中，但本轮没有取得可读取的文件位置；未虚构其中细节。以定稿规格、用户补充和真实代码为依据；原文缺失作为交接事项保留。

待验收：真实 iPhone Safari/PWA 安装、Face ID/Touch ID/设备 PIN、实际设备安全区域；正式/公网 Web 部署与服务重启；真实大陆网络；今日状态真实来源与更新时间。相识日期待最早记录核实与用户确认。第二阶段真实聊天、附件、历史导入及后续其他功能未实施。

## 补充维护记录

根目录旧 Gateway 的 `npm ci` 提示2个 high 风险包，随后只读 `npm audit --json` 确认为 `fastify` 与 `fast-uri`；这是原有 lockfile 的依赖，本轮没有升级生产/原生 Hermes 或改动该 lockfile。相关官方公告示例：[Fastify 认证绕过](https://github.com/advisories/GHSA-p68q-wchp-6fh7)、[fast-uri authority 注入](https://github.com/advisories/GHSA-qw65-cvwx-89v3)。依赖风险不等于已证明现有部署可利用，但应在旧 Gateway 后续启用或发布前做单独修复与验证。独立 Web 包不依赖 Fastify/fast-uri，不能因此宣称原系统的安全问题已全部解决。

## 最终代码提交的远程 CI

功能提交：`02143a2b3d25ca1cd607b1ccd94f43dd7e1a676d`。测试发现范围修复后的最后代码提交：`ff9e0d572617a13f40a921a582e0c9b8538082b1`。其后的交接提交仅改本文与 PROJECT_STATUS，不改运行代码。

已从 GitHub 当前 API 核实，以下3个检查均 completed/success：

- [Web PR 检查（含浏览器验收）](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/38061996653/job/114241961171)
- [Web push 检查（含浏览器验收）](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/38061991421/job/114241945721)
- [retained-components 统一回归](https://github.com/junjiexiang0126/dylan-heartbeat/actions/runs/38061996623/job/114241960859)

保留组件回归由仓库已有 CI 自动触发。本轮没有人工重新进行完整线上审计、故障注入、备份恢复或模型聊天实测。
