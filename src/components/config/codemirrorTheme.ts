import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * 配置面板 - 源文件编辑的 CodeMirror 主题。
 *
 * @uiw/react-codemirror 默认只传 `light` / `dark` 字符串，语法高亮是对比度偏低的
 * 默认配色，且选中文本的背景（浅蓝/暗灰）不够明显。
 * 这里在默认主题之上提供两套自定义主题：
 *  - 高对比度 YAML 语法高亮（键名/字符串/数字/布尔 用不同色相拉开区分）
 *  - 更明显、偏灰的选中背景
 */

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: tags.propertyName, color: '#0550ae' }, // YAML 键名
  { tag: tags.string, color: '#116329' }, // 字符串
  { tag: tags.number, color: '#a05a00' }, // 数字
  { tag: tags.bool, color: '#7c3aed' }, // 布尔
  { tag: tags.null, color: '#7c3aed' }, // null
  { tag: tags.keyword, color: '#cf222e' },
  { tag: tags.operator, color: '#0a3069' },
  { tag: tags.punctuation, color: '#57606a' },
  { tag: tags.meta, color: '#0a3069' },
  { tag: tags.tagName, color: '#116329' },
  { tag: tags.invalid, color: '#cf222e' },
  { tag: tags.heading, color: '#0550ae', fontWeight: '600' },
]);

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#7f848e', fontStyle: 'italic' },
  { tag: tags.propertyName, color: '#e06c75' }, // YAML 键名
  { tag: tags.string, color: '#98c379' }, // 字符串
  { tag: tags.number, color: '#d19a66' }, // 数字
  { tag: tags.bool, color: '#56b6c2' }, // 布尔
  { tag: tags.null, color: '#56b6c2' }, // null
  { tag: tags.keyword, color: '#c678dd' },
  { tag: tags.operator, color: '#61afef' },
  { tag: tags.punctuation, color: '#7f848e' },
  { tag: tags.meta, color: '#61afef' },
  { tag: tags.tagName, color: '#e5c07b' },
  { tag: tags.invalid, color: '#f44747' },
  { tag: tags.heading, color: '#61afef', fontWeight: '600' },
]);

const lightTheme = EditorView.theme({
  // 选中背景：灰蓝，比默认淡紫更明显。
  // 使用与 CodeMirror 默认主题相同的选择器结构（.cm-selectionLayer .cm-selectionBackground），
  // 确保 specificity 不低于默认规则，能够稳定覆盖聚焦/非聚焦的选中颜色。
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: '#c6d2da',
  },
  '& .cm-selectionBackground': { backgroundColor: '#c6d2da' },
  '& ::selection': { backgroundColor: '#c6d2da' },
});

const darkTheme = EditorView.theme({
  // 选中背景：偏亮的灰蓝，比 oneDark 默认更清楚
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: '#4a5568',
  },
  '& .cm-selectionBackground': { backgroundColor: '#4a5568' },
  '& ::selection': { backgroundColor: '#4a5568' },
});

export const lightCodeMirrorTheme = [
  lightTheme,
  syntaxHighlighting(lightHighlightStyle),
];

export const darkCodeMirrorTheme = [
  darkTheme,
  syntaxHighlighting(darkHighlightStyle),
];
