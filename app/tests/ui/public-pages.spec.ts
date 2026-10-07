import { test, expect } from '@playwright/test';

test('Pages menu opens the planned observability page', async ({ page }) => {
  await page.goto('http://127.0.0.1:9018/landing/index.html');
  const pages = page.getByRole('combobox', { name: 'Pages' });
  await expect(pages.locator('option', { hasText: 'Observability' })).toHaveCount(1);
  await pages.selectOption({ label: 'Observability' });
  await expect(page).toHaveURL(/\/landing\/observability\.html$/);
  await expect(page.getByRole('heading', { name: 'A wider view of the work.' })).toBeVisible();
  await expect(page.getByText('Engineering observability / proposed direction')).toBeVisible();
  await expect(page.getByText(/Private local chats remain private/)).toBeVisible();
  await page.screenshot({ path: '../output/playwright/observability-page.png', fullPage: true });
  const mobile = await page.context().newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto('http://127.0.0.1:9018/landing/observability.html');
  await expect(mobile.locator('[data-project-header]')).toHaveCount(1);
  await expect(mobile.getByRole('heading', { name: 'A wider view of the work.' })).toBeVisible();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.screenshot({ path: '../output/playwright/observability-page-mobile.png' });
  await mobile.close();
});

test('Imagery menu shows the two-room cup-and-string illustration', async ({ page }) => {
  await page.goto('http://127.0.0.1:9018/imagery/index.html#string-cup');
  await expect(page.getByRole('heading', { name: 'Across the string' })).toBeVisible();
  const image = page.getByRole('img', { name: /two blue children.*separate rooms/i });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('naturalWidth', 1672);
  await expect(page.getByRole('link', { name: 'Prompt' })).toHaveAttribute('href', /cup-and-string\.txt$/);
  await page.screenshot({ path: '../output/playwright/cup-and-string-panel.png', fullPage: true });
});

test('Imagery menu also shows the observability illustration', async ({ page }) => {
  await page.goto('http://127.0.0.1:9018/imagery/index.html#observability');
  await expect(page.getByRole('heading', { name: 'Observability' })).toBeVisible();
  const image = page.getByRole('img', { name: /telescopic spectacles/i });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('naturalWidth', 1448);
  await expect(page.getByRole('link', { name: 'Prompt' })).toHaveAttribute('href', /observability\.txt$/);
  await page.screenshot({ path: '../output/playwright/observability-art-panel.png', fullPage: true });
});
