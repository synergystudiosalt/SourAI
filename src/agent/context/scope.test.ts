import { describe, expect, it } from 'vitest';

import { matchesGlob } from './glob';
import { ContextScope } from './scope';

describe('matchesGlob', () => {
  it('keeps a single star inside one path segment', () => {
    expect(matchesGlob('src/*.ts', 'src/app.ts')).toBe(true);
    expect(matchesGlob('src/*.ts', 'src/nested/app.ts')).toBe(false);
  });

  it('lets a leading double star match zero directories', () => {
    expect(matchesGlob('**/.env', '.env')).toBe(true);
    expect(matchesGlob('**/.env', 'apps/web/.env')).toBe(true);
  });

  it('treats regular-expression syntax as literal text', () => {
    expect(matchesGlob('a.b', 'axb')).toBe(false);
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
    expect(matchesGlob('(x|y)', 'x')).toBe(false);
  });
});

describe('ContextScope', () => {
  const scope = ContextScope.projectDefault();

  it('allows ordinary project files', () => {
    expect(scope.allows('src/app.ts')).toBe(true);
  });

  it('refuses credential-shaped paths that configuration cannot re-enable', () => {
    for (const path of [
      '.env',
      '.env.production',
      'apps/web/.env.local',
      'deploy/id_rsa',
      'certs/server.key',
      '.git/config',
      'infra/service-account-prod.json',
    ]) {
      expect(scope.decide(path)).toMatchObject({ allowed: false, reason: 'sensitive' });
    }
  });

  it('cannot have a sensitive pattern removed through configuration', () => {
    const permissive = new ContextScope({ excludedPaths: [], noisePaths: [] });
    expect(permissive.allows('.env')).toBe(false);
  });

  it('excludes generated output by default and reports it as excluded', () => {
    expect(scope.decide('node_modules/react/index.js')).toMatchObject({
      allowed: false,
      reason: 'excluded',
    });
    expect(scope.decide('dist/bundle.js').allowed).toBe(false);
  });

  it('confines reads to the configured roots', () => {
    const limited = new ContextScope({ roots: ['src'] });
    expect(limited.allows('src/app.ts')).toBe(true);
    expect(limited.decide('docs/readme.md')).toMatchObject({
      allowed: false,
      reason: 'outside-roots',
    });
  });

  it('rejects traversal and absolute paths rather than normalizing them', () => {
    for (const path of ['../secrets.txt', '/etc/passwd', 'src/../.env', 'C:/Windows/system32']) {
      expect(scope.allows(path)).toBe(false);
    }
  });

  it('throws a policy error naming only the reason', () => {
    expect(() => scope.assertReadable('.env')).toThrowError(/credentials/i);
    try {
      scope.assertReadable('.env');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('API_KEY');
    }
  });

  it('prunes directory traversal into excluded trees', () => {
    expect(scope.allowsDirectory('src')).toBe(true);
    expect(scope.allowsDirectory('node_modules')).toBe(false);
    expect(scope.allowsDirectory('.git')).toBe(false);
  });

  it('round-trips through its structured-clone form', () => {
    const original = new ContextScope({ roots: ['src'], excludedPaths: ['src/generated/**'] });
    const restored = ContextScope.fromConfig(structuredClone(original.toConfig()));
    expect(restored.allows('src/generated/api.ts')).toBe(false);
    expect(restored.allows('src/app.ts')).toBe(true);
    expect(restored.allows('docs/x.md')).toBe(false);
  });

  it('rejects malformed configuration instead of widening the scope', () => {
    expect(() => ContextScope.fromConfig({ roots: [1] })).toThrow(TypeError);
    expect(() => ContextScope.fromConfig({ excludedPaths: 'src/**' })).toThrow(TypeError);
    expect(ContextScope.fromConfig(undefined).allows('.env')).toBe(false);
  });
});
