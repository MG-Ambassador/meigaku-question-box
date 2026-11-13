import { test, expect } from '@playwright/test';

test('development gallery shows 14 previews with working filters and nested dialogs', async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const user = { sub: 'test', loginId: 'test', displayName: '運営', role: 'operator', mustChange: false };
    if (path === '/api/auth/login') return route.fulfill({ json: { token: 'a'.repeat(64), expiresAt: Date.now() + 3600000, user } });
    if (path === '/api/admin/me') return route.fulfill({ json: user });
    if (path === '/api/admin/events') return route.fulfill({ json: [{ id: 'campus', title: '確認用ルーム', date: '', open: 1, version: 1 }] });
    return route.fulfill({ json: { total: 0, filteredTotal: 0, rows: [], categories: [], sources: [], days: [], hasNext: false, favoriteRevision: 0, generatedAt: Date.now() } });
  });
  await page.goto('admin/');
  await page.getByLabel('運営ID').fill('test');
  await page.getByLabel('パスワード', { exact: true }).fill('gallery pass phrase');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'UI部品ギャラリー（開発専用）' });
  await trigger.click();
  const gallery = page.locator('.dev-gallery');
  await expect(gallery.locator(':scope > section')).toHaveCount(14);
  const filters = gallery.getByRole('radiogroup', { name: 'テーマで絞り込み' });
  await filters.getByRole('radio', { name: 'すべて', exact: true }).click();
  await filters.getByRole('radio', { name: 'すべて', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(filters.getByRole('radio', { name: '大学生活', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(gallery.locator('input[aria-invalid=true]')).toHaveAttribute('aria-describedby', 'dev-name-error');
  await expect(gallery.locator('.operator-nav')).toHaveCSS('position', 'static');
  await gallery.getByRole('button', { name: '確認ダイアログを開く' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation.getByRole('button', { name: 'キャンセル' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(gallery.getByRole('button', { name: '確認ダイアログを開く' })).toBeFocused();
  await gallery.getByRole('button', { name: /シートを開くプレビュー/ }).click();
  const nested = page.getByRole('dialog', { name: 'テスト用シート' });
  await expect(nested).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(gallery.getByRole('button', { name: /シートを開くプレビュー/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
