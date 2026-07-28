import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The Phase 4B workflow, end to end in a real browser:
 * propose → review → approve → apply → verify → reload.
 *
 * The model is a mocked OpenAI-compatible endpoint the user explicitly
 * approves, so the whole path — BYOK credential, streaming, structured tool
 * call, proposal, approval artifact, transaction, checkpoint — runs exactly as
 * it does in production, with no SourAI backend anywhere in it.
 */

const APP_ORIGIN = 'http://localhost:4173';
const PROVIDER_ENDPOINT = 'https://models.example/v1/chat/completions';
const NEW_FILE_PATH = 'generated/notes.md';

function isSourAiApiRequest(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return (
    (url.origin === APP_ORIGIN && /^\/api(?:\/|$)/.test(url.pathname)) ||
    /(^|\.)sour\.ai$/i.test(url.hostname)
  );
}

function monitorSourAiApiRequests(context: BrowserContext): string[] {
  const requests: string[] = [];
  context.on('request', (request) => {
    if (isSourAiApiRequest(request.url())) requests.push(request.url());
  });
  return requests;
}

function sse(chunks: readonly unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

const PROPOSAL_ARGUMENTS = JSON.stringify({
  summary: 'Add release notes',
  verification: ['npm test'],
  changes: [
    {
      operation: 'write_file',
      path: NEW_FILE_PATH,
      content: '# Notes\n\nFirst entry.\n',
      reason: 'The project has nowhere to record releases.',
    },
  ],
});

/** Turn one proposes a change; turn two reacts to the recorded outcome. */
async function mockProvider(page: Page): Promise<() => number> {
  let turn = 0;
  await page.route(PROVIDER_ENDPOINT, async (route) => {
    turn += 1;
    const body =
      turn === 1
        ? sse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-1',
                        function: {
                          name: 'propose_file_changes',
                          arguments: PROPOSAL_ARGUMENTS,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ])
        : sse([
            { choices: [{ delta: { content: 'The notes file is in place.' } }] },
            { usage: { prompt_tokens: 10, completion_tokens: 5 } },
          ]);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'access-control-allow-origin': '*',
      },
      body,
    });
  });
  return () => turn;
}

async function openWorkspaceWithAgent(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();
  await expect(page.getByText('untitled.txt').first()).toBeVisible();
}

async function configureProvider(page: Page): Promise<void> {
  await page.getByLabel('Model provider').selectOption('openai-compatible');
  await page.getByLabel('Custom endpoint URL').fill(PROVIDER_ENDPOINT);
  await page.getByLabel('Custom model id').fill('test-model');
  await page.getByRole('button', { name: 'Approve this destination' }).click();
  await expect(page.getByText(/Approved destination: models.example/)).toBeVisible();
  await page.getByLabel(/API key/).fill('sk-e2e-canary-value');
  await page.getByRole('button', { name: 'write' }).click();
}

test('an agent change is proposed, reviewed, applied, verified, and survives reload', async ({
  context,
  page,
}) => {
  const apiRequests = monitorSourAiApiRequests(context);
  const turns = await mockProvider(page);

  await openWorkspaceWithAgent(page);
  await configureProvider(page);

  await page.getByPlaceholder(/Message agent in write mode/).fill('Add release notes');
  await page.keyboard.press('Enter');

  // The change is proposed and waits: nothing has been written yet.
  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await expect(review).toBeVisible();
  await expect(review.getByText('Add release notes')).toBeVisible();
  await expect(review.getByText(NEW_FILE_PATH)).toBeVisible();
  await expect(review.getByText(/Nothing changes until you approve/)).toBeVisible();
  // The diff shows the content, but the workspace does not have the file yet:
  // no editor tab exists for it.
  await expect(review.getByText('+ # Notes')).toBeVisible();
  await expect(page.getByTitle(NEW_FILE_PATH)).toBeHidden();

  await review.getByRole('button', { name: /Approve/ }).click();

  // Applied, with evidence rather than a claim.
  const appliedCard = page.getByRole('region', { name: 'Applied change' });
  await expect(appliedCard).toBeVisible();
  await expect(appliedCard.getByText(NEW_FILE_PATH)).toBeVisible();
  await expect(appliedCard.getByText(/Applied content matches/)).toBeVisible();
  await expect(appliedCard.getByText(/npm test/)).toBeVisible();

  // The real workspace changed: the file is in the editor.
  await expect(page.getByText('notes.md').first()).toBeVisible();
  await expect(page.getByText('First entry.')).toBeVisible();

  // The run continued with the recorded outcome and finished.
  await expect(page.getByText('The notes file is in place.')).toBeVisible();
  expect(turns()).toBe(2);

  await page.reload();
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: 'Continue Previous Session' }).click();

  // The applied change and the thread that produced it survive a reload.
  await expect(page.getByTitle(NEW_FILE_PATH)).toBeVisible();
  await expect(page.getByText('First entry.')).toBeVisible();
  await expect(page.getByText('Add release notes').first()).toBeVisible();

  expect(apiRequests, `unexpected SourAI API requests:\n${apiRequests.join('\n')}`).toEqual([]);
});

test('a denied change never touches the workspace', async ({ page }) => {
  await mockProvider(page);
  await openWorkspaceWithAgent(page);
  await configureProvider(page);

  await page.getByPlaceholder(/Message agent in write mode/).fill('Add release notes');
  await page.keyboard.press('Enter');

  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: /Deny/ }).click();

  await expect(review).toBeHidden();
  await expect(page.getByRole('region', { name: 'Applied change' })).toBeHidden();
  await expect(page.getByText('notes.md')).toBeHidden();
});

test('the credential never reaches persisted storage', async ({ page }) => {
  await mockProvider(page);
  await openWorkspaceWithAgent(page);
  await configureProvider(page);

  await page.getByPlaceholder(/Message agent in write mode/).fill('Add release notes');
  await page.keyboard.press('Enter');
  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: /Approve/ }).click();
  await expect(page.getByRole('region', { name: 'Applied change' })).toBeVisible();

  const leaked = await page.evaluate(async () => {
    const canary = 'sk-e2e-canary-value';
    const local = Object.entries(localStorage).map(([key, value]) => `${key}:${value}`);
    if (local.some((entry) => entry.includes(canary))) return 'localStorage';

    const databases = await indexedDB.databases?.();
    for (const info of databases ?? []) {
      if (!info.name) continue;
      const contents = await new Promise<string>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onerror = () => resolve('');
        request.onsuccess = () => {
          const database = request.result;
          const stores = [...database.objectStoreNames];
          if (stores.length === 0) {
            database.close();
            resolve('');
            return;
          }
          const transaction = database.transaction(stores, 'readonly');
          const collected: unknown[] = [];
          let remaining = stores.length;
          for (const store of stores) {
            const all = transaction.objectStore(store).getAll();
            all.onsuccess = () => {
              collected.push(all.result);
              if (--remaining === 0) {
                database.close();
                resolve(JSON.stringify(collected));
              }
            };
            all.onerror = () => {
              if (--remaining === 0) {
                database.close();
                resolve(JSON.stringify(collected));
              }
            };
          }
        };
      });
      if (contents.includes(canary)) return `indexedDB:${info.name}`;
    }
    return 'none';
  });

  expect(leaked).toBe('none');
});
