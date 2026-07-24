import { LanguageDescription } from '@codemirror/language';
import { languages as CM_LANGUAGES } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import {
  FileCode, FileJson, FileText, File as FileIcon, Palette, Settings2,
  Database, Terminal, Braces, Image, Coffee, type LucideIcon,
} from 'lucide-react';

const languageExtensionCache = new Map<string, Promise<Extension | null>>();

/** Lazily resolves (and caches) the CodeMirror language extension for a filename. */
export function resolveLanguageExtension(filename: string): Promise<Extension | null> {
  const cached = languageExtensionCache.get(filename);
  if (cached) return cached;
  const desc = LanguageDescription.matchFilename(CM_LANGUAGES, filename);
  const promise = desc
    ? desc.load().then((support) => support as unknown as Extension).catch(() => null)
    : Promise.resolve(null);
  languageExtensionCache.set(filename, promise);
  return promise;
}

/** Human readable language name for the status bar, e.g. "TypeScript". */
export function getLanguageName(filename: string): string {
  if (!filename) return 'Plain Text';
  const desc = LanguageDescription.matchFilename(CM_LANGUAGES, filename);
  return desc?.name || 'Plain Text';
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'avif',
  'pdf', 'zip', 'gz', 'tar', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav', 'ogg', 'flac',
  'class', 'jar', 'wasm', 'db', 'sqlite', 'node', 'pyc', 'o', 'a', 'lib',
]);

export function isLikelyBinary(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

interface IconRule {
  test: RegExp;
  icon: LucideIcon;
  className: string;
}

const ICON_RULES: IconRule[] = [
  { test: /\.(html?|vue|svelte)$/i, icon: FileCode, className: 'text-orange-500' },
  { test: /\.(css|scss|sass|less)$/i, icon: Palette, className: 'text-blue-500' },
  { test: /\.tsx?$/i, icon: FileCode, className: 'text-blue-600' },
  { test: /\.(jsx?|mjs|cjs)$/i, icon: FileCode, className: 'text-yellow-500' },
  { test: /\.(json|jsonc|json5)$/i, icon: FileJson, className: 'text-amber-600' },
  { test: /\.(ya?ml|toml|ini|cfg|conf|env.*)$/i, icon: Settings2, className: 'text-stone-500' },
  { test: /\.(md|mdx|markdown|txt|rst)$/i, icon: FileText, className: 'text-stone-400' },
  { test: /\.(py|pyw)$/i, icon: FileCode, className: 'text-emerald-600' },
  { test: /\.(java|kt|kts|scala|groovy)$/i, icon: Coffee, className: 'text-red-500' },
  { test: /\.(c|h|cpp|cc|cxx|hpp|h\+\+)$/i, icon: FileCode, className: 'text-indigo-500' },
  { test: /\.cs$/i, icon: FileCode, className: 'text-purple-600' },
  { test: /\.go$/i, icon: FileCode, className: 'text-cyan-600' },
  { test: /\.rs$/i, icon: FileCode, className: 'text-orange-700' },
  { test: /\.rb$/i, icon: FileCode, className: 'text-rose-600' },
  { test: /\.php\d?$/i, icon: FileCode, className: 'text-violet-600' },
  { test: /\.sql$/i, icon: Database, className: 'text-sky-600' },
  { test: /\.(sh|bash|zsh|ps1|bat|cmd)$/i, icon: Terminal, className: 'text-stone-500' },
  { test: /\.(xml|svg|xsl|xsd)$/i, icon: Braces, className: 'text-lime-600' },
  { test: /\.(png|jpe?g|gif|webp|ico|bmp|avif)$/i, icon: Image, className: 'text-pink-500' },
  { test: /^dockerfile$/i, icon: Settings2, className: 'text-blue-400' },
];

export function getFileIconMeta(name: string): { icon: LucideIcon; className: string } {
  for (const rule of ICON_RULES) {
    if (rule.test.test(name)) return { icon: rule.icon, className: rule.className };
  }
  return { icon: FileIcon, className: 'text-stone-400' };
}
