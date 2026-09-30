import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_ORDER, EventLifecycleSchema, FavoriteActionSchema, AdminReportQuerySchema } from '../src/types.js';

describe('P1 Event Lifecycle & Filter Validation - Unit Tests', () => {
  it('CATEGORY_ORDER: 5テーマの順序が仕様通りであること', () => {
    assert.equal(CATEGORY_ORDER['大学生活'], 0);
    assert.equal(CATEGORY_ORDER['学び・授業'], 1);
    assert.equal(CATEGORY_ORDER['入試・進路'], 2);
    assert.equal(CATEGORY_ORDER['留学・国際交流'], 3);
    assert.equal(CATEGORY_ORDER['その他'], 4);
  });

  it('EventLifecycleSchema: 有効なアクションとバージョンを受け入れること', () => {
    const valid = { action: 'archive', version: 1 };
    const parsed = EventLifecycleSchema.safeParse(valid);
    assert.equal(parsed.success, true);
  });

  it('EventLifecycleSchema: 不正なアクションを拒絶すること', () => {
    const invalid = { action: 'delete_forever', version: 1 };
    const parsed = EventLifecycleSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  });

  it('FavoriteActionSchema: boolean を要求すること', () => {
    assert.equal(FavoriteActionSchema.safeParse({ favorite: true }).success, true);
    assert.equal(FavoriteActionSchema.safeParse({ favorite: false }).success, true);
    assert.equal(FavoriteActionSchema.safeParse({ favorite: 'yes' }).success, false);
  });

  it('AdminReportQuerySchema: フィルタと並び順を正しくパースすること', () => {
    const query = {
      event: 'test-event-1',
      pageSize: '30',
      category: '大学生活',
      sort: 'theme',
      favorite: 'favorite',
      day: '2026-09-30',
      source: 'web',
    };
    const parsed = AdminReportQuerySchema.safeParse(query);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.pageSize, 30);
      assert.equal(parsed.data.sort, 'theme');
      assert.equal(parsed.data.category, '大学生活');
    }
  });

  it('AdminReportQuerySchema: 不正な並び順を拒絶すること', () => {
    const query = { event: 'test-event-1', sort: 'random' };
    const parsed = AdminReportQuerySchema.safeParse(query);
    assert.equal(parsed.success, false);
  });
});
