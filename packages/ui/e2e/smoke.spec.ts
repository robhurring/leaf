import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples');

// Three engines share one server and one preferences file; each test starts from the defaults.
const PREFS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.superpowers',
  'e2e-config',
  'preferences.json',
);
test.beforeEach(() => rmSync(PREFS, { force: true }));

/** Console noise that is not ours: Excalidraw's font-subsetting worker on Firefox, GitHub fetches. */
const IGNORED = [
  /raw\.githubusercontent\.com/,
  /subsetting/,
  /document is not defined/,
  /Can't find variable: document/,
];
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const keep = (text: string) => !IGNORED.some((re) => re.test(text));
  page.on('console', (m) => m.type() === 'error' && keep(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => keep(e.message) && errors.push(e.message));
  return errors;
}

test('examples render without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leaf');
  const files = page.getByRole('navigation', { name: 'Files' });
  await expect(files).toBeVisible();
  await expect(files).not.toContainText('ignored.md');
  await expect(files).toContainText('README.md');
  for (const f of [
    'gfm.md',
    'code.md',
    'headings.md',
    'inline-matchers.md',
    'links-and-images.md',
    'alerts.md',
    'math.md',
    'frontmatter.md',
    'html.md',
    'outline-and-numbering.md',
    'animations.md',
    'animations/updraft.md',
  ]) {
    await page.goto('/' + f);
    await expect(page.locator('article.leaf-doc')).toBeVisible();
    await expect(page.locator('article.leaf-doc h1')).toHaveCount(1);
  }
  await page.goto('/code.md');
  await expect(page.locator('.leaf-codeblock pre.shiki').first()).toBeVisible();
  await page.goto('/files/script.py');
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.goto('/files/blob.bin');
  await expect(page.getByRole('link', { name: /download/i })).toBeVisible();
  await page.goto('/assets/photo.jpg');
  await expect(page.locator('img.leaf-image')).toBeVisible();
  await page.goto('/assets/logo.svg');
  await expect(page.locator('img.leaf-image')).toBeVisible();
  expect(errors).toEqual([]);
});

test('outline, numbering, anchors, palette', async ({ page }) => {
  await page.goto('/outline-and-numbering.md');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Number headings' }).click();
  await expect(page.locator('article h2').first()).toContainText('1.');
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline).toContainText('3. Third section');
  await outline.getByRole('link', { name: /Third section/ }).click();
  await expect(page).toHaveURL(/#third-section$/);
  await page.keyboard.press('ControlOrMeta+K');
  await page.getByRole('combobox', { name: 'Go to' }).fill('grand');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#grandchild$/);
});

test('gutter click and shift-click select lines and set the hash', async ({ page }) => {
  await page.goto('/files/script.py');
  const gutter = page.locator('.cm-lineNumbers .cm-gutterElement');
  await gutter.filter({ hasText: /^3$/ }).click();
  await expect(page).toHaveURL(/#L3$/);
  await gutter.filter({ hasText: /^6$/ }).click({ modifiers: ['Shift'] });
  await expect(page).toHaveURL(/#L3-L6$/);
  await page.reload();
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
});

test('diagrams render, zoom into the Stage, and sticky ink survives navigation', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/diagrams.md');
  const frames = page.locator('.leaf-frame[data-viewer="mermaid"]');
  await expect(frames.first().locator('.leaf-diagram svg')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.leaf-diagram-error')).toHaveCount(1);
  await expect(
    page.locator('.leaf-frame[data-viewer="plantuml"] .leaf-block-hint').first(),
  ).toBeVisible();
  await expect(page.locator('.leaf-frame[data-viewer="excalidraw"] .leaf-diagram svg')).toBeVisible(
    {
      timeout: 15000,
    },
  );

  await frames.first().hover();
  await frames.first().getByRole('button', { name: 'Open zoomed view' }).click();
  const stage = page.getByRole('dialog', { name: 'Zoomed view' });
  await expect(stage).toBeVisible();
  await expect(stage.locator('.leaf-diagram svg').first()).toBeVisible();
  const layer = page.getByTestId('stage-layer');
  await page.getByRole('button', { name: 'Zoom in' }).last().click();
  await expect(layer).not.toHaveCSS('transform', 'none');

  await page.getByRole('button', { name: 'Pencil' }).click();
  await page.getByRole('button', { name: 'Green' }).click();
  await page.getByRole('button', { name: 'Sticky ink' }).click();
  const box = (await page.getByTestId('stage-viewport').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 240, { steps: 5 });
  await page.mouse.move(box.x + 320, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('path.leaf-ink')).toHaveCount(1);
  await expect(page.locator('path.leaf-ink-fade')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(stage).toBeHidden();
  // Navigate within the app (a reload would end the session and its ink on purpose).
  const files = page.getByRole('navigation', { name: 'Files' });
  await files.getByRole('button', { name: 'gfm.md' }).click();
  await expect(page).toHaveURL(/gfm\.md$/);
  await files.getByRole('button', { name: 'diagrams.md' }).click();
  await expect(page).toHaveURL(/diagrams\.md$/);
  await expect(frames.first().locator('.leaf-diagram svg')).toBeVisible({ timeout: 15000 });
  await frames.first().hover();
  await frames.first().getByRole('button', { name: 'Open zoomed view' }).click();
  await expect(page.locator('path.leaf-ink')).toHaveCount(1);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('diagram files open ready to pan, zoom, and draw, inside the window', async ({ page }) => {
  for (const file of ['/viewers/flow.mmd', '/viewers/sketch.excalidraw']) {
    await page.goto(file);
    const view = page.getByTestId('stage-viewport');
    await expect(view.locator('.leaf-diagram svg')).toBeVisible({ timeout: 15000 });
    const tools = page.getByRole('toolbar', { name: 'File tools' });
    await expect(tools.getByRole('button', { name: 'Hand' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Zoomed view' })).toHaveCount(0);
  }
});

test('live update', async ({ page }) => {
  const live = join(examples, 'live.md');
  writeFileSync(live, '# Live\n\nBefore.\n');
  try {
    await page.goto('/live.md');
    await expect(page.getByText('Before.')).toBeVisible();
    appendFileSync(live, '\n## Added later\n\nAfter.\n');
    await expect(page.getByText('After.')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('navigation', { name: 'Outline' })).toContainText('Added later');
  } finally {
    rmSync(live, { force: true });
  }
});

test('themes and text size are sticky', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('menuitemradio', { name: 'Card' }).click();
  await page.getByRole('button', { name: 'Larger text' }).click();
  await page.getByRole('button', { name: 'Larger text' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'card');
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('120%');
});

test('the document grows with the window', async ({ page }) => {
  // Narrow: the sidebars float over the page and the document takes the whole width.
  // A short document: the column must not shrink to its content.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/nested/deep/deeper/leaf.md');
  await expect(page.locator('article h1').first()).toBeVisible();
  const narrow = (await page.locator('.leaf-doc-col').boundingBox())!;
  expect(narrow.x).toBeLessThan(1);
  expect(narrow.width).toBeGreaterThan(990);
  // Wide, sidebars docked: the text fills the column instead of stopping at a fixed measure.
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.goto('/README.md');
  await expect(page.locator('article h1').first()).toBeVisible();
  const col = (await page.locator('.leaf-doc-col').boundingBox())!;
  const text = (await page.locator('.leaf-main-inner').boundingBox())!;
  expect(col.width).toBeGreaterThan(1500);
  expect(text.width).toBeGreaterThan(col.width - 120);
});

test('live panes run, pause, and show their errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/animations.md');
  const panes = page.locator('.leaf-live');
  await expect(panes.first()).toBeVisible();
  const torus = page.locator('.leaf-live[data-kind="three"]').first();
  await expect(async () => torus.scrollIntoViewIfNeeded({ timeout: 1000 })).toPass();
  // three.js needs WebGL; a headless engine without it must say so in the pane.
  await expect(torus).toHaveAttribute('data-state', /running|error/);
  if ((await torus.getAttribute('data-state')) === 'error')
    await expect(torus.getByRole('alert')).toContainText(/WebGL/i);
  const sine = page.locator('.leaf-live[data-kind="canvas"]').first();
  await expect(async () => sine.scrollIntoViewIfNeeded({ timeout: 1000 })).toPass();
  await expect(sine).toHaveAttribute('data-state', 'running');
  // It moves: the picture changes from one moment to the next.
  const picture = () =>
    page
      .frameLocator('.leaf-live[data-kind="canvas"] iframe')
      .first()
      .locator('canvas')
      .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const before = await picture();
  await expect.poll(picture, { timeout: 3000 }).not.toBe(before);
  await sine.hover();
  await sine.getByRole('button', { name: 'Pause' }).click();
  await expect(sine).toHaveAttribute('data-state', 'paused');
  const broken = page.locator('.leaf-live').last();
  await expect(async () => broken.scrollIntoViewIfNeeded({ timeout: 1000 })).toPass();
  await expect(broken).toHaveAttribute('data-state', 'error');
  await expect(broken.getByRole('alert')).toContainText('line 3');
  await expect(broken.getByRole('alert')).toContainText('undefinedThing');
  expect(errors).toEqual([]);
});
