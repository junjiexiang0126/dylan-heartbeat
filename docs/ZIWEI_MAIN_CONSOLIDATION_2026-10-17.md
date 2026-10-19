# 知微仓库归一主线整合审计（2026-10-17）

目标：最终仅保留 `main` 为长期开发分支。此分支仅用于过渡整合，合并后删除；不要把它设为长期 develop。

## 当前线上基线（只读确认）
- Railway 项目 `7afe77af-0481-4a21-858d-2339fc24ab8f`，环境 `eddf4e4f-1199-45a1-8397-5053c7e9586d`。
- Web: `ziwei-home-web-test` ← `feature/work-integration-20261017`；部署 `5a95148e-61e6-48e8-a086-b5e5a47e62b6` SUCCESS；持久卷 `/web-data`。
- Hermes: `ziwei-hermes-test` ← `feature/work-native-acceptance-20261017`；部署 `49ffa2d6-7508-4359-af46-058569e4cb1e` SUCCESS；持久卷 `/data`。
- Work 预览: `work-ui-preview` ← `feature/work-phase1-ui`；部署 `f59c5f43-6123-4fd3-86f4-34a0efcbed6c` SUCCESS。
- 无 Railway staged changes。不可删除服务、卷或用户数据。

## 已核对的提交包含关系
- `main` 是 `feature/work-integration-20261017` 的祖先（后者领先 286 commits；main 未有独有提交）。
- `feature/raven-house-v2-20261017`、`feature/web-raven-3d-20261016`、`integration/ziwei-20261016`、`fix/status-tool-visibility` 均是 Web 整合分支的祖先；无须重复 cherry-pick。
- `feature/work-native-acceptance-20261017` 与 Web 整合分支 diverged：原生分支独有 9 commits，Web 整合分支独有 51 commits；差异涉及 `hermes_native/work_agent.py`、`work_bridge.py`、`web_bridge.py` 和测试。**必须逐文件比较、运行测试，不得直接用一侧覆盖另一侧。**
- `feature/work-phase1-ui` 与 `feature/interaction-workbench` 对 Web 整合分支均 diverged；在确认其独有提交已被等价实现替代前，不删除。

## 合并门槛（尚未通过）
1. 核实 Hermes 分叉独有提交，解决文件级冲突并保证 Web/原生 API 契约兼容。
2. 运行 Hermes、Work、Web 现有回归；记录测试命令、结果与未验证项。
3. 比较其他旧分支独有提交，明确保留/等价替代/待审计，不能只根据名称删分支。
4. 将已验证的整合结果合入 `main`；Railway 两服务分别固定已验证 commit 部署、验收，再将来源切换 `main`。
5. 最后清理已确认完全包含的临时分支；保留备份标签及尚未核实的分支。

**本记录仅为整合准备，不声称代码合并、测试或线上部署已经完成。**

## 进一步核对：Hermes / Work 关键文件（本轮）
- 对比 Web 整合分支和 Hermes 验收分支的六个文件 Git blob SHA：`hermes_native/work_agent.py`、`work_bridge.py`、`web_bridge.py`、`tests/test_work_agent.py`、`tests/test_work_agent_sdk.py`、`tests/test_work_diagnostic.py`，**全部相同**。
- 因此这些关键文件目前无需重新覆盖或手工复制；两分支仍有独有提交历史，且其他文件/历史未全面验收。
- 不把「文件 SHA 相同」误写为「整个分支已经安全合并」；测试和其他旧分支独有变更仍待核对。
