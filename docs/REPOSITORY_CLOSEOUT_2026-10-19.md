# 仓库收口核对 · 2026-10-19

## 基线与范围

核对基线：`integration/ziwei-20261016` 的 `1eeb21160ec78324d5bf591d61b5cd71b29044a6`。
本轮整合分支是临时审查入口，不是新的长期开发主线。最终长期主线仍为 `main`。

已读取 GitHub 66 个分支、17 个开放 PR，并在本地对提交图和文件 blob 做比较。
47 个分支的 tip 为基线祖先（含基线本身），19 个仍有基线不可达的提交。
完整快照见 `REPOSITORY_BRANCHES_2026-10-19.csv`，其中 ahead/behind 相对于上述固定基线。
提交不包含不等于功能缺失；文件一致也不等于整个分支已经合并。

`main` 为 `830c4a51c5cb3e408c868d2a0637e1ebd72502da`，落后基线 320 个提交。
今日印记 `3a99eaa`、`920a674` 已通过 #49 合入基线，不再是待合入内容。
旧 #41 所在 `integration/main-consolidation-20261017` 比基线落后 23 个提交，不能直接作为最新版发布。

## 本轮实际整合

- 从 `feat/dev-next-resume` 保留独立的开发续接工具及其已有 7 项测试；不安装到运行中的 profile，不创建或启用 cron。
- 修复工具默认路径：优先 `ZIWEI_WORKSPACE`，否则使用 `HERMES_HOME/workspace`，保留原 Railway 默认路径作为最后回落。
- 复现并修复 CLI 跨进程租约问题：原实现以短命 CLI 的 PID 作为 owner，下一条 CLI 在写入任务后才报 owner_mismatch。现在可用每轮唯一 `ZIWEI_DEV_OWNER` 跨调用续租；所有写操作先核对 owner，失败不写入。
- 其他 run 不得复用仍有效的租约；有效租约不会因任务时间戳超过六小时而被忽略。
- heartbeat 同时续租。文件证据校验限制在 workspace 内，空文件和空核验拒绝；实际核验的文件路径写入任务 evidence；完成任务前检查真实、非空、范围内的产物，避免制造会再次锁住闸门的新 completed 项。
- 加入真实子进程回归，覆盖同轮跨调用、外来写入不变性、旧 PID 模式拒绝前不写入、证据范围及无证据不能完成。
- 将作业预算补丁的契约测试指向现有 `hermes_native/patches/cron/`，没有再复制第二份补丁。两分支补丁内容完全相同，Dockerfile 已应用现有补丁。
- 从旧整合分支保留 diary 测试的可移植 import 修复；不改变日记行为。
- 保留当前 Playwright 的 `serviceWorkers: block`、失败 trace 与截图，不用旧分支文件覆盖。
- 从旧印记分支选取错误显示修复：先渲染空列表，再显示读取失败，避免 render 清掉错误；保留当前日期筛选与重新加载行为。隔离 DOM 执行中，原版离线后错误隐藏；修复后可见，成功重试后清除。
- 固定镜像 CI 实际复现 runtime_launch.py 把工具搜索折叠后的列表误当完整工具目录，断言 ziwei_status 缺失。选取旧续接分支中的 raw catalog 检查：必须在真实目录存在，并且直接可见或有完整工具搜索桥接。没有删除工具存在性检查；继续由固定镜像验证兼容。

工具的部署及 owner 使用说明见 `DEV_NEXT_INTEGRATION_2026-10-19.md`。

## 19 个非祖先分支的处置

| 分支 | 结论及本轮处置 |
|---|---|
| audit/handoff-inventory-20261017 | 35 个分支变更路径与基线 blob 一致；另外包含未进入基线的 memo/schedule 后端、notes UI 和试验预览。保留分支，不能只当文档分支删除。依据 WEB_POLISH_BATCH1_2026-10-18.md，notes/memo/schedule 两按钮属于当时明确排除的项2，不能当作必补遗漏。保留可选功能历史。 |
| bot/app-acceptance-20261017 | 仅 CI 文件差异。保留；不为消除红灯而用旧 CI 替换当前工作流。 |
| chore/migration-kit-20261019 | 7 个 deploy 文件未合入。Caddy 使用 ziwei-web/ziwei-hermes，而 Compose 服务键为 web/hermes，未显式定义这些网络别名。备份遗漏 profile/scripts、audio_cache 等持久内容，且多文件复制不是整套应用的一致性快照。restore 可 --force 覆盖并自动启动，未先确认旧实例停写。保持待修状态，不发布为完整迁移方案。 |
| diagnostic/webkit-glass-probe-20261011 | 包含诊断 workflow、探针和旧样式。保留为诊断历史，不覆盖当前手机端样式。 |
| feat/dev-next-resume | 本轮选取工具、测试和 diary import 修复后修复真实 CLI 问题；预算补丁、隔离浏览器路由已经存在；runtime launcher 的 raw catalog 检查在固定镜像复现原故障后也选取验证。没有整分支合并。 |
| feature/interaction-workbench | 与 fix/chat-envelope-media 具有相同的一组分叉变更路径，涉及旧 chat service/store、tool_actions 测试和样式。当前 chat_store.decode 已挂接独立 ActionLog，action_log.js 具有工具调用关联、幂等与隐私保护，已有并发及隐私测试。旧 toolAction API 不应重新覆盖；不把 API 名称不同当成功能丢失。分支保留。 |
| feature/work-native-acceptance-20261017 | 16 个分支变更路径中 14 个已与基线一致，剩余 web_bridge.py、Dockerfile 有后续版本差异。不得重复引入旧 Work 核心实现；保留提交历史。 |
| feature/work-phase1-ui | 早期 Work scaffold，当前已包含 #40 的完整 Work。保留旧稿，不能以 scaffold 覆盖现有功能，也不据此声称每个旧交互都已等价验证。 |
| feature/ziwei-google-drive-file-oauth-v1 | 独立 OAuth/owner UI 原型，原 PR #8 明确未部署且公共 callback 集成待验证。保留隔离，不能作为普通整理顺带上线。 |
| feature/ziwei-web-connectivity-probe-v1 | 仅 web_probe 独立诊断服务。保留，不新建服务。 |
| fix/chat-envelope-media | 同上旧聊天分叉；现有 ActionLog 为后续实现。保留历史，不倒灌旧 chat service/store。 |
| fix/ci-webkit-route-interception-20261017 | 目标 serviceWorkers:block 已存在于基线（94b2998）。保留当前截图/trace；无需合入旧完整配置。 |
| fix/moments-native | 替代 bootstrap 自动刷新策略；基线已有受控 preflight_upgrade。保留历史，不引入另一个启动期自动替换闸门的路径。 |
| fix/restore-impressions-entry-20261018 | 基线已恢复入口并增加日期范围；本轮复现离线错误被 render 清除，并只选取错误显示顺序修复，保留当前日期范围与重载实现。其他历史引用保留。 |
| fix/web-send-upload-race | merge-base 到分支 tip 无净文件差异；4 个不可达提交均有 patch 等价项。无需重复整合。保留回滚引用。 |
| fix/work-chat-limit-text | 部分首页/贴纸恢复已进入基线（29 个变更路径 blob 相同），memos/schedule/notes 等未进入，但当时项2明确不在恢复范围。保留可选功能来源，不作为必补缺失。 |
| fix/ziwei-cron-budget-image-20261018 | 8 个变更路径中 6 个已与基线一致，预算补丁和 Work 核心在其中；web_bridge/Dockerfile 为不同后续版本，不能整分支倒灌。 |
| integration/main-consolidation-20261017 | diary import 修复本轮选取；旧验收说明保留历史，不复制成今天的线上结论。 |
| test/web-appearance-baseline-20261016 | 两个分支变更文件与基线完全一致，无须再合入。 |

以上“保留待比对”是明确未完成项，不代表已整合。没有删除任何分支、关闭旧 PR，或移动已有分支。

## 线上修复与源码的差异

以下是源码事实，不是直接读取服务器所得：

- 基线 `autonomy_gate.py` 仍使用六次限额，未包含 2026-10-19 用户转述的八条历史豁免。
- 基线配置模板的 max_turns 为 8；线上 12/24 为 profile 配置报告，不能由仓库模板倒推出实际运行值。
- bootstrap 只在目标不存在时初始化；已有配置和脚本保留。因此源码发布、profile 配置变更和运行进程加载是三件事。
- 今天用户报告的线上闸门、tasks.json、cron/jobs.json 和 config.yaml 尚未直接读取。不得凭转述重建豁免逻辑、覆盖任务表或宣称线上修复已经入库。

## 验证

`python -m unittest discover -s hermes_native/tests`：191 项，185 通过、6 跳过，无失败。
跳过的 6 项为需要官方 Hermes 源码和 OpenAI SDK 的 Work 请求契约测试，不计为通过。
已有租约测试 7 项，加新增 CLI 子进程用例 7 项；均真实运行于临时目录。
Python 编译检查、Playwright 配置 Node 语法检查通过。
本地没有运行浏览器回归、Docker 固定镜像、真实模型调用或线上验收。印记离线及成功重试用隔离 DOM 执行验证。CI 检查入口已补充到当前整合分支，远端结果见 PR。

## 发布门槛与下一步

1. 保留本 PR 为审查入口，先取得 CI 结果。不能仅凭本地部分测试将 main 标记为生产就绪。
2. notes/memos/schedule 属已明确排除的项2，不自动引入；旧 tool_actions 保留历史，以当前 ActionLog 契约为准。后续确有新需求时再单独整合。
3. 修复迁移工具包，并在隔离目录做备份—恢复—校验，确认单主实例后才能用于真实迁移。
4. 从最终选定的生产主机读取当前源码、未提交修改和 profile 配置，核对 10 次机会、24 轮及八条旧任务豁免的实际实现。密钥不得入库。
5. 核对 main 是否仍绑定旧生产自动部署；确认后才能通过受保护 PR 归一主线。不得绕过保护或默认把旧 #41 当最新版本。
6. 最后清理已确认冗余的分支/PR。CSV 快照本身不是删除授权或部署验收。

## 只读部署核对补充

使用 Railway get-service-config、get-status、list-deployments 核对，未读取变量值、未变更部署：

| 服务 | 环境 | 最近成功部署的实际提交 | 部署 ID |
|---|---|---|---|
| ziwei-home-web-test | ziwei-hermes-test | 920a67400a0853d609819eb2021f75116f34815d | 1da789ae-a7d2-42eb-8c27-bb4e09b29622 |
| ziwei-hermes-test | ziwei-hermes-test | 035287594dfa2b6c0c1fe69d896e30608b7352ad | 8e573890-28d8-4a5f-b2ac-4853fe29b536 |

两项均为 SUCCESS。配置中的 pinned commitSha 分别仍显示旧的 612126d 和 01e35a1，不能把 source 配置值当成实际运行提交。部署 metadata 给出的 SHA 才是本表依据；运行容器内未提交修改仍未直接核对。

Work 预览仍引用 feature/work-phase1-ui；独立 web probe 引用 feature/ziwei-web-connectivity-probe-v1。没有更改这些服务。当前读取的服务 source 中未观察到 main 绑定；这不是对 VPS 自动拉取脚本或所有外部 webhook 的证明。

旧主线 PR #5、#41 已标记暂缓，#5 转为草稿，并链接 #51；没有删除分支或关闭旧 PR。

## 已观测到的远端验证结果

以下均针对源码提交 `47dacbe1ce1cdb60633076ce540624703ba9e7f4`；本节及上一节补充只改变文档，不改变已测试源码。

| 检查 | 已观测状态 | Actions run |
|---|---|---|
| Ziwei unified regression | SUCCESS | 39199469743 |
| Official Hermes preparation | SUCCESS：固定镜像构建、真实 Gateway、候选导入及隔离生命周期检查 | 39199469815 |
| Work isolated checks | SUCCESS | 39199469742 |
| Web polish regression checks | SUCCESS | 39199469834 |
| Ziwei Web isolated tests | Web 单测及语法检查 SUCCESS；完整浏览器阶段仍在运行，未计为通过 | 39199469861 |

本表是已观测快照；完整 Web 测试的最终结论以 Actions 为准。没有合并 main、触发生产部署或修改数据卷。
