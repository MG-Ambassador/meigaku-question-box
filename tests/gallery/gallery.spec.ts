import { test, expect } from '@playwright/test';

test('development gallery shows 13 previews with working filters and nested dialogs', async ({ page }) => {
  await page.addInitScript(() => {
    let callback: (response: { credential: string }) => void;
    window.google = { accounts: { id: {
      initialize: options => { callback = options.callback; },
      renderButton: parent => { const button = document.createElement('button'); button.textContent = '検証ログイン'; button.onclick = () => callback({ credential: 'test-token' }); parent.replaceChildren(button); },
      disableAutoSelect: () => {},
    } } };
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/me') return route.fulfill({ json: { sub: 'test', displayName: '運営' } });
    if (path === '/api/admin/events') return route.fulfill({ json: [{ id: 'campus', title: '確認用ルーム', date: '', open: 1, version: 1 }] });
    return route.fulfill({ json: { total: 0, filteredTotal: 0, rows: [], categories: [], sources: [], days: [], hasNext: false, favoriteRevision: 0, generatedAt: Date.now() } });
  });
  await page.goto('admin/');
  await page.getByRole('button', { name: '検証ログイン' }).click();
  const trigger = page.getByRole('button', { name: 'UI部品ギャラリー（開発専用）' });
  await trigger.click();
  const gallery = page.locator('.dev-gallery');
  await expect(gallery.locator(':scope > section')).toHaveCount(13);
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
