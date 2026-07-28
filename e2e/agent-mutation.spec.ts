import { expect, test, type Page } from '@playwright/test';

const NEW_FILE_PATH = 'generated/notes.md';
const AGENT_TEXT =
  'Added release notes.\n\n```md path="generated/notes.md"\n# Notes\n\nFirst entry.\n```';

function stream(text: string): string {
  return [
    `data: ${JSON.stringify({ token: 'Added release notes.' })}`,
    '',
    `data: ${JSON.stringify({
      done: true,
      text,
      thinking: 'Prepared a scoped workspace edit.',
      thinkingLabel: 'Preparing edit',
    })}`,
    '',
  ].join('\n');
}

async function mockPagesAgent(page: Page): Promise<string[]> {
  const payloads: string[] = [];
  await page.route('**/api/agent', async (route) => {
    payloads.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: stream(AGENT_TEXT),
    });
  });
  return payloads;
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: /New File/ }).click();
  await expect(page.getByText('untitled.txt').first()).toBeVisible();
}

async function requestChange(page: Page): Promise<void> {
  await page
    .getByPlaceholder('Message Agent, @ for context, / for commands')
    .fill('Add release notes');
  await page.keyboard.press('Enter');
}

test('a Pages-backed agent change is reviewed, applied, and survives reload', async ({ page }) => {
  await mockPagesAgent(page);
  await openWorkspace(page);

  await expect(page.getByText('Omni-Flash')).toBeVisible();
  await expect(page.getByLabel(/API key/i)).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await requestChange(page);

  await expect(page.getByText('notes.md').first()).toBeVisible();
  await expect(page.getByText('First entry.')).toBeVisible();

  await page.reload();
  await page.getByTitle('sour.ai IDE').click();
  await page.getByRole('button', { name: 'Continue Previous Session' }).click();
  await expect(page.getByTitle(NEW_FILE_PATH)).toBeVisible();
  await expect(page.getByText('First entry.')).toBeVisible();
});

test('a denied agent change never touches the workspace', async ({ page }) => {
  await mockPagesAgent(page);
  await openWorkspace(page);

  page.once('dialog', (dialog) => dialog.dismiss());
  await requestChange(page);

  await expect(page.getByText('Added release notes.')).toBeVisible();
  await expect(page.getByTitle(NEW_FILE_PATH)).toHaveCount(0);
});

test('the browser sends model choice but never an API key', async ({ page }) => {
  const payloads = await mockPagesAgent(page);
  await openWorkspace(page);

  page.once('dialog', (dialog) => dialog.dismiss());
  await requestChange(page);
  await expect(page.getByText('Added release notes.')).toBeVisible();

  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toContain('"model":"sour-omni-flash"');
  expect(payloads[0]).not.toMatch(/api[_-]?key|sk-e2e|bearer/i);
  await expect(page.getByLabel(/API key/i)).toHaveCount(0);
});
