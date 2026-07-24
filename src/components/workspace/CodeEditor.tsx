import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { resolveLanguageExtension } from '../../utils/languageMeta';
import { createSourbotTheme } from '../../utils/editorTheme';

interface CodeEditorProps {
  path: string;
  value: string;
  isDarkMode: boolean;
  wordWrap: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCursorChange: (info: { line: number; col: number; selectionLength: number }) => void;
}

/**
 * Thin wrapper around @uiw/react-codemirror that resolves syntax
 * highlighting for whatever language matches the active file's name
 * (via @codemirror/language-data, which covers dozens of languages) and
 * themes the editor to match sour.ai's light/dark palette.
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({
  path,
  value,
  isDarkMode,
  wordWrap,
  readOnly,
  onChange,
  onSave,
  onCursorChange,
}) => {
  const [languageExt, setLanguageExt] = useState<Extension | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  // Guards against setState calls firing after this component has
  // unmounted (e.g. a fast tab switch racing an in-flight async load, or a
  // stray CodeMirror update callback surviving past teardown). Without
  // this, React can crash inside flushPassiveEffects/commitPassiveMountOnFiber
  // when a passive effect's cleanup tries to reconcile state that no longer
  // has a live fiber - especially noticeable with Fast Refresh, which
  // remounts this component without a full page reload.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLanguageExt(null);
    resolveLanguageExtension(path).then((ext) => {
      if (!cancelled && isMountedRef.current) setLanguageExt(ext);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (!isMountedRef.current) return;
    editorRef.current?.view?.focus();
  }, [path]);

  // Keeps track of the last emitted cursor position so we never call
  // `onCursorChange` with an identical value. CodeMirror's `onStatistics`
  // can fire multiple times per keystroke; without this guard those calls
  // can trigger redundant parent re-renders that recreate `extensions`/
  // `theme` and cause CodeMirror to reconfigure itself in a tight loop.
  const lastCursorInfoRef = useRef<{ line: number; col: number; selectionLength: number } | null>(null);
  const handleStatistics = useCallback((stats: Parameters<NonNullable<React.ComponentProps<typeof CodeMirror>['onStatistics']>>[0]) => {
    if (!isMountedRef.current) return;
    const line = stats.line.number;
    const col = stats.selectionAsSingle.head - stats.line.from + 1;
    const selectionLength = Math.abs(stats.selectionAsSingle.to - stats.selectionAsSingle.from);
    const last = lastCursorInfoRef.current;
    if (last && last.line === line && last.col === col && last.selectionLength === selectionLength) return;
    lastCursorInfoRef.current = { line, col, selectionLength };
    onCursorChangeRef.current({ line, col, selectionLength });
  }, []);



  const theme = useMemo(() => createSourbotTheme(isDarkMode), [isDarkMode]);

  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current();
            return true;
          },
        },
      ]),
    []
  );

  const extensions = useMemo(() => {
    const exts: Extension[] = [saveKeymap, indentUnit.of('  ')];
    if (languageExt) exts.push(languageExt);
    if (wordWrap) exts.push(EditorView.lineWrapping);
    return exts;
  }, [languageExt, wordWrap, saveKeymap]);

  const basicSetup = useMemo(
    () => ({
      tabSize: 2,
      highlightActiveLine: true,
      foldGutter: true,
      autocompletion: true,
      bracketMatching: true,
      closeBrackets: true,
    }),
    []
  );

  return (
    <CodeMirror
      // Force a clean unmount/remount per file instead of reusing the same
      // internal EditorView instance across `path` changes. Reusing the
      // instance while `value`/`extensions` update together mid-flight is
      // what previously produced the flushPassiveEffects crash when
      // switching files quickly.
      key={path}
      ref={editorRef}
      value={value}
      onChange={onChange}
      theme={theme}
      extensions={extensions}
      basicSetup={basicSetup}
      readOnly={readOnly}
      autoFocus
      height="100%"
      onStatistics={handleStatistics}
      className="h-full w-full text-[13px]"
      style={{ height: '100%' }}
    />
  );
};
