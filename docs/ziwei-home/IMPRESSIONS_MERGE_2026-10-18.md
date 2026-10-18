# 今日印记 · 合并与部署记录（2026-10-18）

给后续接手的人（Work / 知微 / ChatGPT）看的收尾记录。**此事不再重新部署。**

## 一、最终状态

| 层 | 版本 | 说明 |
|---|---|---|
| `integration/ziwei-20261016` | `54dee38dec` | 含 Work 收尾 + PR #48 + 印记入口/范围 |
| Web 线上（ziwei-home-web-test） | `920a67400a08` | 内容与 `54dee38` 一致，部署 `1da789ae-a7d2-42eb-8c27-bb4e09b29622` |
| Hermes 线上（ziwei-hermes-test） | `035287594dfa` | 部署 `8e573890-28d8-4a5f-b2ac-4853fe29b536` |

## 二、合并动作（怕再丢，记清楚）

- **PR #49**：`feat/impressions-entry-20261018` → `integration/ziwei-20261016`，**已合并**，合并提交 `54dee38`
- 基线是 `0352875`（PR #48 的合并提交），**没有回滚 index.html，没有覆盖 Work**
- 改动 4 个文件：`ziwei_web/public/index.html`、`impressions.js`、`impressions.css`、`records.js`（+71 / −6）

## 三、修了什么（三个真实故障）

1. **入口和容器丢失**：`7c297d6` 曾有「今日印记」入口卡与 `#impressionsPage`，后续 `612126d4` / `0352875` 重新打包时丢失 → 从 `7c297d6` 原样取回
2. **点了空白**：`impressions.js` 里 `bindRange` 写成对象方法却在 `show()` 里当普通函数调用，抛 `bindRange is not defined`，`load()` 永不执行 → 提成模块内 `bindRangeCtrl()`
3. **有入口也读不到数**：线上 Hermes 是 `01e35a1b`，`hermes_native/web_bridge.py` 没有 `/ziwei/web/impressions` → 升到 `0352875` 后路由存在，接口返回 200（total 20）

另外把「只能看当天」改成「最近一周 / 全部」两种范围。

## 四、后端路由（唯一后端变更）

```
GET /ziwei/web/impressions?limit=N   1 ≤ N ≤ 200，默认 60，只读
```
实现：`hermes_native/web_bridge.py` 的 `impressions_page(limit)` + 路由注册；
数据源：`workspace/events/impressions.jsonl`，跳过 `op=retract`，按 `ts` 倒序。

## 五、验收

已验：接口 200（total 20，首条「把今日印记上线了」）；线上 HTML 含入口/容器/范围按钮；本地全链路「最近一周 16 条、全部 20 条 / 7 个日期分组」；贴纸 `exp6-01..06` 全 200、`[data-kind]` 映射 10 条；`chat.css`/`chat.js`/`raven.js`/`home.css`/字体 全 200。

待语本人手机验收：入口在不在、两个范围按钮、点「全部」能否翻到 10.09。

## 六、回滚

| 目标 | 版本 |
|---|---|
| Web | 重新部署 `3a99eaa` 或 `0352875` |
| Hermes | 重新部署 `01e35a1b84ec`（回滚后接口会再次 404，前端显示空态） |

## 七、注意

- `main` 仍落后 300+ 提交，尚未合并整合线（另议）
- 本记录对应分支 `integration/ziwei-20261016`，后续若再动印记，请另开记录
