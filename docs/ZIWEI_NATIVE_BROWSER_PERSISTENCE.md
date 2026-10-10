# Hermes 原生本地浏览器持久化

基于统一开发分支 `develop/ziwei-hermes-unified-v1` 的 `7c278435`，使用现有 Hermes 0.21.6 官方固定镜像。本轮只修改开发代码，不部署、重启或读写 Railway 活动数据。

## 现有实现与修复

官方 `browser_tool_session.py` 为普通本地 Chromium 创建随机任务会话，结束或空闲后关闭 daemon。既有 Ziwei 启动补丁没有设置持久化的 `AGENT_BROWSER_PROFILE`。固定 socket/session 名会破坏任务引用隔离，也不能保存磁盘状态；多个 daemon 共用目录会争用 Profile。

本实现保留原生浏览器工具，在凭据清理后的命令环境中加入持久化 Profile，使用任务租约避免并发写入。除 Gateway launcher 外，原生 CLI 和独立 Cron worker 也直接导入工具，因此镜像内 facade 增加导入钩子。控制模块位于不可由 Agent 修改的 `/opt/ziwei-native`，在 `/opt/hermes` 仅增加导入 symlink，没有扩大自主补丁白名单。安装幂等，私有函数签名不兼容时预检失败，不静默退回临时浏览器。

## 行为与边界

- 每个 Hermes home 独立使用 `browser/ziwei-native-v1/profile`。持久 Cookie、localStorage 和 Chromium 磁盘资料可跨任务、进程及容器重启保留；网站有效期、撤销登录和仅会话 Cookie 规则仍适用。该目录必须在持久卷上。
- 保留原生每任务 daemon/socket、导航、引用、截图、凭据清理、超时回收和空闲关闭。不常驻新浏览器，不增加模型调用或付费账号。
- 同一 home 只允许一个任务拥有写入租约；竞争返回 `browser_profile_busy`，不启动第二个写入者、抢占其他任务或重复操作。线程内状态和跨进程 `flock` 同时保护。
- 正常清理或超时 evict 后释放租约，保留 Profile 和 lock inode。原生 daemon 仍存活时继续阻塞，结束后才释放；模块不杀其他进程，不删除 Singleton 文件或浏览器资料。
- 仅接入 plain local、headless Chromium。云浏览器、CDP、真实用户 Profile、私网 sidecar、Camofox、Lightpanda、headed Bot Desktop 和工具沙箱保留官方行为；不会复制用户电脑或 aredink 的登录资料。
- 目录逐层 `O_NOFOLLOW`，拒绝 symlink、特殊或硬链接 lock；目录 0700、lock 0600，不进行 root chown。绑定 session 原始 home，后台清理不会串用其他 Profile。任务 ID 不用于磁盘路径。
- Profile 变量仅在当前命令上下文加入，不改全局环境，不附带 DeepSeek/API/平台密钥。已有显式 `AGENT_BROWSER_PROFILE` 冲突时拒绝，应禁用其中一种配置。

`browser.persistence.enabled` 默认为 true，新配置模板显式设置 true；现有配置不写回。false 使后续新任务使用原生临时浏览器，已绑定任务需先正常结束。非法类型拒绝执行。

这不是 OS 沙箱或账号分权。同一 home 的任务有意共享网站登录资料；已有 local 终端的同 UID 风险仍存在。需要分离的用户或账号应使用不同 home。

## 验证

本地保留 Node/Python 回归，新增目录/锁、跨进程互斥、Profile 保留、失败回收、配置开关、后端排除、上下文隔离与候选契约测试。准确数量和 GitHub 结果见 PR 最新记录。

固定镜像 CI 的 `check_browser_persistence.py` 在合成密钥、一次性卷与 localhost 网页上，以 UID 10000 直接导入原生工具，刻意不调用 Gateway launcher。验证 HttpOnly 持久 Cookie、localStorage、snapshot、截图、任务接力、第二任务拒绝和凭据环境清理。先 write，完整重启临时容器，再由新 Python 进程 read；保留原有 Gateway/Guardian、认证和卷 marker 检查。

脚本要求显式 `ZIWEI_EPHEMERAL_BROWSER_TEST=1`、精确合成密钥及临时卷 marker，拒绝普通线上环境。不调用模型、真实账号、Bark 或公开发布。临时容器的重启不涉及 Railway。

## 部署与回退

PR 目标为统一开发分支，不合并 main；生产 main 仍可能被 Railway 自动部署，本轮不触碰它。未来部署需另行批准，并先核验备份、卷空间与运行补丁兼容性。首次使用才创建新目录，不迁移或覆盖现有资料。

回退镜像或关闭开关不会删除 Profile，旧版本可能不使用它。账号切换、数据恢复和资料删除是另外的操作。Profile 的既有备份会包含浏览器目录，增加磁盘与备份体积，部署前需评估容量。
