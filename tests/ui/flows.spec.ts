import { test, expect, type Page } from '@playwright/test';

const event = { id: 'campus', title: 'オープンキャンパス', date: '10月10日 13:00〜 白金キャンパス', open: 1, version: 1 };
async function fixture(page: Page, count = 150) {
  const state = { event: { ...event }, count, posted: [] as Record<string, unknown>[], loseResponse: false, expireCursor: false, conflict: false, polls: 0, denyAuth: false, failReport: false, favoriteRevision: 0 };
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
    if (url.pathname === '/api/admin/events') return json([state.event, { ...event, id: 'other', title: '別のイベント' }]);
    if (url.pathname === '/api/events' && request.method() === 'GET') return json([state.event, { ...event, id: 'other', title: '別のイベント' }]);
    if (url.pathname.startsWith('/api/events/') && request.method() === 'GET') {
      const id = url.pathname.split('/').pop();
      if (id === 'missing') return json({ error: { code: 'EVENT_NOT_FOUND', message: 'not found' } }, 404);
      return json(id === 'other' ? { ...event, id, title: '別のイベント' } : state.event);
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
      const sequences = Array.from({ length: Math.min(size, before - 1) }, (_, i) => before - 1 - i);
      const last = sequences.at(-1) || 0;
      return json({ total: watermark, filteredTotal: watermark, favoriteRevision: state.favoriteRevision, pageSize: size, generatedAt: Date.now(), hasNext: last > 1, nextCursor: last > 1 ? `${watermark}:${last}` : null,
        categories: [{ category: '大学生活', count: watermark }], sources: [{ source: 'web', count: watermark }], days: [{ day: '2026-09-25', count: watermark }],
        rows: sequences.map((n) => ({ id: `q-${n}`, sequence: n, body: `質問 ${n}：大学生活について教えてください。`, category: '大学生活', source: 'web', created_at: 1790000000000 + n * 1000 })) });
    }
    return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
  });
  return state;
}
async function login(page: Page) { await page.goto('admin/'); await page.getByRole('button', { name: 'テスト用Googleログイン' }).click(); await expect(page.getByRole('heading', { name: /届いた質問/ })).toBeVisible(); }

test('direct input, tactile surface, successful submission and clean sharing', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('?event=campus&from=instagram');
  const body = page.getByLabel('聞いてみたいこと'); await body.fill('自分に合うサークルの探し方は？');
  await page.getByText('学び・授業', { exact: true }).click();
  const send = page.getByRole('button', { name: '紙飛行機にする', exact: true });
  await send.scrollIntoViewIfNeeded();
  const box = (await send.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect(send).toHaveAttribute('data-pressed', 'true'); await expect(send.locator('.action-surface')).not.toHaveCSS('transform', 'none');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'タップして送信' })).toBeVisible();
  expect(state.posted).toHaveLength(0);
  await page.getByRole('button', { name: 'タップして送信' }).click();
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
  await expect(page.getByText('送信結果を確認できませんでした。', { exact: false })).toBeVisible();
  await page.reload(); await expect(page.locator('.paper-preview-body')).toHaveText('留学の準備について教えてください');
  await page.getByRole('button', { name: '同じ内容で送信結果を確認' }).click();
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
  state.event.open = 0; await page.reload(); await expect(page.getByRole('button', { name: '紙飛行機にする', exact: true })).toBeDisabled();
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
  await page.getByLabel('ルーム名', { exact: true }).fill('自分の編集'); state.conflict = true;
  await page.getByRole('button', { name: 'ルームを保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '現在保存されている内容' })).toBeVisible(); await expect(page.getByLabel('ルーム名', { exact: true })).toHaveValue('自分の編集');
  await expect(page.getByRole('button', { name: 'ルームを保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '確認して編集を続ける' }).click(); await page.getByRole('button', { name: 'ルームを保存', exact: true }).click();
  await expect(page.getByText('ルームを保存しました。', { exact: true })).toBeVisible(); expect(state.event.title).toBe('自分の編集'); expect(state.event.version).toBe(3);
  await page.getByRole('switch', { name: /質問を受け付ける/ }).click(); await page.getByRole('button', { name: 'ルームを保存', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button', { name: '受付を終了して保存' }).click(); await expect(page.getByText('ルームを保存しました。', { exact: true })).toBeVisible(); expect(state.event.open).toBe(0);
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
  await context.setOffline(true); await expect(page.getByRole('button', { name: '紙飛行機にする', exact: true })).toBeDisabled();
  await context.setOffline(false); await expect(page.getByRole('button', { name: '紙飛行機にする', exact: true })).toBeEnabled();
  await expect(page.getByLabel('聞いてみたいこと')).toHaveValue('オフライン時の質問');
});


test('cancelled press does not submit; keyboard and sheets retain focus', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('?event=campus');
  await page.getByLabel('聞いてみたいこと').fill('キーボードからの質問');
  await page.screenshot({ path: 'test-results/mobile-input.png', fullPage: true });
  const send = page.getByRole('button', { name: '紙飛行機にする', exact: true });
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
  const tap = page.getByRole('button', { name: 'タップして送信' });
  await expect(tap).toBeVisible(); await tap.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeFocused();
  expect(state.posted).toHaveLength(1);
  await login(page);
  await page.screenshot({ path: 'test-results/mobile-admin.png' });
});


async function foldAndSend(page: Page) {
  await page.getByRole('button', { name: '紙飛行機にする', exact: true }).click();
  await page.getByRole('button', { name: 'タップして送信', exact: true }).click();
}

test('roomless and ambiguous links never choose another room', async ({ page }) => {
  await fixture(page);
  await page.goto('./'); await expect(page.getByRole('heading', { name: '主催者から案内されたリンクを開いてください' })).toBeVisible();
  await page.goto('?room=campus&event=other'); await expect(page.getByRole('heading', { name: 'リンクを確認してください' })).toBeVisible();
  await expect(page.getByLabel('聞いてみたいこと')).toHaveCount(0);
});

test('upward swipe submits once; short, sideways, cancelled and multiple pointers do not', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('?room=campus'); await page.getByLabel('聞いてみたいこと').fill('スワイプで送る質問');
  await page.getByRole('button', { name: '紙飛行機にする' }).click();
  const runway = page.locator('.airplane-runway'); await expect(runway).toBeVisible();
  const pointer = async (type: string, x: number, y: number, id = 1, primary = true) => runway.dispatchEvent(type, { pointerId: id, isPrimary: primary, pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true });
  for (const [dx,dy] of [[0,-30],[100,-90],[0,100]]) {
    await pointer('pointerdown',100,300); await pointer('pointermove',100+dx,300+dy); await pointer('pointerup',100+dx,300+dy);
    expect(state.posted).toHaveLength(0);
  }
  await pointer('pointerdown',100,300); await pointer('pointermove',100,180); await pointer('pointercancel',100,180);
  expect(state.posted).toHaveLength(0);
  await pointer('pointerdown',100,300); await pointer('pointermove',100,180); await pointer('pointerdown',120,200,2,false); await pointer('pointerup',100,180);
  expect(state.posted).toHaveLength(0);
  await runway.scrollIntoViewIfNeeded(); const box=(await runway.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height-30); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,box.y+box.height-140,{steps:6}); await page.mouse.up();
  await expect(page.getByRole('heading', { name: '質問を受け付けました' })).toBeFocused(); expect(state.posted).toHaveLength(1);
});

test('reduced motion keeps the airplane stationary and tap remains available', async ({ page }) => {
  const state = await fixture(page); await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('?room=campus'); await page.getByLabel('聞いてみたいこと').fill('静止したまま送信');
  await page.getByRole('button', {name:'紙飛行機にする'}).click();
  const runway=page.locator('.airplane-runway'); await expect(runway).toBeVisible();
  await runway.dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,clientX:100,clientY:300});
  await runway.dispatchEvent('pointermove',{pointerId:1,isPrimary:true,clientX:100,clientY:100});
  await expect(page.locator('.paper-airplane-wrapper')).toHaveCSS('transform','none');
  await runway.dispatchEvent('pointerup',{pointerId:1,isPrimary:true,clientX:100,clientY:100});
  expect(state.posted).toHaveLength(0);
  await page.getByRole('button',{name:'タップして送信'}).click(); await expect(page.getByRole('heading',{name:'質問を受け付けました'})).toBeVisible();
});


test('favorite revision changes request an explicit refresh and failures retain rows', async ({ page }) => {
  const state=await fixture(page); await login(page);
  await page.getByLabel('表示条件').selectOption('favorite'); await expect(page.locator('.question-row')).toHaveCount(50);
  state.favoriteRevision++;
  await expect(page.getByRole('button',{name:'お気に入りが変更されました · 一覧を更新'})).toBeVisible({timeout:10000});
  await expect(page.getByRole('button',{name:/新しい質問が/})).toHaveCount(0);
  state.failReport=true;
  await page.getByRole('button',{name:'お気に入りが変更されました · 一覧を更新'}).click();
  await expect(page.getByText('読み込めませんでした。通信状況を確認して、もう一度お試しください。')).toBeVisible();
  await expect(page.locator('.question-row')).toHaveCount(50);
});
