import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

// Fira Code leads; the rest are fallbacks for the moment before the self-hosted
// face is parsed, and for any environment where it fails to load.
const MONO_FONT =
  "'Fira Code', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace";

const lightTheme = createTheme({
  theme: 'light',
  settings: {
    // Matches --zed-editor in light mode.
    background: '#ffffff',
    foreground: '#16181d',
    caret: '#004edb',
    selection: '#cddcf9',
    selectionMatch: '#e2ebfb',
    lineHighlight: '#eef3fbb0',
    gutterBackground: '#ffffff',
    gutterForeground: '#a3aec6',
    gutterActiveForeground: '#1b2233',
    gutterBorder: 'transparent',
    fontFamily: MONO_FONT,
  },
  styles: [
    { tag: t.comment, color: '#7e8aa8', fontStyle: 'italic' },
    { tag: [t.string, t.special(t.string), t.character], color: '#2e7d5b' },
    { tag: [t.number, t.atom, t.bool, t.unit], color: '#2f59ad' },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#7c4dbd' },
    { tag: [t.operator, t.punctuation, t.bracket], color: '#2d7d9a' },
    { tag: [t.variableName], color: '#16181d' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#3d6fd6' },
    { tag: [t.className, t.typeName], color: '#1f7a8c' },
    { tag: [t.propertyName], color: '#0f766e' },
    { tag: [t.tagName], color: '#c2405a' },
    { tag: [t.attributeName], color: '#2f59ad' },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#131a2a', fontWeight: '600' },
    { tag: t.invalid, color: '#c8372f', textDecoration: 'underline' },
    { tag: t.link, color: '#3d6fd6', textDecoration: 'underline' },
    { tag: t.heading, color: '#3d6fd6', fontWeight: 'bold' },
    { tag: t.meta, color: '#7e8aa8' },
  ],
});

const darkTheme = createTheme({
  theme: 'dark',
  settings: {
    // Matches --z-surface-raised: the editor is the lightest, focal plane and
    // the chrome around it recedes darker.
    background: '#17191f',
    foreground: '#dce0e5',
    caret: '#3b6ffa',
    selection: '#2f3644',
    selectionMatch: '#272d38',
    lineHighlight: '#23272fcc',
    gutterBackground: '#17191f',
    gutterForeground: '#5a6472',
    gutterActiveForeground: '#dce0e5',
    gutterBorder: 'transparent',
    fontFamily: MONO_FONT,
  },
  styles: [
    { tag: t.comment, color: '#565f89', fontStyle: 'italic' },
    { tag: [t.string, t.special(t.string), t.character], color: '#9ece6a' },
    { tag: [t.number, t.atom, t.bool, t.unit], color: '#6a9af9' },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#bb9af7' },
    { tag: [t.operator, t.punctuation, t.bracket], color: '#89ddff' },
    { tag: [t.variableName], color: '#dce0e5' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7aa2f7' },
    { tag: [t.className, t.typeName], color: '#2ac3de' },
    { tag: [t.propertyName], color: '#73daca' },
    { tag: [t.tagName], color: '#f7768e' },
    { tag: [t.attributeName], color: '#6b91dd' },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#dce0e5', fontWeight: '600' },
    { tag: t.invalid, color: '#ff757f', textDecoration: 'underline' },
    { tag: t.link, color: '#7aa2f7', textDecoration: 'underline' },
    { tag: t.heading, color: '#7aa2f7', fontWeight: 'bold' },
    { tag: t.meta, color: '#565f89' },
  ],
});

export function createSourbotTheme(isDarkMode: boolean): Extension {
  return isDarkMode ? darkTheme : lightTheme;
}
