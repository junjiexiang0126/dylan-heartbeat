# 可调整的 Web 样式

新功能的颜色、圆角、间距、字号使用 CSS 自定义变量，不在组件选择器或 JavaScript 内散落设计数值。默认值集中于 public/tokens.css；现有主题颜色继续沿用 --ink/--muted/--accent/--accent-soft/--bg/--border/--input。以后新增组件也遵守这一约定。

本次已迁移日志/日记/记忆、朋友圈及其弹窗、工作台表格/圆角、拍一拍事件和互动提示；首页、设置、聊天旧样式保持现状，没有整站重画。

## 改几个参数

全局缩放这批组件的排版、间距和圆角：

```css
:root {
  --ui-font-scale: 1.05;
  --ui-spacing-scale: 1.1;
  --ui-radius-scale: .9;
}
```

只改一类组件，覆盖语义参数即可；无需修改每个选择器。

```css
#logs, #memory {
  --records-card-radius: 20px;
  --records-card-padding-inline: 24px;
  --records-card-gap: 18px;
  --records-diary-size: 17px;
  --records-memory-size: 15px;
}
#moments {
  --moments-cover-radius: 22px;
  --moments-body-size: 15px;
  --moments-name-color: #77658e;
}
#workbench {
  --workbench-text-size: 13px;
  --workbench-heading-size: 17px;
  --workbench-dialog-radius: 20px;
}
```

其他入口：--records-title-size、--records-body-size、--records-reading-font、--records-preview-lines、--records-preview-height、--moments-avatar-size、--moments-cover-height、--moments-cover-background、--moments-image-overlay、--interaction-dot-color/size、--interaction-toast-shadow。朋友圈换图的遮罩也来自变量，JS 只设置图片 URL。

基础标尺的 px 默认值集中在 tokens.css，用 --ui-space-*、--ui-font-*、--ui-radius-*、--ui-size-* 复用；语义变量用于日常调整，避免给每条样式单独建立无意义参数。所有默认值保持本次迁移前的效果。

局部覆盖建议写在组件容器上，能覆盖根级响应式默认值，并在明暗主题下保留。全局缩放参数应改在 :root 上，以便根级派生标尺同时更新。CSS @media 条件不支持 var()，所以保留550/360px断点；布局比例、零值重置、层级和动画关键帧比例不属于本次设计数值提取。可按需覆盖动画时长变量，保留系统减少动态效果设置。

新增页面不新增写死的设计值；优先复用现有语义变量/标尺，需要新语义值时在 tokens.css 定义默认值。不要为了美化修改数据接口、知微后端或登录行为。

四个记忆入口使用 --memory-entry-gap / height / padding / radius / title-size / description-size / meta-size / fill / icon-size。分类只影响原生条目的展示，不将视觉入口映射成新的记忆存储或保护策略。
