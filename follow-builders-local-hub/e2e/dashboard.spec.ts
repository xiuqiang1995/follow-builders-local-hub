import { expect, test } from '@playwright/test';

test('dashboard page renders synced content', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Builders Feed');
  await expect(page.getByRole('tab', { name: 'Builders' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '作者筛选' })).toBeVisible();
  await expect(page.locator('body')).toContainText('打开原文');
  await expect(page.locator('body')).toContainText('推文流');
});
