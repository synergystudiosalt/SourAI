import { redactString } from '../../security/redaction';

export const MAX_PROJECT_MEMORY_ENTRIES = 32;
export const MAX_PROJECT_MEMORY_VALUE_CHARS = 1200;
export const MAX_PROJECT_MEMORY_PROMPT_CHARS = 6000;

export interface ProjectMemoryEntry {
  key: string;
  value: string;
}

const IMPORTANT_KEYS = [
  'architecture',
  'conventions',
  'commands',
  'dependencies',
  'testing',
  'api',
  'schema',
  'decisions',
];

export function normalizeProjectMemoryEntry(
  rawKey: string,
  rawValue: string
): ProjectMemoryEntry | null {
  const key = rawKey
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64);
  const value = redactString(rawValue)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROJECT_MEMORY_VALUE_CHARS);
  if (!key || !value) return null;
  return { key, value };
}

function queryTerms(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9._-]+/)
      .filter((term) => term.length >= 3)
  );
}

/**
 * Selects the most relevant durable memories for a run within a strict prompt
 * budget. Memory is reference data, never executable instructions.
 */
export function selectProjectMemory(
  memory: Record<string, string>,
  query: string
): ProjectMemoryEntry[] {
  const terms = queryTerms(query);
  const ranked = Object.entries(memory)
    .map(([key, value]) => normalizeProjectMemoryEntry(key, value))
    .filter((entry): entry is ProjectMemoryEntry => Boolean(entry))
    .map((entry) => {
      const haystack = `${entry.key} ${entry.value}`.toLowerCase();
      const relevance = [...terms].reduce(
        (score, term) => score + (haystack.includes(term) ? 3 : 0),
        0
      );
      const importance = IMPORTANT_KEYS.reduce(
        (score, important, index) =>
          score + (entry.key.includes(important) ? IMPORTANT_KEYS.length - index : 0),
        0
      );
      return { entry, score: relevance + importance };
    })
    .sort((left, right) => right.score - left.score || left.entry.key.localeCompare(right.entry.key));

  const selected: ProjectMemoryEntry[] = [];
  let characters = 0;
  for (const { entry } of ranked) {
    if (selected.length >= MAX_PROJECT_MEMORY_ENTRIES) break;
    const cost = entry.key.length + entry.value.length + 4;
    if (characters + cost > MAX_PROJECT_MEMORY_PROMPT_CHARS) continue;
    selected.push(entry);
    characters += cost;
  }
  return selected;
}

