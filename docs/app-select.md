# 应用内下拉选择器

全站选项菜单统一使用 `src/components/AppSelect.tsx`，不要直接添加可见的 `<select>` 或 `<datalist>`。菜单由应用渲染，不使用浏览器或操作系统的默认选项弹窗。

```tsx
<AppSelect
  aria-label="部门负责人"
  value={leaderId}
  onValueChange={setLeaderId}
  searchPlaceholder="搜索姓名或部门…"
>
  <option value="">暂不设置</option>
  {employees.map(employee => (
    <option key={employee.openId} value={employee.openId}>
      {employee.name} · {employee.department}
    </option>
  ))}
</AppSelect>
```

- `onValueChange` 返回字符串；数字类型请显式转换。
- 8 个及以上选项自动显示搜索框；`searchable` 可显式控制。
- `disabled`、禁用选项、禁用分组、`fieldset disabled` 都会保留。
- 支持方向键、Home/End、Enter、Escape、Tab 和输入搜索；不会因为选择器抢走中文输入法的确认键。
- 菜单通过 Portal 挂在页面根部，滚动区域不会裁切；接近屏幕底部时向上展开。
- 以前允许自由输入的 datalist 使用 `allowCustomValue`，仅改变选择界面，不放宽后台校验。
- 隐藏的原生 select 只用于表单提交、必填校验和重置，不会展示浏览器菜单。

验证：`npm run test:select`、`npm run test:organization:ui`。前者也检查全站没有遗漏的原生选择入口。
