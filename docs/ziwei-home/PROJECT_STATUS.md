# 知微之家 v1.0 项目状态

更新：2026-10-10，Asia/Bangkok。

## 当前阶段与分支

**第二阶段：主体代码已提交，真实聊天和本地验收通过，完整验收仍有待办。** 本次停止于第二阶段；没有开展第三至六阶段。

- 第二阶段分支 `feature/ziwei-home-phase2-chat`；[PR #11](https://github.com/junjiexiang0126/dylan-heartbeat/pull/11) open，基于第一阶段分支。
- 最新代码提交 `0f9ff83ea058a7b879eabed69704eedd566c14dd`；此后只补验收/状态文档和截图。最终完整文档HEAD以PR最新提交核对，文档不嵌入自身尚未生成的哈希。
- 第一阶段分支 `feature/ziwei-pwa-phase1-foundation`，HEAD `40d1e461885a21ffd16d26fbc3abf6997622e92a`；[PR #10](https://github.com/junjiexiang0126/dylan-heartbeat/pull/10) open，base `develop/ziwei-hermes-unified-v1`。两阶段均未合并、未正式部署Web。

## 已实现功能

第一阶段：五导航、中央默认首页、玻璃风格、日夜主题、响应布局、双人资料、心跳线、固定纪念文字、密码/持久登录、Passkey基础与设置。相识日期/天数待确认，今日状态待同步。Web昵称头像仅展示资料，不改Hermes身份。

第二阶段：既有官方Hermes真实文字/SSE回复；独立SQLite消息/请求/事件持久化；FIFO、UUID幂等、原生幂等键、断线事件重放、重启恢复和不确定运行保护；引用、复制、收藏、搜索、排序、状态、软删除回收站；私有图片/GIF/表情包/文件/视频保存、认证访问和视频Range；小图片/小文本传入原生，其余仅文件信息；2200条有来源的历史档案与幂等事务导入。

朋友圈、记忆、日志保留阶段占位，没有伪造功能或数据。旧Bridge路径停用；新Web仅暴露明确聊天操作，没有任意原生API代理或记忆管理入口。

## 测试与验收证据

见[第二阶段验收](PHASE2_ACCEPTANCE.md)、[历史导入](PHASE2_HISTORY_IMPORT.md)、[真实运行证据](evidence/phase2-live.json)、[聊天截图](evidence/phase2-chat.png)；第一阶段报告仍保留。

后端19通过，语法/Python编译检查通过；Chromium/WebKit浏览器7通过、WebKit虚拟Passkey1跳过。含图片解码、WebM实际播放、复制/引用/收藏/搜索/回收恢复、断线刷新与退出隐私。代码提交远程Web push/PR CI均成功，固定链接见验收报告。未复跑未受影响的原生完整审计或根目录回归。

4次真实原生隔离验收，其中3次经过Web：并发同ID只有一组回复，小文本验证码、实际网页回复和GIF回执由原生完成状态核对。Web重启后6条消息、2200条档案、3个相同运行编号保留；SQLite integrity=ok，重复导入inserted=0。GIF回执不代表图像理解。

## Railway 实际状态

第二阶段开始及提交后只读交叉核对，未凭旧聊天推定部署：

- 项目aware-essence `7afe77af-0481-4a21-858d-2339fc24ab8f`；ziwei-hermes-test环境 `eddf4e4f-1199-45a1-8397-5053c7e9586d`；服务 `d0a928bf-3db2-4085-9812-8a28be4d0b1b`。
- SUCCESS部署 `ce3565ad-547f-4136-be9a-e579ef67be46`，源 `develop/ziwei-hermes-unified-v1@3ef373ad598e5f353026d28b50559001fe0ab5d4`，root `/hermes_native`。Hermes0.21.6健康；域名 `https://ziwei-hermes-test-ziwei-hermes-test.up.railway.app`。
- 原卷 `b57605cd-b47a-4066-bac4-3dd908098250`、1000MB、`/data`、live。旧production服务/卷保留；没有重启/迁移/部署/调整平台权限。
- **本轮没有Web Railway部署。** 本地 `http://localhost:3190/` 仅运行于用户Mac，聊天接既有原生服务；没有正式公网前端地址。

## 数据、备份与遗留问题

私有备份 `ziwei-before-browser-deploy-20261010T035620Z.zip` 源SHA256 `57a32085db27bbd0d10bfbf3ef4e8c64919a99fe4cf3920f3cb9465dd90e77cf`，导入前后不变。30个session/2197个message与3份档案索引为2200条；未向原生session/长期记忆导入。原ZIP未覆盖。第一阶段已有CRC/恢复路径证据，不重复全量恢复。

待完成：二进制/大附件原生内容读取与原生输出附件私有下载；旧生产历史与最新增量完整覆盖；真实iPhone/PWA/FaceID/MP4、公网Web与大陆网络。连接器无容器文件读取能力，原生artifact未启用，不能绕过边界或称全量完成。不同渠道各自生成ID的相同文本尚无跨企业微信去重，后续队列阶段需统一来源事件ID。

原v3/v3.1原文未找到，用户允许以定稿继续；补齐原文后核对差异。纪念日期由最早真实记录核实后用户确认，不能用2026-10-07命名日替代。

Web要求Node>=22.13、独立私有持久目录、单进程/单副本；原生地址/会话/密钥范围绑定既有请求，变更前审查迁移。密钥仅本机 `work/phase2-private/` 0600文件，业务数据 `work/phase2-preview-data/`，均在仓库外，不复制入GitHub。真实测试沿用既有计费路由；未购买套餐或扩大预算。人民币实际账单未取得，token证据不能推算实际费用。

既有根Gateway依赖2项high风险、Hermes公网/local警告、记忆容量与第一阶段单副本容量限制保留；新Web独立依赖扫描0漏洞。生产边缘限流/多实例存储需单独安排，不称本轮已解决。

## 下一次接手

先读本文件和验收报告，核对GitHub PR/HEAD/CI、Railway真实部署和私有数据，再按用户指令继续。优先补齐第二阶段附件内容通路、原始历史覆盖与真机验收；若用户另启第三阶段，也要保留未通过项。第三阶段尚未授权，不提前实施朋友圈、记忆或日志。

## 不得触碰的边界

官方Hermes是唯一Agent与长期记忆权威。SOUL、memories、sessions、workspace、原卷、旧production与私有备份不得清空/覆盖/删除；不得将Web档案当原生记忆，不得在原卷存Web数据。保留Guardian/Cron/企业微信，不另开重复自主核心。不顺手合并/部署至绑定在线Hermes的统一分支，不修改原生权限/密钥/审批。高风险不可逆与新增敏感权限需明确批准，失效审批不反复重试。
