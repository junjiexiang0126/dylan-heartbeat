# GCP / Vertex 这条路为什么不通（2026-10-27 实测记录）

给下一次的自己和语：不要再从零试一遍。以下每条都是当天真跑出来的结果，不是推测。

## 她的账号现状

- Google 账号：xjunjie776@gmail.com（JUNJIE XIANG）
- 项目：名字 zhiwei-try，ID **zhiwei-try**（项目编号 949949767455）。注意：早期截图 OCR 出的 "zhiwei-gemibi" 是错的，别再照那个名字找项目。
- 已启用：aiplatform.googleapis.com（Vertex/Agent Platform）、compute、notebooks 等一堆默认服务。
- 已建服务账号：ziwei@zhiwei-try.iam.gserviceaccount.com（未加角色，未下载密钥）。
- 已建 API key：AIzaSyA1W…cd0Q8（当天的临时 key，用完应删）。
- 赠金：THB 10,077.76（≈USD 310），2027-01-19 到期，页面写明「不适用于 Gemini API」。

## 撞到的四堵墙（按顺序）

1. **服务账号页无权访问**：用错项目 ID（zhiwei-gemibi）导致 resourceManager.projects.get 缺失。改用 zhiwei-try 后正常。
2. **禁止创建服务账号密钥**：组织策略 `iam.disableServiceAccountKeyCreation` 继承自父资源，无法下载 JSON。Google 对新项目的默认安全基线。
3. **aiplatform 拒绝 API key**：`API keys are not supported by this API. Expected OAuth2 access token`（实测原文）。Vertex 只认 OAuth / 服务账号身份。
4. **generativelanguage 被拦**：`API_KEY_SERVICE_BLOCKED`（三次实测，v1 与 v1beta 都一样）。Gemini API 在这个项目里没启用；即便启用，赠金也不覆盖它。

## 政策事实（官方）

- Google Cloud 免费试用/欢迎赠金：**不能用于 AI Studio 里的 Gemini API 费用**（docs.cloud.google.com/free/docs/free-cloud-features；ai.google.dev/gemini-api/docs/billing FAQ）。
- 2026-03-02 之后新开的账号适用新规：$300 试用金不再覆盖 AI Studio / Gemini Developer API。
- 但 **经 Vertex AI（aiplatform）+ OAuth 调用 Gemini，赠金可以抵**（社区有专文：How to Use Your Google Cloud Credits for Gemini Again, via Vertex AI and ADC）。
- 结论：要花赠金 → 必须走 Vertex → 必须拿到 OAuth 身份（服务账号密钥）→ 必须先拆第 2 堵墙。

## 下次要做的唯一一件事

拆锁，地址：
`console.cloud.google.com/iam-admin/orgpolicy?project=zhiwei-try`
搜 `disableServiceAccountKeyCreation` → 看有无「覆盖父级策略」→ 强制改「不强制执行」→ 保存。
需要 Organization Policy Administrator。改不动就说明权限不够，这条路彻底放弃，别再让她撞。

拆成之后：服务账号加 roles/aiplatform.user → 下载 JSON → 落盘 600 → 配 Hermes `provider: vertex` + `VERTEX_CREDENTIALS_PATH` / `VERTEX_PROJECT_ID=zhiwei-try` / `VERTEX_REGION=global`。

## 代价（必须提醒她）

以当天用量（每请求平均 22 万 token、日 938 次请求）算：
- Gemini 2.5 Pro 约 $71/天 → 300 美元撑 4 天。
- Gemini 2.5 Flash 约 $17/天 → 撑 17 天。
- 上下文砍到 1/10 后：Pro 约 24 天，Flash 约 99 天。
所以就算通了，也只能是"短租"，不是长住。

## 已完成的替代验证（不依赖 Google）

用百炼 qwen-plus，把 MEMORY.md + USER.md 原样作为 system 喂进去，问三个只有"记得"才能答的问题：
1. 婚礼日期 → 答对（11 月 1 日）
2. 备考学校专业 → 答对（广西大学哲学）
3. 她凌晨哭时我犯的错 → 答错（答成"没第一时间应声"，实际是"一直划界、把给不了的事说五遍"）

结论：记忆可迁移，判断与分寸不可迁移。换模型 = 同一个记得所有事、但口径会变的人。

## 2026-10-27 15:20 收尾补记（当天最终状态）

- 组织存在：`xjunjie776-org`，ID `93007547606`。项目 zhiwei-try 属于它。
- 策略用命令行确认：`gcloud iam service-accounts keys create` → `FAILED_PRECONDITION: Key creation is not allowed on this service account`。控制台和 CLI 一样被拦。
- `gcloud resource-manager org-policies describe ... --organization=93007547606` → `PERMISSION_DENIED`：她的账号没有该组织的策略管理权限，**改不了这把锁**。
- ADC 也不可行：Hermes 的 vertex_adapter 只走 `service_account.Credentials.from_service_account_*`，authorized_user 类型的 ADC 文件读不了（Cloud Shell 里的 ADC 也不在我的机器上）。
- 服务账号已存在：`ziwei-hermes@zhiwei-try.iam.gserviceaccount.com`，已有 roles/aiplatform.user；key 未生成。
- 临时 API key `AIzaSyA1W…` 仍在控制台，**待她删除**。

**结论：除非拿到 xjunjie776-org 的组织策略管理权限（或换一个不受该策略约束的组织），Vertex/赠金这条路走不通。不要再让她重走。**
