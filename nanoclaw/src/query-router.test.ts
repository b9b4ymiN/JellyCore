import { describe, expect, it } from 'vitest';

import { classifyQuery } from './query-router.js';

describe('classifyQuery', () => {
  it('routes Thai explanatory questions to sonnet', () => {
    const result = classifyQuery(
      'ไม่เข้าใจเท่าไรหลักการคือซื้อตอน pull back หรืออันเดียวกันไหม เหมือนได้ยินจากไหนนี้แหละ',
    );

    expect(result).toEqual({
      tier: 'container-full',
      model: 'sonnet',
      reason: 'thai-explanation',
    });
  });

  it('keeps short casual chat on the lighter tier', () => {
    const result = classifyQuery('วันนี้เหนื่อยนิดหน่อย');

    expect(result).toEqual({
      tier: 'container-light',
      model: 'haiku',
      reason: 'general',
    });
  });
});
