# 知微之家 · 第二阶段

沿用第一阶段首页、五个导航、资料/主题、密码/持久登录与 Passkey。新增真实 Hermes 聊天、事件流、持久队列与消息保存，引用/复制/收藏/搜索/回收站、私有附件、历史查询档案。朋友圈、原生记忆操作与实际日志仍等待第三阶段，没有模拟内容。

## 本地启动

Node **22.13+**；此目录运行 `npm ci --ignore-scripts` 后配置：

- `ZIWEI_WEB_PASSWORD`：独立16字符以上密码。
- `ZIWEI_WEB_DATA_DIR`：独立持久业务目录；开发默认`.data/`，禁止原 Hermes 卷/目录，生产必须显式设置独立卷（例如`/web-data`）。
- `ZIWEI_WEB_ORIGIN`：固定来源，例如`http://localhost:3000`，生产HTTPS。
- `ZIWEI_BRIDGE_ENABLED=true`：启用真实聊天；`false`时仍可使用首页与已导入的查询档案。
- `ZIWEI_HERMES_URL`：现有 Hermes HTTPS 根来源。
- `ZIWEI_HERMES_API_KEY_FILE`：本机或容器私有密钥文件；也可服务端`ZIWEI_HERMES_API_KEY`。原生接口用现有`API_SERVER_KEY`，不能把旧原型的`ZIWEI_CHAT_KEY`当作原生密钥。绝不写进前端、Git、截图或日志。
- `ZIWEI_HERMES_WEB_SESSION_ID`：固定的新 Web 会话ID，非任意浏览器输入。验收使用独立会话，不重建 Agent。
- `PORT`：默认3000；开发绑定127.0.0.1，生产0.0.0.0。

执行 `npm start`。先密码登录，再打开聊天。无需从浏览器访问原生 API，密钥保留在后端。现场兼容性与故障/重试边界见 [PHASE2_CONTRACT.md](PHASE2_CONTRACT.md)。

## 能力和限制

真实原生`/v1/runs`支持持久幂等及流式事件，当前接口已经实测。Web保留每条业务UUID、真实运行编号、原生事件序号及最终结果；断线恢复不会自动创建另一条运行。Agent 自己决定回复内容和过程消息，不设置固定字数或人为拆分。

附件20MB/个、6个/消息、1GiB保存配额。图片/GIF/表情包可显示；视频可播放（取决于设备编解码器）；其他文件可下载。小图片以 inline image_url传 Hermes，小文本传资料正文。**视频、PDF/Office等二进制当前只传元信息，文件保存与内容理解是不同验收项。** 原生生成文件的私有下载尚未接通。不得启用额外原生权限来掩盖此限制。

原始历史不被删除/改写。`source=archive`仅供用户查询，保留原文件及来源；不是 Hermes 长期记忆。首页相识日/天数仍为待确认，2026-10-07只是命名日，今日状态仍待同步。

消息“删除”移到可恢复的回收站；原生上下文/历史、引用快照与附件均保留。所有设备只服务同一家庭账号，不是多租户系统。多入口须共享同一业务事件 UUID才会去重；独立手工在不同渠道重复发送文字不被当成同一事件。企业微信入站统一队列属于后续工作。

## 数据和恢复

保留第一阶段`home.json`、`sessions.json`、`auth.json`。新增`chat.sqlite`及其WAL/SHM、`attachments/<uuid>`；文件0600、目录0700，一份目录只能运行一个进程/副本。首次未发送消息前可配置桥接；已有请求时改变原生端点/会话/密钥会拒绝启动，须审查迁移，不能清空数据库重新来过。

备份/恢复必须停止Web或采用SQLite一致性备份，并保存整个业务目录、附件及私有部署配置。原生卷另用既有官方备份路径；不能用 Web 数据覆盖 Hermes。不要把原始/规范化档案、数据库、密钥或业务附件提交到公开仓库。

离线准备已有备份的查询档案：

```
python3 scripts/prepare_history_archive.py PRIVATE_BACKUP.zip PRIVATE_ARCHIVE.json
node scripts/import_archive.js PRIVATE_ARCHIVE.json WEB_DATA_DIR
```

Web必须停止。首次初始化时配置应与后续Web启动相同；已有数据库由脚本读取绑定的来源。脚本拒绝带未恢复WAL的原生备份，不执行 Agent/模型/记忆接口。源同一SHA、ref但内容不同则拒绝覆盖。

## 测试与交接

`npm test`：权限/CSRF、幂等、原生接收响应丢失、进程重启、FIFO、保留窗外不重投、附件范围/类型/大小、回收站、档案事务、Native路径保护及第一阶段回归。

`npm run check`：语法。`npm run test:e2e`：Chromium/WebKit手机视口，真实WebAuthn签名（虚拟验证器）、聊天操作、文件/GIF/真实WebM解码、网络中断、重新登录。端到端使用本地协议 fixture，不调用真实模型；现场真实验收另有独立证据。

交接见 `../docs/ziwei-home/PROJECT_STATUS.md`、`PHASE2_ACCEPTANCE.md`与`PHASE2_HISTORY_IMPORT.md`。当前没有公网Web部署，不能将 WebKit/虚拟验证器称作真实 iPhone 或大陆网络验收。部署准备仍为独立服务 `/ziwei_web`、单副本、独立Web卷和HTTPS，禁止改动原 Hermes 服务/卷/生产分支。
