# 写作台波浪线

## 需求

1. 选中文字 → 蓝底白字高亮
2. AI 弹窗弹出 → 蓝底高亮消失
3. 蓝底高亮消失后，选中文字下方出现红色波浪线
4. 滚动到任何位置，波浪线都要精确在选中文字下方
5. 蓝底高亮还在的时候不要显示波浪线

## 问题

顶部选中文字 → 波浪线正常。滚到底部选中文字 → 波浪线不出现。

## 相关代码

### `src/modules/beats/BeatsModule.tsx`

```tsx
{aiDialog && (
  <div className="sel-overlay" style={{ fontFamily: "system-ui, 'Segoe UI', 'Microsoft YaHei', sans-serif", transform: `translateY(-${overlayOffset}px)` }}>
    {editingContent.slice(0, aiDialog.start)}
    <span className="mark-highlight">{editingContent.slice(aiDialog.start, aiDialog.end)}</span>
    {editingContent.slice(aiDialog.end)}
  </div>
)}
```

```tsx
onScroll={e => {
  setOverlayOffset(e.currentTarget.scrollTop);
}}
```

```tsx
const [overlayOffset, setOverlayOffset] = useState(0);
```

### `src/index.css`

```css
.sel-overlay {
  position: absolute;
  top: 0; left: 0; bottom: 0; right: 0;
  pointer-events: none;
  padding: 1.5rem;
  font-size: 1rem;
  line-height: 1.625;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  color: transparent;
}

.sel-overlay span.mark-highlight {
  background: transparent;
  color: inherit;
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: #dc2626;
}
```
