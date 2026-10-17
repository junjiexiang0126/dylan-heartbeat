# P0 朋友圈坏记录隔离与同步恢复

基线为整合分支 3cf1ea2，包含原生负责人 f3c62f7 的附件修复。最终提交 SHA 见 PR 提交列表及交接消息。本提交只处理朋友圈同步。

## 改动

历史无效事件写入既有 moments.sqlite 的 skipped_native_events 表，状态为 invalidated；记录事件 ID、本批序号、原因、父 ID 和首次作废时间，不保存正文或 context_note。后续同步不再尝试导入这些 ID，合法记录继续导入，游标继续推进。原有动态内容不被覆盖，不会伪造回复或重跑 Agent。

永久作废只适用于明确的记录验证错误，例如父缺失、重复回复、编号冲突、无效回复、旧记录被修改。数据库故障、接口故障、分页契约缺失仍保持错误，不能以作废代替恢复。未来时间的坏记录不会把水位推进到未来，避免遗漏后续合法数据。

前端显示同步状态、已作废数量，以及可展开的完整 ID、本批序号、中文原因和父编号。作废条目不会继续显示为正在重试。最近一次真正成功的同步时间持久保存，重启不会丢失。

## 文件

- ziwei_web/moments_service.js
- ziwei_web/moments_store.js
- ziwei_web/public/moments.js
- ziwei_web/public/moments.css
- ziwei_web/public/index.html（本提交仅添加作废记录详情 DOM）
- ziwei_web/e2e/moments.spec.js
- ziwei_web/test/moments.test.js
- ziwei_web/scripts/check_moment_parents.js
- 本交接文件

## 验证命令与实际输出

```sh
node --test ziwei_web/test/moments.test.js
```

```text
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ skipped 0
```

与语音、状态补丁一起做的定向浏览器检查：

```sh
FONTCONFIG_FILE=/workspace/scratch/97e6279ec1ad/qa-fonts/fonts.conf \
SCREENSHOT_DIR=/workspace/scratch/97e6279ec1ad/design-previews TMPDIR=/tmp \
ziwei_web/node_modules/.bin/playwright test \
 --config=/workspace/scratch/97e6279ec1ad/playwright-verification.config.js \
 moments.spec.js chat-completion.spec.js chat-audio.spec.js chat-compose.spec.js
```

```text
25 passed (44.2s)
```

覆盖坏事件后有效事件继续入库、游标推进、重启不重试坏 ID、真实数据库故障不推进、帖子和评论父 ID 查询、作废详情 UI。

## 四个父 ID 的核对

线上库是否含 e86d5148、2074faae、d77dffdd、d0bc90fb：未验证。本机测试库不能作为线上库存在性的证据，也不能据此断言线上库重建过。

维护者在网页服务的真实数据目录执行以下只读命令，将路径替换为现有 moments.sqlite 的绝对路径。脚本以 readOnly 打开已存在数据库，查帖子和评论，包括已删除行；不打印正文、图片或记忆，不创建或修改数据库。

```sh
node ziwei_web/scripts/check_moment_parents.js /实际数据目录/moments.sqlite \
 e86d5148 2074faae d77dffdd d0bc90fb
```

输出每个前缀的 present、完整匹配 ID、类型、删除状态和所属帖子。查不到时需由原生负责人决定旧记录后续处理；本补丁已按 v2 采用作废、继续同步，不重新导入。

## 没做 / 做不了 / 未验证

未直接查询线上数据库，未进行本提交的真机验收、部署或线上 SHA-256 核对。没有修改原生文件、collectMedia、/api/chat/media/sync、服务器配置、环境变量、记忆或持久化卷。P1 二级页及其他清单需求需补齐被引用的 v1 整改单和草图，不包含在本提交内。
