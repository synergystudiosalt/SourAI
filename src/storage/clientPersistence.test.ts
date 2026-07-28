import { describe, expect, it } from 'vitest';

import { ClientPersistence } from './clientPersistence';
import { InMemoryStorageDatabase } from './testing/inMemoryDatabase';

describe('ClientPersistence project context', () => {
  it('stores project memory durably and isolates it by project', async () => {
    const persistence = new ClientPersistence(new InMemoryStorageDatabase());

    await persistence.setContext('project-a', 'architecture', 'React SPA');
    await persistence.setContext('project-b', 'architecture', 'Node service');

    await expect(persistence.loadContext('project-a', 'Project A')).resolves.toEqual({
      architecture: 'React SPA',
    });
    await expect(persistence.loadContext('project-b', 'Project B')).resolves.toEqual({
      architecture: 'Node service',
    });
  });

  it('updates and removes stored project memory', async () => {
    const persistence = new ClientPersistence(new InMemoryStorageDatabase());

    await persistence.setContext('project-a', 'testing', 'Jest');
    await persistence.setContext('project-a', 'testing', 'Vitest');
    await expect(persistence.loadContext('project-a', 'Project A')).resolves.toEqual({
      testing: 'Vitest',
    });

    await persistence.removeContext('project-a', 'testing');
    await expect(persistence.loadContext('project-a', 'Project A')).resolves.toEqual({});
  });
});
