import type { WorkspaceFileNode } from '../../types';
import { createFileNode, createFolderNode, sortNodes } from '../../utils/workspaceFs';

/**
 * Project fixtures.
 *
 * `buildTree` takes a flat path → content map, which is how every other layer
 * (OPFS manifests, checkpoints, snapshots, Git status) represents a project.
 * Keeping one flat representation means a fixture can be handed to the virtual
 * tree, to the local-folder fake, and to a future OPFS adapter unchanged.
 */

export function buildTree(files: Record<string, string>): WorkspaceFileNode[] {
  const root: WorkspaceFileNode[] = [];

  const insert = (path: string, content: string) => {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return;
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      let folder = level.find((node) => node.path === dirPath && node.type === 'folder');
      if (!folder) {
        folder = createFolderNode(dirPath, []);
        level.push(folder);
      }
      folder.children ??= [];
      level = folder.children;
    }
    level.push(createFileNode(path, content));
  };

  for (const [path, content] of Object.entries(files)) insert(path, content);

  const sortDeep = (nodes: WorkspaceFileNode[]): WorkspaceFileNode[] =>
    sortNodes(nodes).map((node) => (node.children ? { ...node, children: sortDeep(node.children) } : node));

  return sortDeep(root);
}

/** A small but structurally realistic React + TypeScript project. */
export const REACT_PROJECT_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo', private: true, version: '0.0.0' }, null, 2),
  'README.md': '# Demo\n\nA fixture project.\n',
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
  'src/App.tsx': "import { Header } from './components/Header';\n\nexport default function App() {\n  return <Header title=\"Demo\" />;\n}\n",
  'src/components/Header.tsx': "export function Header({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}\n",
  'src/components/Sidebar.tsx': "import { Header } from './Header';\n\nexport function Sidebar() {\n  return <aside><Header title=\"Nav\" /></aside>;\n}\n",
  'src/utils/format.ts': 'export const format = (value: number): string => value.toFixed(2);\n',
  'src/styles/main.css': 'body {\n  margin: 0;\n}\n',
};

export function reactProjectTree(): WorkspaceFileNode[] {
  return buildTree(REACT_PROJECT_FILES);
}

/**
 * Paths that attempt to leave the project root.
 *
 * Every one of these is rejected today, but by the *browser*, not by the app:
 * the File System Access API refuses `.`, `..`, and separators inside a single
 * name segment. That backstop is real and worth asserting, but it is not a
 * substitute for canonical validation in the app — see
 * `SILENTLY_ACCEPTED_UNSAFE_PATHS`.
 */
export const ESCAPING_PATHS: readonly string[] = [
  '../outside.txt',
  '../../etc/passwd',
  'src/../../escape.txt',
  'src/./../../escape.txt',
  './../escape.txt',
  'src/sub/../../../escape.txt',
  'src\\..\\..\\escape.txt',
  'C:\\Windows\\System32\\drivers\\etc\\hosts',
];

/**
 * Malformed paths the browser does NOT reject and the app does not validate.
 *
 * These do not escape the root, but they are accepted silently and produce a
 * file the caller did not ask for. Phase 2 must reject them at the path-safety
 * layer before the handle call is made.
 */
export const SILENTLY_ACCEPTED_UNSAFE_PATHS: readonly { path: string; writtenAs: string; why: string }[] = [
  {
    path: '/absolute/path.txt',
    writtenAs: 'absolute/path.txt',
    why: 'A leading slash is stripped, so an absolute path is silently reinterpreted as project-relative.',
  },
  {
    path: 'src/\u0000nullbyte.txt',
    writtenAs: 'src/\u0000nullbyte.txt',
    why: 'A NUL byte in a name is not rejected, and creating the parent directory is a visible side effect.',
  },
];

/** Every unsafe path, for callers that just need the full list. */
export const UNSAFE_PATHS: readonly string[] = [
  ...ESCAPING_PATHS,
  ...SILENTLY_ACCEPTED_UNSAFE_PATHS.map((entry) => entry.path),
];
