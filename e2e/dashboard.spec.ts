import { expect, test } from '@playwright/test';

test('dashboard page renders synced content', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('AI Builders Digest');
  await expect(page.getByRole('tab', { name: 'Builders' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Blogs' })).toBeVisible();

  await expect(page.getByRole('tab', { name: 'Digest' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('body')).toContainText('AI Builders Digest｜');
  await expect(page.locator('body')).toContainText('1）官方内容');

  await page.getByRole('tab', { name: 'Builders' }).click();
  await expect(page.getByRole('tab', { name: 'Builders' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: '作者筛选' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Builder 摘要流');

  await page.getByRole('tab', { name: 'Blogs' }).click();
  await expect(page.getByRole('tab', { name: 'Blogs' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('body')).toContainText('官方博客');

  await page.getByRole('tab', { name: 'Podcasts' }).click();
  await expect(page.getByRole('tab', { name: 'Podcasts' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('body')).toContainText('播客 remix');

  await page.getByRole('tab', { name: 'Digest' }).click();
  await expect(page.getByRole('tab', { name: 'Digest' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('body')).toContainText('结论：');
});
