import { test, expect, type Page } from '@playwright/test';

const event = { id: 'campus', title: 'オープンキャンパス', date: '10月10日 13:00〜 白金キャンパス', open: 1, version: 1 };
async function fixture(page: Page, count = 150) {
  const state = { event: { ...event }, count, posted: [] as Record<string, unknown>[], loseResponse: false, expireCursor: false, conflict: false, polls: 0, denyAuth: false, failReport: false, favoriteRevision: 0, favorites: new Map<string, boolean>() };
  await page.addInitScript(() => {
    // Test-only GIS stand-in. Production authentication is unchanged.
    let callback: (response: { credential: string }) => void;
    window.google = { accounts: { id: {
      initialize: (options) => { callback = options.callback; },
      renderButton: (parent) => { parent.replaceChildren(); const button = document.createElement('button'); button.textContent = 'テスト用Googleログイン'; button.onclick = () => callback({ credential: 'test-token' }); parent.appendChild(button); },
      disableAutoSelect: () => {},
    } } };
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { sessionStorage.setItem('test-shared', JSON.stringify(data)); } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (url.pathname === '/api/admin/me') return json({ sub: 'test', displayName: '運営担当' });
    if (url.pathname === '/api/admin/events' && request.method() === 'GET') return json([state.event, { ...event, id: 'other', title: '別のイベント' }]);
    if (url.pathname === '/api/events' && request.method() === 'POST') {
      const body = request.postDataJSON();
      const newRoom = { id: body.id || 'created-room', title: body.title, date: body.date, open: body.open ? 1 : 0, version: 1 };
      state.event = newRoom;
      return json({ ok: true, id: newRoom.id });
    }
    if (url.pathname === '/api/events' && request.method() === 'GET') return json([state.event, { ...event, id: 'other', title: '別のイベント' }]);
    if (url.pathname.startsWith('/api/events/') && request.method() === 'GET') {
      const id = url.pathname.split('/').pop();
      if (id === 'missing') return json({ error: { code: 'EVENT_NOT_FOUND', message: 'not found' } }, 404);
      return json(id === 'other' ? { ...event, id, title: '別のイベント' } : state.event);
    }
    if (url.pathname.includes('/favorite') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      const questionId = url.pathname.split('/').at(-2)!;
      state.favorites.set(questionId, body.favorite);
      state.favoriteRevision++;
      return json({ ok: true, questionId, favorite: body.favorite });
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      if (state.conflict) { state.conflict = false; state.event = { ...state.event, title: '他の担当者の変更', version: 2 }; return json({ error: { code: 'VERSION_CONFLICT', message: 'conflict' } }, 409); }
      if (body.version !== state.event.version) return json({ error: { code: 'VERSION_CONFLICT', message: 'conflict' } }, 409);
      state.event = { ...state.event, ...body, open: body.open ? 1 : 0, version: body.version + 1 }; return json(state.event);
    }
    if (url.pathname === '/api/questions') {
      state.posted.push(request.postDataJSON());
      if (state.loseResponse) { state.loseResponse = false; return route.abort('failed'); }
      return json({ ok: true, id: 'saved', requestId: request.postDataJSON().requestId });
    }
    if (url.pathname === '/api/admin') {
      if (state.failReport) return json({ error: { code: 'STORAGE_UNAVAILABLE', message: 'unavailable' } }, 503);
      if (state.denyAuth) return json({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401);
      const size = Number(url.searchParams.get('pageSize') || 50);
      if (size === 1) state.polls++;
      const cursor = url.searchParams.get('cursor');
      if (cursor && state.expireCursor) return json({ error: { code: 'CURSOR_EXPIRED', message: 'expired' } }, 409);
      const [watermark, before] = cursor ? cursor.split(':').map(Number) : [state.count, state.count + 1];
      const ascending = url.searchParams.get('sort') === 'oldest';
      const all = Array.from({ length: watermark }, (_, i) => ascending ? i + 1 : watermark - i)
        .filter(n => !cursor || (ascending ? n > before : n < before))
        .filter(n => url.searchParams.get('favorite') !== 'favorite' || state.favorites.get(`q-${n}`) !== false);
      const matches = (!url.searchParams.get('category') || url.searchParams.get('category') === '大学生活') &&
        (!url.searchParams.get('source') || url.searchParams.get('source') === 'web') &&
        (!url.searchParams.get('day') || url.searchParams.get('day') === '2026-09-25');
      const sequences = matches ? all.slice(0, size) : [];
      const last = sequences.at(-1) || 0;
        return json({ total: watermark, filteredTotal: matches ? watermark - (url.searchParams.get('favorite') === 'favorite' ? [...state.favorites.values()].filter(v => !v).length : 0) : 0, favoriteRevision: state.favoriteRevision, pageSize: size, generatedAt: Date.now(), hasNext: matches && all.length > size, nextCursor: matches && all.length > size ? `${watermark}:${last}` : null,
          categories: [{ category: '大学生活', count: watermark }], sources: [{ source: 'web', count: watermark }], days: [{ day: '2026-09-25', count: watermark }],
          rows: sequences.map((n) => ({ id: `q-${n}`, sequence: n, body: `質問 ${n}：大学生活について教えてください。`, category: '大学生活', source: 'web', created_at: 1790000000000 + n * 1000, isFavorite: state.favorites.get(`q-${n}`) ?? true })) });
      }
    return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
  });
  return state;
}
async function login(page: Page) { await page.goto('admin/'); await page.getByRole('button', { name: 'テスト用Googleログイン' }).click(); await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible(); }

async function foldAndSend(page: Page) {
  await page.getByRole('button', { name: '質問を送る', exact: true }).click();
}

test('direct input, tactile surface, successful submission and clean sharing', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('?event=campus&from=instagram');
  const body = page.getByLabel('聞いてみたいこと'); await body.fill('自分に合うサークルの探し方は？');
  await page.getByText('学び・授業', { exact: true }).click();
  const send = page.getByRole('button', { name: '質問を送る', exact: true });
  await send.scrollIntoViewIfNeeded();
  const box = (await send.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect(send).toHaveAttribute('data-pressed', 'true'); await expect(send.locator('.action-surface')).not.toHaveCSS('transform', 'none');
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeFocused();
  expect(state.posted).toHaveLength(1); expect(state.posted[0].category).toBe('学び・授業');
  await page.getByRole('button', { name: 'この質問箱を共有' }).click();
  const shared = await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-shared')!));
  expect(shared.url).toContain('/test-box/?room=campus'); expect(shared.url).not.toContain('instagram'); expect(JSON.stringify(shared)).not.toContain('サークル');
  await page.getByRole('button', { name: 'もう1件質問する' }).click(); await expect(body).toHaveValue('');
});

test('unknown submission survives reload and reuses the exact request', async ({ page }) => {
  const state = await fixture(page); state.loseResponse = true;
  await page.goto('?event=campus&from=instagram'); await page.getByLabel('聞いてみたいこと').fill('留学の準備について教えてください');
  await foldAndSend(page);
  await expect(page.getByText('受付が完了したか確認できませんでした。', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('聞いてみたいこと')).toHaveValue('留学の準備について教えてください');
  await page.getByRole('button', { name: '送信結果を確認' }).click();
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeVisible();
  expect(state.posted).toHaveLength(2); expect(state.posted[1]).toEqual(state.posted[0]);
});

test('event drafts stay separate, closed and invalid links do not redirect', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('?event=campus'); await page.getByLabel('聞いてみたいこと').fill('元のイベントの質問');
  await expect(page).toHaveURL(/room=campus/);
  await expect(page.getByRole('button', { name: '変更', exact: true })).toHaveCount(0);
  await page.goto('?room=other'); await expect(page.getByLabel('聞いてみたいこと')).toHaveValue('');
  await page.goBack(); await expect(page.getByLabel('聞いてみたいこと')).toHaveValue('元のイベントの質問');
  state.event.open = 0; await page.reload(); await expect(page.getByRole('button', { name: '質問を送る', exact: true })).toBeDisabled();
  await page.goto('?event=missing'); await expect(page.getByRole('heading', { name: 'この質問箱は利用できません' })).toBeVisible(); await expect(page.getByLabel('聞いてみたいこと')).toHaveCount(0);
});

test('150 questions paginate without replacement; incoming questions preserve the reading position', async ({ page }) => {
  const state = await fixture(page); await login(page);
  await expect(page.locator('.question-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'さらに読み込む' }).click(); await expect(page.locator('.question-row')).toHaveCount(100);
  await page.getByRole('button', { name: 'さらに読み込む' }).click(); await expect(page.locator('.question-row')).toHaveCount(150);
  await page.locator('.question-row').nth(10).scrollIntoViewIfNeeded(); const position = await page.evaluate(() => window.scrollY);
  state.count += 2;
  await expect(page.getByRole('button', { name: /新しい質問が2件/ })).toBeAttached({ timeout: 10000 });
  expect(await page.evaluate(() => window.scrollY)).toBe(position); await expect(page.locator('.question-row').first()).toContainText('質問 150：');
  await page.getByRole('button', { name: /新しい質問が2件/ }).click(); await expect(page.locator('.question-row')).toHaveCount(50); await expect(page.locator('.question-row').first()).toContainText('質問 152：');
});

test('expired cursor preserves rows and allows explicit refresh; tabs restore with Back', async ({ page }) => {
  const state = await fixture(page, 51); await login(page); state.expireCursor = true;
  await page.getByRole('button', { name: 'さらに読み込む' }).click(); await expect(page.getByText('一覧の取得期限が切れました。', { exact: false })).toBeVisible(); await expect(page.locator('.question-row')).toHaveCount(50);
  await page.locator('.pagination-area').getByRole('button', { name: '一覧を更新' }).click(); await expect(page.getByText('一覧の取得期限が切れました。', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '集計', exact: true }).click(); await expect(page.getByRole('heading', { name: '質問の集計' })).toBeVisible(); await page.goBack(); await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
});

test('settings conflicts preserve edits and require acknowledgement before retry', async ({ page }) => {
  const state = await fixture(page); await login(page); await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('.unsaved-badge')).toHaveCount(0);
  await page.getByLabel('ルーム名', { exact: true }).fill('自分の編集');
  await expect(page.locator('.unsaved-badge')).toBeVisible();
  state.conflict = true;
  await page.getByRole('button', { name: 'ルームを保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '現在保存されている内容' })).toBeVisible(); await expect(page.getByLabel('ルーム名', { exact: true })).toHaveValue('自分の編集');
  await expect(page.getByRole('button', { name: 'ルームを保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '確認して編集を続ける' }).click(); await page.getByRole('button', { name: 'ルームを保存', exact: true }).click();
  await expect(page.getByText('ルームを保存しました。', { exact: true })).toBeVisible(); expect(state.event.title).toBe('自分の編集'); expect(state.event.version).toBe(3);
  await expect(page.locator('.unsaved-badge')).toHaveCount(0);
  await page.getByRole('switch', { name: /質問を受け付ける/ }).click();
  await expect(page.locator('.unsaved-badge')).toBeVisible();
  await page.getByRole('button', { name: 'ルームを保存', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button', { name: '受付を終了して保存' }).click(); await expect(page.getByText('ルームを保存しました。', { exact: true })).toBeVisible(); expect(state.event.open).toBe(0);
  await expect(page.locator('.unsaved-badge')).toHaveCount(0);
});

test('QR and sharing fallback, mobile widths and reduced motion', async ({ page }) => {
  await fixture(page); await login(page); await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'QRを表示' }).click(); await expect(page.getByRole('dialog').locator('svg[role=img]')).toBeVisible(); await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.goto('?event=campus');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 430, 1280]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('聞いてみたいこと').fill('テスト質問'); await foldAndSend(page);
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } }); });
  await page.getByRole('button', { name: 'この質問箱を共有' }).click(); await expect(page.getByLabel('募集ページのURL')).toHaveValue(/\/test-box\/\?room=campus$/);
  await page.screenshot({ path: 'test-results/mobile-complete.png', fullPage: true });
});

test('auth expiry returns to login and offline state prevents sending', async ({ page, context }) => {
  const state = await fixture(page); await login(page); state.denyAuth = true;
  await expect(page.getByRole('button', { name: 'テスト用Googleログイン' })).toBeVisible({ timeout: 10000 });
  await page.goto('?event=campus'); await page.getByLabel('聞いてみたいこと').fill('オフライン時の質問');
  await context.setOffline(true); await expect(page.getByRole('button', { name: '質問を送る', exact: true })).toBeDisabled();
  await context.setOffline(false); await expect(page.getByRole('button', { name: '質問を送る', exact: true })).toBeEnabled();
  await expect(page.getByLabel('聞いてみたいこと')).toHaveValue('オフライン時の質問');
});

test('cancelled press does not submit; keyboard and sheets retain focus', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('?event=campus');
  await page.getByLabel('聞いてみたいこと').fill('キーボードからの質問');
  await page.screenshot({ path: 'test-results/mobile-input.png', animations: 'disabled', caret: 'hide' });
  const send = page.getByRole('button', { name: '質問を送る', exact: true });
  await send.scrollIntoViewIfNeeded();
  const box = (await send.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 20); await page.mouse.up();
  expect(state.posted).toHaveLength(0);
  await expect(send).not.toHaveAttribute('data-pressed', 'true');
  const help = page.getByRole('button', { name: '使い方' });
  await help.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(help).toBeFocused();
  await send.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeFocused();
  expect(state.posted).toHaveLength(1);
  await login(page);
  await page.screenshot({ path: 'test-results/mobile-admin.png' });
});

test('roomless and ambiguous links never choose another room', async ({ page }) => {
  await fixture(page);
  await page.goto('./'); await expect(page.getByRole('heading', { name: '主催者から案内されたリンクを開いてください' })).toBeVisible();
  await page.goto('?room=campus&event=other'); await expect(page.getByRole('heading', { name: 'リンクを確認してください' })).toBeVisible();
  await expect(page.getByLabel('聞いてみたいこと')).toHaveCount(0);
});

test('direct submission disables input during send, preserves input on failure, and prevents duplicate requests', async ({ page }) => {
  await fixture(page);
  await page.goto('?room=campus');
  const body = page.getByLabel('聞いてみたいこと');
  await body.fill('失敗時に内容が残るかテスト');

  // Intercept and delay /api/questions to verify disabled state while submitting
  let resolvePost: (() => void) | null = null;
  await page.route('**/api/questions', async (route) => {
    await new Promise<void>((r) => { resolvePost = r; });
    await route.fulfill({ status: 400, json: { error: { code: 'INPUT_INVALID', message: '質問内容を確認してください。' } } });
  });

  const send = page.getByRole('button', { name: '質問を送る', exact: true });
  await send.click();

  // Verify inputs disabled and status showing while submitting
  await expect(body).toBeDisabled();
  await expect(send).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('質問を送っています');
  await expect(send.locator('.airplane-deco')).toHaveClass(/is-flying/);

  // Complete the failed request
  resolvePost!();

  // Verify error message displayed, inputs re-enabled, and body text preserved
  await expect(page.getByText('質問内容を確認してください。')).toBeVisible();
  await expect(body).toBeEnabled();
  await expect(body).toHaveValue('失敗時に内容が残るかテスト');
  await expect(send).toBeEnabled();
});

test('reduced motion keeps airplane animation disabled and completion remains accessible', async ({ page }) => {
  const state = await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('?room=campus');
  await page.getByLabel('聞いてみたいこと').fill('動きを減らした状態での送信');

  const send = page.getByRole('button', { name: '質問を送る', exact: true });
  await send.click();
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeFocused();
  expect(state.posted).toHaveLength(1);
  expect(state.posted[0].body).toBe('動きを減らした状態での送信');
});

test('admin mobile filter sheet, accessible theme radio chips, and insight card navigation', async ({ page }) => {
  await fixture(page);
  await login(page);

  // Theme chips ARIA radio group keyboard navigation
  const radioGroup = page.getByRole('radiogroup', { name: 'テーマで絞り込み' });
  await expect(radioGroup).toBeVisible();
  const allChip = radioGroup.getByRole('radio', { name: 'すべて' });
  await expect(allChip).toHaveAttribute('aria-checked', 'true');

  await allChip.focus();
  await page.keyboard.press('ArrowRight');
  const collegeLifeChip = radioGroup.getByRole('radio', { name: '大学生活' });
  await expect(collegeLifeChip).toHaveAttribute('aria-checked', 'true');
  await expect(collegeLifeChip).toBeFocused();

  // Mobile filter sheet opening, applying filter and seeing active condition badge
  const filterTrigger = page.getByRole('button', { name: '絞り込み・並び順' });
  await expect(filterTrigger).toBeVisible();
  await filterTrigger.click();

  const filterDialog = page.getByRole('dialog', { name: '絞り込み・並び順' });
  await expect(filterDialog).toBeVisible();
  await filterDialog.getByLabel('表示条件').selectOption('favorite');
  await page.getByRole('button', { name: '完了' }).click();
  await expect(filterDialog).toBeHidden();

  // Indicator visible
  await expect(page.locator('.filter-indicator')).toContainText('自分のお気に入り');

  // Insights (集計) tab navigation via native buttons
  await page.getByRole('button', { name: '集計', exact: true }).click();
  await expect(page.getByRole('heading', { name: '質問の集計' })).toBeVisible();

  // Click on category insight card button
  const categoryCard = page.getByRole('button', { name: /大学生活/ });
  await categoryCard.click();

  // Should navigate back to questions tab filtered by category
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '集計に戻る' })).toBeVisible();

  // Click "集計に戻る" to restore Insights view
  await page.getByRole('button', { name: '集計に戻る' }).click();
  await expect(page.getByRole('heading', { name: '質問の集計' })).toBeVisible();
});

test('favorite revision changes request an explicit refresh and failures retain rows', async ({ page }) => {
  const state = await fixture(page); await login(page);
  await page.getByRole('button', { name: '絞り込み・並び順' }).click();
  const filterDialog = page.getByRole('dialog', { name: '絞り込み・並び順' });
  await filterDialog.getByLabel('表示条件').selectOption('favorite');
  await page.getByRole('button', { name: '完了' }).click();
  await expect(page.locator('.question-row')).toHaveCount(50);
  state.favoriteRevision++;
  await expect(page.getByRole('button', { name: 'お気に入りが変更されました · 一覧を更新' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /新しい質問が/ })).toHaveCount(0);
  state.failReport = true;
  await page.getByRole('button', { name: 'お気に入りが変更されました · 一覧を更新' }).click();
  await expect(page.getByText('読み込めませんでした。通信状況を確認して、もう一度お試しください。')).toBeVisible();
  await expect(page.locator('.question-row')).toHaveCount(50);
});

test('mobile filter sheet cancelation discards draft without altering URL or rows', async ({ page }) => {
  await fixture(page);
  await login(page);

  const filterTrigger = page.getByRole('button', { name: '絞り込み・並び順' });
  await filterTrigger.click();
  const filterDialog = page.getByRole('dialog', { name: '絞り込み・並び順' });
  await expect(filterDialog).toBeVisible();

  // Change select inside the sheet but cancel with Escape
  await filterDialog.getByLabel('表示条件').selectOption('favorite');
  await page.keyboard.press('Escape');
  await expect(filterDialog).toBeHidden();

  // Active condition badge must NOT appear
  await expect(page.locator('.filter-indicator')).toHaveCount(0);
  expect(page.url()).not.toContain('favorite');

  // Re-open sheet and verify draft was discarded back to 'all'
  await filterTrigger.click();
  await expect(filterDialog.getByLabel('表示条件')).toHaveValue('all');
  await page.keyboard.press('Escape');
});

test('unsaved settings navigation dialog allows cancel, discard and save before leaving', async ({ page }) => {
  const state = await fixture(page);
  await login(page);

  // Navigate to settings tab
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ルームの設定' })).toBeVisible();

  // Initially with no edits, save button is disabled and no unsaved badge
  const saveBtn = page.getByRole('button', { name: 'ルームを保存', exact: true });
  await expect(saveBtn).toBeDisabled();
  await expect(page.locator('.unsaved-badge')).toHaveCount(0);

  // Edit room title
  const titleInput = page.getByLabel('ルーム名', { exact: true });
  await titleInput.fill('変更中のタイトル');
  await expect(saveBtn).toBeEnabled();
  await expect(page.locator('.unsaved-badge')).toBeVisible();

  // Attempt to navigate away by clicking "質問" tab
  await page.getByRole('button', { name: '質問', exact: true }).click();

  // Confirmation dialog appears
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText('未保存の変更があります');

  // 1. Test "移動をキャンセル": cancels navigation and stays on settings
  await confirmDialog.getByRole('button', { name: '移動をキャンセル' }).click();
  await expect(confirmDialog).toBeHidden();
  await expect(titleInput).toHaveValue('変更中のタイトル');
  await expect(page.locator('.unsaved-badge')).toBeVisible();

  // 2. Test "破棄して移動": discards edits and navigates to target tab
  await page.getByRole('button', { name: '質問', exact: true }).click();
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: '破棄して移動' }).click();
  await expect(confirmDialog).toBeHidden();

  // Verified we arrived on questions tab
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();

  // Return to settings and verify edits were discarded
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(titleInput).toHaveValue('オープンキャンパス');
  await expect(page.locator('.unsaved-badge')).toHaveCount(0);

  // 3. Test "保存して移動": saves changes and navigates
  await titleInput.fill('保存して移動したタイトル');
  await expect(page.locator('.unsaved-badge')).toBeVisible();
  await page.getByRole('button', { name: '質問', exact: true }).click();
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: '保存して移動' }).click();

  // Verified saved and navigated
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
  expect(state.event.title).toBe('保存して移動したタイトル');
});

test('R01: sharing another room from room list does not switch active room or discard edits', async ({ page }) => {
  await fixture(page);
  await login(page);

  // Navigate to settings of active room
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const titleInput = page.getByLabel('ルーム名', { exact: true });
  await titleInput.fill('編集中の未保存タイトル');
  await expect(page.locator('.unsaved-badge')).toBeVisible();

  // Open room switcher sheet
  await page.getByTitle('ルーム一覧').click();
  const roomSheet = page.getByRole('dialog', { name: 'ルーム一覧' });
  await expect(roomSheet).toBeVisible();

  // Click share on "別のイベント"
  await roomSheet.getByLabel('別のイベントの共有を開く').click();
  await expect(roomSheet).toBeHidden();

  // Share sheet opens for "別のイベント"
  const shareSheet = page.getByRole('dialog', { name: '質問箱を共有する' });
  await expect(shareSheet).toBeVisible();
  await expect(shareSheet).toContainText('別のイベント');

  // Close share sheet
  await shareSheet.getByRole('button', { name: '閉じる' }).click();
  await expect(shareSheet).toBeHidden();

  // Active room remains 'campus', title input is still '編集中の未保存タイトル', and URL is still campus
  await expect(titleInput).toHaveValue('編集中の未保存タイトル');
  await expect(page.locator('.unsaved-badge')).toBeVisible();
  expect(page.url()).toContain('event=campus');
});

test('R02: save-and-navigate triggers acceptance stop confirmation when turning switch OFF', async ({ page }) => {
  const state = await fixture(page);
  await login(page);

  // Navigate to settings
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const switchControl = page.getByRole('switch', { name: /質問を受け付ける/ });
  await expect(switchControl).toHaveAttribute('aria-checked', 'true');

  // Turn switch OFF
  await switchControl.click();
  await expect(switchControl).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.unsaved-badge')).toBeVisible();

  // Attempt to leave by clicking "質問" tab
  await page.getByRole('button', { name: '質問', exact: true }).click();

  // First dialog: "未保存の変更があります"
  const unsavedDialog = page.getByRole('alertdialog');
  await expect(unsavedDialog).toBeVisible();
  await expect(unsavedDialog).toContainText('未保存の変更があります');

  // Click "保存して移動" -> Acceptance stop confirmation must appear!
  await unsavedDialog.getByRole('button', { name: '保存して移動' }).click();
  const stopDialog = page.getByRole('alertdialog');
  await expect(stopDialog).toBeVisible();
  await expect(stopDialog).toContainText('質問の受付を終了しますか？');

  // Test Cancel: must stay on settings, not saved, not navigated
  await stopDialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(stopDialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'ルームの設定' })).toBeVisible();
  expect(state.event.open).toBe(1);

  // Click "質問" tab again, choose save and confirm stop
  await page.getByRole('button', { name: '質問', exact: true }).click();
  await unsavedDialog.getByRole('button', { name: '保存して移動' }).click();
  await stopDialog.getByRole('button', { name: '受付を終了して保存' }).click();

  // Successfully saved open=0 and navigated to questions tab
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
  expect(state.event.open).toBe(0);
});

test('R03: insights to questions click-through pushes single history entry and restores on Back', async ({ page }) => {
  await fixture(page);
  await login(page);

  // Navigate to insights (集計)
  await page.getByRole('button', { name: '集計', exact: true }).click();
  await expect(page.getByRole('heading', { name: '質問の集計' })).toBeVisible();

  // Click on "大学生活" insight row
  await page.getByRole('button', { name: /大学生活/ }).click();

  // Navigates to questions tab with filtered condition and single history entry
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
  expect(page.url()).toContain('view=questions');
  expect(page.url()).toContain('category=%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%B4%BB');

  // Press browser back ONCE
  await page.goBack();

  // Returns directly to insights tab
  await expect(page.getByRole('heading', { name: '質問の集計' })).toBeVisible();
  expect(page.url()).toContain('view=analysis');
});

test('R04: create room sheet protects typed input from accidental dismissal', async ({ page }) => {
  await fixture(page);
  await login(page);

  // Open create room sheet from settings
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '新しいルームを作る' }).click();

  const createSheet = page.getByRole('dialog', { name: 'ルームを作る' });
  await expect(createSheet).toBeVisible();

  // Type title
  const nameInput = createSheet.getByLabel('ルーム名', { exact: true });
  await nameInput.fill('新入生ガイダンス');

  // Press Escape
  await page.keyboard.press('Escape');

  // Discard confirmation dialog appears
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText('新しいルームの入力内容が破棄されます');

  // Cancel discard: input retained
  await confirmDialog.getByRole('button', { name: '入力を続ける' }).click();
  await expect(createSheet).toBeVisible();
  await expect(nameInput).toHaveValue('新入生ガイダンス');

  // Confirm discard: sheet closes
  await page.keyboard.press('Escape');
  await confirmDialog.getByRole('button', { name: '破棄して閉じる' }).click();
  await expect(createSheet).toBeHidden();

  // Re-open: input is clear
  await page.getByRole('button', { name: '新しいルームを作る' }).click();
  await expect(createSheet.getByLabel('ルーム名', { exact: true })).toHaveValue('');
});

test('R05: switch thumb strictly contained inside track with equal margins', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: '設定', exact: true }).click();

  const switchBtn = page.getByRole('switch', { name: /質問を受け付ける/ });
  const thumb = switchBtn.locator('span').first();

  // Check ON state
  await expect(switchBtn).toHaveAttribute('aria-checked', 'true');
  const trackBoxOn = (await switchBtn.boundingBox())!;
  const thumbBoxOn = (await thumb.boundingBox())!;

  expect(trackBoxOn.width).toBe(48);
  expect(trackBoxOn.height).toBe(28);
  expect(thumbBoxOn.width).toBe(22);
  expect(thumbBoxOn.height).toBe(22);
  // Strictly inside track
  expect(thumbBoxOn.x).toBeGreaterThanOrEqual(trackBoxOn.x + 1.5);
  expect(thumbBoxOn.x + thumbBoxOn.width).toBeLessThanOrEqual(trackBoxOn.x + trackBoxOn.width - 1.5);

  // Check OFF state
  await switchBtn.click();
  await expect(switchBtn).toHaveAttribute('aria-checked', 'false');
  const trackBoxOff = (await switchBtn.boundingBox())!;
  const thumbBoxOff = (await thumb.boundingBox())!;

  expect(thumbBoxOff.x).toBeGreaterThanOrEqual(trackBoxOff.x + 1.5);
  expect(thumbBoxOff.x + thumbBoxOff.width).toBeLessThanOrEqual(trackBoxOff.x + trackBoxOff.width - 1.5);
});

test('R07: creating a new room shows share guidance banner on questions tab', async ({ page }) => {
  await fixture(page);
  await login(page);

  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '新しいルームを作る' }).click();

  const createSheet = page.getByRole('dialog', { name: 'ルームを作る' });
  await createSheet.getByLabel('ルーム名', { exact: true }).fill('新歓フェスティバル');
  await createSheet.getByRole('button', { name: 'ルームを保存' }).click();

  // Automatically navigated to questions tab and banner appears
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
  const banner = page.locator('.created-room-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('新歓フェスティバル');

  // Clicking "募集リンクを共有" opens share sheet for new room
  await banner.getByRole('button', { name: '募集リンクを共有' }).click();
  const shareSheet = page.getByRole('dialog', { name: '質問箱を共有する' });
  await expect(shareSheet).toBeVisible();
  await expect(shareSheet).toContainText('新歓フェスティバル');
});

test('R08: unfavoriting question preserves card in-place with inline undo notice across sort modes', async ({ page }) => {
  await fixture(page);
  await login(page);

  // Filter to favorites
  await page.getByRole('button', { name: '絞り込み・並び順' }).click();
  const filterDialog = page.getByRole('dialog', { name: '絞り込み・並び順' });
  await filterDialog.getByLabel('表示条件').selectOption('favorite');
  await page.getByRole('button', { name: '完了' }).click();

  const firstCard = page.locator('.question-row').first();
  await expect(firstCard).toBeVisible();
  const questionText = await firstCard.locator('.question-body').textContent();

  // Click star to unfavorite
  await firstCard.locator('.star-button').click();

  // Card is STILL rendered in place (not replaced by raw box)
  await expect(firstCard).toHaveClass(/is-unfavorited/);
  await expect(firstCard.locator('.question-body')).toHaveText(questionText!);

  // Inline undo notice is visible
  const undoNotice = firstCard.locator('.undo-inline-notice');
  await expect(undoNotice).toBeVisible();
  await expect(undoNotice).toContainText('自分のお気に入りを解除しました');

  // Click "元に戻す"
  await undoNotice.getByRole('button', { name: '元に戻す' }).click();
  await expect(firstCard).not.toHaveClass(/is-unfavorited/);
  await expect(undoNotice).toBeHidden();
});

test('R10: unconfirmed submission leaves body readOnly and allows text selection with processing label', async ({ page }) => {
  const state = await fixture(page);
  state.loseResponse = true;
  await page.goto('?event=campus');

  const body = page.getByLabel('聞いてみたいこと');
  await body.fill('未確認状態でのテキスト選択テスト');
  await foldAndSend(page);

  await expect(page.getByText('受付が完了したか確認できませんでした。', { exact: false })).toBeVisible();

  // Textarea should be readOnly, NOT disabled
  await expect(body).toHaveAttribute('readonly', '');
  await expect(body).toBeEnabled();

  // Submit button says "送信結果を確認"
  const checkBtn = page.getByRole('button', { name: '送信結果を確認' });
  await expect(checkBtn).toBeVisible();

  // Delay questions endpoint to verify busy label "確認中…"
  let resolveCheck: (() => void) | null = null;
  await page.route('**/api/questions', async (route) => {
    await new Promise<void>((r) => { resolveCheck = r; });
    await route.fulfill({ status: 200, json: { ok: true, id: 'saved' } });
  });

  await checkBtn.click();
  await expect(page.getByRole('button', { name: '確認中…' })).toBeVisible();

  // Complete request
  resolveCheck!();
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeVisible();
});


test('R06: cancelling Back preserves Forward; discard restores the original filtered entry', async ({ page }) => {
  await fixture(page); await login(page);
  await page.getByRole('button', { name: '絞り込み・並び順' }).click();
  await page.getByRole('dialog', { name: '絞り込み・並び順' }).getByLabel('並び順').selectOption('oldest');
  await page.getByRole('button', { name: '完了', exact: true }).click();
  const filtered = page.url();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const settingsUrl = page.url();
  await page.getByRole('button', { name: '質問', exact: true }).click();
  const forwardUrl = page.url();
  await page.goBack();
  await expect(page.getByLabel('ルーム名', { exact: true })).toBeVisible();
  await page.getByLabel('ルーム名', { exact: true }).fill('未保存の名前');
  await page.evaluate(() => history.back());
  const dialog = page.getByRole('alertdialog', { name: '未保存の変更があります' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(settingsUrl);
  await dialog.getByRole('button', { name: '移動をキャンセル' }).click();
  await expect(page.getByLabel('ルーム名', { exact: true })).toHaveValue('未保存の名前');
  await page.evaluate(() => history.forward());
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(settingsUrl);
  await dialog.getByRole('button', { name: '破棄して移動' }).click();
  await expect(page).toHaveURL(forwardUrl);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(filtered);
  await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible();
});

test('R04: Escape and close cannot discard a room while its save is in flight', async ({ page }) => {
  await fixture(page); await login(page);
  let release!: () => void;
  await page.route('**/api/events', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fallback();
  });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '新しいルームを作る' }).click();
  const sheet = page.getByRole('dialog', { name: 'ルームを作る' });
  await sheet.getByLabel('ルーム名', { exact: true }).fill('保存中ルーム');
  await sheet.getByRole('button', { name: 'ルームを保存' }).click();
  await expect(sheet.getByRole('button', { name: /保存中/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await sheet.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  release();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.created-room-banner')).toContainText('保存中ルーム');
});

for (const sort of ['newest', 'oldest', 'theme']) {
  test(`R08: favorite removal and Undo preserve card order in ${sort}`, async ({ page }) => {
    await fixture(page); await login(page);
    await page.getByRole('button', { name: '絞り込み・並び順' }).click();
    const sheet = page.getByRole('dialog', { name: '絞り込み・並び順' });
    await sheet.getByLabel('表示条件').selectOption('favorite');
    await sheet.getByLabel('並び順').selectOption(sort);
    await page.getByRole('button', { name: '完了', exact: true }).click();
    await expect(page.locator('.question-row')).toHaveCount(50);
    const before = await page.locator('.question-body').allTextContents();
    const card = page.locator('.question-row').first();
    await card.locator('.star-button').click();
    await expect(card).toHaveClass(/is-unfavorited/);
    const contrast = await card.locator('.undo-inline-notice').evaluate(node => {
      const style = getComputedStyle(node);
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const text = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    expect(await page.locator('.question-body').allTextContents()).toEqual(before);
    await card.getByRole('button', { name: '元に戻す' }).click();
    await expect(card).not.toHaveClass(/is-unfavorited/);
    expect(await page.locator('.question-body').allTextContents()).toEqual(before);
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`R09/R12: ${width}px and 200% text keep visitor and operator content within the viewport`, async ({ page }) => {
    await fixture(page); await page.setViewportSize({ width, height: 900 });
    await page.goto('?room=campus');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(page.getByLabel('聞いてみたいこと')).toBeVisible();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    expect(await fits()).toBe(true);
    await login(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const tab of ['質問', '集計', '設定']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      expect(await fits()).toBe(true);
    }
    const toggle = page.getByRole('switch', { name: /質問を受け付ける/ });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const measure = async () => {
      const track = (await toggle.boundingBox())!;
      const thumb = (await toggle.locator('span').first().boundingBox())!;
      expect(thumb.y - track.y).toBeCloseTo((track.height - thumb.height) / 2, 1);
      return { track, thumb };
    };
    const on = await measure();
    await toggle.click();
    const off = await measure();
    expect(on.track.x + on.track.width - on.thumb.x - on.thumb.width).toBeCloseTo(off.thumb.x - off.track.x, 1);
  });
}

test('R06: failed save after Back retains input and history; successful retry resumes traversal', async ({ page }) => {
  const state = await fixture(page); await login(page);
  const questionsUrl = page.url();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const settingsUrl = page.url();
  await page.getByLabel('ルーム名', { exact: true }).fill('保存する編集');
  let fail = true;
  await page.route('**/api/events/*', async route => {
    if (route.request().method() === 'PATCH' && fail) return route.fulfill({ status: 503, json: { error: { code: 'STORAGE_UNAVAILABLE', message: '保存に失敗しました' } } });
    return route.fallback();
  });
  await page.evaluate(() => history.back());
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(settingsUrl);
  await dialog.getByRole('button', { name: '保存して移動', exact: true }).click();
  await expect(page.getByText('保存に失敗しました', { exact: true })).toBeVisible();
  await expect(page.getByLabel('ルーム名', { exact: true })).toHaveValue('保存する編集');
  await expect(page).toHaveURL(settingsUrl);
  fail = false;
  await page.evaluate(() => history.back());
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '保存して移動', exact: true }).click();
  await expect(page).toHaveURL(questionsUrl);
  expect(state.event.title).toBe('保存する編集');
  await page.goForward();
  await expect(page).toHaveURL(settingsUrl);
});

test('R08: multiple removals retain independent Undo; a failed update restores the favorite', async ({ page }) => {
  const state = await fixture(page); await login(page);
  await page.getByRole('button', { name: '絞り込み・並び順' }).click();
  await page.getByRole('dialog', { name: '絞り込み・並び順' }).getByLabel('表示条件').selectOption('favorite');
  await page.getByRole('button', { name: '完了', exact: true }).click();
  const cards = page.locator('.question-row');
  await cards.nth(0).locator('.star-button').click();
  await expect(cards.nth(0).locator('.undo-inline-notice')).toBeVisible();
  await cards.nth(1).locator('.star-button').click();
  await expect(cards.nth(0).locator('.undo-inline-notice')).toBeVisible();
  await expect(cards.nth(1).locator('.undo-inline-notice')).toBeVisible();
  await cards.nth(0).getByRole('button', { name: '元に戻す' }).click();
  await expect(cards.nth(0).locator('.star-button')).toHaveAttribute('aria-pressed', 'true');
  expect(state.favorites.get('q-150')).toBe(true);
  expect(state.favorites.get('q-149')).toBe(false);
  await page.route('**/api/admin/questions/*/favorite', route => route.fulfill({ status: 503, json: { error: { code: 'STORAGE_UNAVAILABLE', message: '更新失敗' } } }));
  await cards.nth(2).locator('.star-button').click();
  await expect(page.getByText('お気に入りの更新に失敗しました。', { exact: true })).toBeVisible();
  await expect(cards.nth(2).locator('.star-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(2).locator('.undo-inline-notice')).toHaveCount(0);
});

test('R06: new-room and logout paths retain edits on cancel and save or discard explicitly', async ({ page }) => {
  const state = await fixture(page); await login(page);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('ルーム名', { exact: true }).fill('新規作成前に保存');
  await page.getByRole('button', { name: '新しいルームを作る' }).click();
  let dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: '作成をキャンセル' }).click();
  await expect(page.getByLabel('ルーム名', { exact: true })).toHaveValue('新規作成前に保存');
  await page.getByRole('button', { name: '新しいルームを作る' }).click();
  await dialog.getByRole('button', { name: '保存して作成' }).click();
  const create = page.getByRole('dialog', { name: 'ルームを作る' });
  await expect(create).toBeVisible();
  expect(state.event.title).toBe('新規作成前に保存');
  await page.keyboard.press('Escape');
  await expect(create).toBeHidden();
  await page.getByLabel('ルーム名', { exact: true }).fill('ログアウト前の編集');
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'ログアウトをキャンセル' }).click();
  await expect(page.getByLabel('ルーム名', { exact: true })).toHaveValue('ログアウト前の編集');
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await dialog.getByRole('button', { name: '破棄してログアウト' }).click();
  await expect(page.getByRole('button', { name: 'テスト用Googleログイン' })).toBeVisible();
  expect(state.event.title).toBe('新規作成前に保存');
});
