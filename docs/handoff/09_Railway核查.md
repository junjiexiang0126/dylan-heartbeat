# 09 · Railway 只读核查（阶段三）

生成时间：2026-10-17 22:01（读接口：Railway GraphQL v2，只读）

## 一、项目与环境

| 项目 | ID | 环境 | 环境 ID |
|---|---|---|---|
| aware-essence | `7afe77af-0481-4a21-858d-2339fc24ab8f` | production | `b671039f-398c-43fd-befd-da2684107825` |
| 同上 | 同上 | ziwei-hermes-test | `eddf4e4f-1199-45a1-8397-5053c7e9586d` |

## 二、production 里的服务

只有 **一个**：`dylan-heartbeat`
- serviceId：`71bdaa77-da57-40c0-ae6d-9b3bdf29aa5c`
- 最近部署：**无**（`latestDeployment = null`）

### 部署历史（5 条，全部 REMOVED）

| 状态 | commit | 时间 | 域名 |
|---|---|---|---|
| REMOVED | 7c8b0b8350 | 2026-10-08T18:00:42Z | dylan-heartbeat-production-1ff4.up.railway.app |
| REMOVED | 5c4d69f45f | 2026-10-08T17:03:31Z | 同上 |
| REMOVED | 631fae42f9 | 2026-10-08T16:58:58Z | 同上 |
| REMOVED | b0e24321b9 | 2026-10-08T16:46:47Z | 同上 |
| REMOVED | 830c4a51c5 | 2026-10-08T12:17:37Z | 同上 |

**判断**：这是 10 月 7–8 日的初版线上服务，之后全部下线（REMOVED），当前未运行。

## 三、卷（项目级，3 个）

| 卷 ID | 名称 | 创建时间 |
|---|---|---|
| 096576e6 | dylan-heartbeat-volume | 2026-10-07 |
| 3ea62013 | ziwei-home-web-test-data | 2026-10-10 |
| b57605cd | ziwei-hermes-test-volume | 2026-10-09 |

## 四、未获取

- **卷与服务的挂载关系**：`Volume` 类型不支持 `serviceId` / `mountPath` 字段，查询返回
  `GRAPHQL_VALIDATION_FAILED`。挂载关系需在 Railway 控制台或支持该字段的接口确认，**本报告不猜**。
- `dylan-heartbeat` 的源代码仓库/分支来源：当前查询未返回，未获取。
- production 环境是否有待部署变更：未获取（未查 staged changes 接口）。

## 五、与测试环境的关系（可确证部分）

- 两个环境相互独立，服务不重叠。
- 卷名各自独立（`dylan-heartbeat-volume` vs `ziwei-*-test-*`），**没有共用卷的证据**。
- 测试环境三个服务的最新部署：ziwei-home-web-test @ `7c297d6`（10-17 13:08）、
  ziwei-hermes-test @ `6a8ac38`（10-17 12:59）、work-ui-preview @ `56cb419`（10-16 17:48）。
