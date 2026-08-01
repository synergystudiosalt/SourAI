/**
 * Notebook collection state, hydrated from and written back to IndexedDB.
 *
 * The list lives in `App` rather than inside the workspace because the sidebar
 * drawer switches between notebooks, and the workspace itself is lazily loaded
 * — the sidebar must be able to list notebooks before that chunk arrives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientPersistence, type ClientPersistence } from '../../storage/clientPersistence';
import { createNotebook, type Notebook } from './types';

const SAVE_DEBOUNCE_MS = 250;

export interface NotebooksState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  isReady: boolean;
  selectNotebook: (id: string | null) => void;
  createNewNotebook: () => Notebook;
  updateNotebook: (id: string, update: (notebook: Notebook) => Notebook) => void;
  renameNotebook: (id: string, title: string) => void;
  removeNotebook: (id: string) => void;
}

export function useNotebooks(): NotebooksState {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const persistenceRef = useRef<ClientPersistence | null>(null);
  const dirtyIdsRef = useRef(new Set<string>());
  const notebooksRef = useRef<Notebook[]>([]);

  notebooksRef.current = notebooks;

  useEffect(() => {
    let cancelled = false;
    void getClientPersistence()
      .then(async (persistence) => {
        persistenceRef.current = persistence;
        const stored = await persistence.loadNotebooks();
        if (cancelled) return;
        setNotebooks(stored);
        setIsReady(true);
      })
      .catch((error) => {
        console.error('[sour.ai] Could not load notebooks', error);
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only notebooks touched since the last flush are rewritten. Sources hold
  // the full extracted text of every document, so re-serialising the whole
  // collection on each keystroke would be the most expensive thing the app does.
  useEffect(() => {
    if (!isReady) return;
    const timer = window.setTimeout(() => {
      const persistence = persistenceRef.current;
      if (!persistence) return;
      const dirty = dirtyIdsRef.current;
      if (dirty.size === 0) return;
      const pending = [...dirty];
      dirty.clear();
      void Promise.all(
        pending
          .map((id) => notebooksRef.current.find((notebook) => notebook.id === id))
          .filter((notebook): notebook is Notebook => Boolean(notebook))
          .map((notebook) => persistence.saveNotebook(notebook))
      ).catch((error) => console.error('[sour.ai] Could not persist notebook', error));
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [notebooks, isReady]);

  const createNewNotebook = useCallback((): Notebook => {
    const notebook = createNotebook();
    dirtyIdsRef.current.add(notebook.id);
    setNotebooks((previous) => [notebook, ...previous]);
    setActiveNotebookId(notebook.id);
    return notebook;
  }, []);

  const updateNotebook = useCallback(
    (id: string, update: (notebook: Notebook) => Notebook) => {
      dirtyIdsRef.current.add(id);
      setNotebooks((previous) =>
        previous.map((notebook) =>
          notebook.id === id ? { ...update(notebook), updatedAt: Date.now() } : notebook
        )
      );
    },
    []
  );

  const renameNotebook = useCallback(
    (id: string, title: string) => {
      updateNotebook(id, (notebook) => ({ ...notebook, title: title.trim() || notebook.title }));
    },
    [updateNotebook]
  );

  const removeNotebook = useCallback((id: string) => {
    dirtyIdsRef.current.delete(id);
    setNotebooks((previous) => previous.filter((notebook) => notebook.id !== id));
    setActiveNotebookId((current) => (current === id ? null : current));
    void persistenceRef.current
      ?.deleteNotebook(id)
      .catch((error) => console.error('[sour.ai] Could not delete notebook', error));
  }, []);

  return {
    notebooks,
    activeNotebookId,
    isReady,
    selectNotebook: setActiveNotebookId,
    createNewNotebook,
    updateNotebook,
    renameNotebook,
    removeNotebook,
  };
}
