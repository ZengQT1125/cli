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

// 亮色采用与深色主题（OneDark 风格）同族的 One Light 配色，
// 色相关系一一对应、观感统一，仅做亮度适配以保证浅色背景下可读。
const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#a0a1a7', fontStyle: 'italic' },
  { tag: tags.propertyName, color: '#e45649' }, // YAML 键名（对应深色 #e06c75 红粉）
  { tag: tags.string, color: '#50a14f' }, // 字符串（对应深色 #98c379 绿）
  { tag: tags.number, color: '#986801' }, // 数字（对应深色 #d19a66 橙）
  { tag: tags.bool, color: '#0184bc' }, // 布尔（对应深色 #56b6c2 青）
  { tag: tags.null, color: '#0184bc' }, // null
  { tag: tags.keyword, color: '#a626a4' }, // 关键字（对应深色 #c678dd 紫）
  { tag: tags.operator, color: '#4078f2' }, // 对应深色 #61afef 蓝
  { tag: tags.punctuation, color: '#383a42' },
  { tag: tags.meta, color: '#4078f2' },
  { tag: tags.tagName, color: '#c18401' }, // 对应深色 #e5c07b 黄
  { tag: tags.invalid, color: '#e45649' },
  { tag: tags.heading, color: '#4078f2', fontWeight: '600' },
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
