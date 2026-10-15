# 状态工具可见性修复（2026-10-15）

基于文件交付修复 `c233f351`，仅提交 `fix/status-tool-visibility`，不合并、不部署。

## 已确认的代码问题

旧实现将 `ziwei_status` 注册到动态分类 `ziwei_web`，并把工具名加入 API/Cron 组合列表，但未在 `toolsets.TOOLSETS` 声明该分类。Hermes 的 `_get_platform_tools` 会把组合列表拆成分类，再由 `_recover_platform_native_toolsets` 恢复非配置项的平台工具；后一步遍历静态分类，因而漏掉仅在注册表存在的 `ziwei_web`。路由存在、直接查询状态接口或工具总数大于 20 都不能证明模型可调用该工具。

## 修改

- `hermes_native/web_bridge.py`：增加明确且独立的静态 `ziwei_web` 分类，保留 API/Cron 两个组合成员；先完成静态声明再调用 registry.register，让注册表 generation 在最后变更、使已缓存的工具集解析失效。无需把状态工具塞进文件或记忆分类，也不改用户 config.yaml。
- `hermes_native/runtime_launch.py`：候选版本预检使用真实配置经 `_get_platform_tools(config, 'api_server')` 得到分类，再检查最终模型工具定义中确实存在 `ziwei_status`。缺失则阻止候选版本通过，不能只凭工具数量放行。成功会打印 `[ziwei] ziwei_status visible in resolved api_server tool definitions.`。
- `hermes_native/tests/test_web_bridge.py`：增加分类声明/注册先后、重复安装不重复成员、四状态 schema、正确处理函数及不修改 CLI 组合的检查。

没有写入线上状态；状态仍只能由知微自愿调用发布，未发布就显示未同步。四种状态、30 分钟过期、私有读取、头像/主题、记忆、人格和配置均不变。

## 验证和边界

- 原生部署层 `python3 -m unittest discover -s hermes_native/tests`：70/70 通过。
- Python 编译与 git diff --check 通过。
- 在隔离进程使用已获取的官方 tools.registry / toolsets 源码及 `_recover_platform_native_toolsets` 函数复现：旧实现的解析结果缺少状态工具，修复后 API/Cron 均可得到其函数 schema，包含提前预热解析缓存的情况。限制为其他分类的显式选择没有被全局注入状态工具。
- 该隔离解析验证不是启动线上 Hermes 镜像或付费模型调用；实际部署树使用的新预检还需用户部署时执行，线上知微能成功调用才是最终验收。未向个人对话/长期记忆写入测试状态。

## 用户手动部署

只更新现有 **ziwei-hermes-test** 原生服务到本次修复提交，目录继续 `/hermes_native`，已有固定 commitSha 也需选中该新提交。Web 服务不需要因本次修复再次部署；不增加环境变量、不创建服务或数据卷。不要只重新部署旧的 `c233f351` 或 `9fc81c1`。

部署成功后让知微在下一轮按实际情况调用 `ziwei_status`。检查返回成功、名字下方与首页显示相同状态；若仍不可见，保留原始工具错误继续核对运行时，不通过聊天文字或后台代写状态冒充成功。

## 回滚

将原生服务回滚到 `c233f351f4763f20c070acd2ca40374e4ab6e920`，保留持久卷和全部现有文件。Web 不变，无数据库迁移。
