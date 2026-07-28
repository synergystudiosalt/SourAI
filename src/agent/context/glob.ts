/**
 * A deliberately small path matcher.
 *
 * Only `*`, `**`, and `?` are supported. Everything else is treated as a
 * literal so an exclusion pattern can never widen into an unintended regular
 * expression, and a hostile pattern cannot backtrack catastrophically: every
 * generated quantifier is applied to a character class, never to a group.
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;
export const MAX_GLOB_LENGTH = 256;

export function compileGlob(pattern: string): RegExp {
  if (pattern.length > MAX_GLOB_LENGTH) {
    throw new TypeError(`Glob pattern exceeds ${MAX_GLOB_LENGTH} characters.`);
  }
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index++;
        // `**/` also matches zero directories so `**/.env` matches `.env`.
        if (pattern[index + 1] === '/') {
          index++;
          source += '(?:[^/]+/)*';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += character.replace(SPECIAL, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Matches a project-relative path against a glob pattern. */
export function matchesGlob(pattern: string, path: string): boolean {
  return compileGlob(pattern).test(path);
}
