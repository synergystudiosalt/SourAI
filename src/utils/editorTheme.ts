import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const MONO_FONT = "'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace";

const lightTheme = createTheme({
  theme: 'light',
  settings: {
    background: '#ffffff',
    foreground: '#2d2a24',
    caret: '#d96b43',
    selection: '#f0ddc9',
    selectionMatch: '#f5ece3',
    lineHighlight: '#faf9f680',
    gutterBackground: '#ffffff',
    gutterForeground: '#b3aea3',
    gutterActiveForeground: '#1c1b1a',
    gutterBorder: 'transparent',
    fontFamily: MONO_FONT,
  },
  styles: [
    { tag: t.comment, color: '#8c887d', fontStyle: 'italic' },
    { tag: [t.string, t.special(t.string), t.character], color: '#3f7d4e' },
    { tag: [t.number, t.atom, t.bool, t.unit], color: '#ae6a2e' },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#a6423a' },
    { tag: [t.operator, t.punctuation, t.bracket], color: '#6b6656' },
    { tag: [t.variableName], color: '#2d2a24' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#6e5aa0' },
    { tag: [t.className, t.typeName], color: '#a6423a' },
    { tag: [t.propertyName], color: '#2f6f8f' },
    { tag: [t.tagName], color: '#a6423a' },
    { tag: [t.attributeName], color: '#ae6a2e' },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#1c1b1a', fontWeight: '600' },
    { tag: t.invalid, color: '#c8372f', textDecoration: 'underline' },
    { tag: t.link, color: '#2f6f8f', textDecoration: 'underline' },
    { tag: t.heading, color: '#a6423a', fontWeight: 'bold' },
    { tag: t.meta, color: '#8c887d' },
  ],
});

const darkTheme = createTheme({
  theme: 'dark',
  settings: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    caret: '#d96b43',
    selection: '#3a3020',
    selectionMatch: '#2c2a24',
    lineHighlight: '#25252480',
    gutterBackground: '#1e1e1e',
    gutterForeground: '#5c5c5c',
    gutterActiveForeground: '#f0efe6',
    gutterBorder: 'transparent',
    fontFamily: MONO_FONT,
  },
  styles: [
    { tag: t.comment, color: '#7d7a72', fontStyle: 'italic' },
    { tag: [t.string, t.special(t.string), t.character], color: '#9fd3a0' },
    { tag: [t.number, t.atom, t.bool, t.unit], color: '#e0a86a' },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#e2857b' },
    { tag: [t.operator, t.punctuation, t.bracket], color: '#b0ada4' },
    { tag: [t.variableName], color: '#d4d4d4' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#c9b6f0' },
    { tag: [t.className, t.typeName], color: '#e2857b' },
    { tag: [t.propertyName], color: '#8fd3e8' },
    { tag: [t.tagName], color: '#e2857b' },
    { tag: [t.attributeName], color: '#e0a86a' },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#f0efe6', fontWeight: '600' },
    { tag: t.invalid, color: '#ff6b6b', textDecoration: 'underline' },
    { tag: t.link, color: '#8fd3e8', textDecoration: 'underline' },
    { tag: t.heading, color: '#e2857b', fontWeight: 'bold' },
    { tag: t.meta, color: '#8a877e' },
  ],
});

export function createSourbotTheme(isDarkMode: boolean): Extension {
  return isDarkMode ? darkTheme : lightTheme;
}
