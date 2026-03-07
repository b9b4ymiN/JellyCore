import { describe, expect, it } from 'vitest';

import { attachRequestIdHeader, createRequestId } from './request-id.js';

describe('request-id helpers', () => {
  it('creates prefixed request ids', () => {
    const id = createRequestId('ctx');
    expect(id.startsWith('ctx-')).toBe(true);
    expect(id.length).toBeGreaterThan(20);
  });

  it('attaches x-request-id when missing', () => {
    const headers = attachRequestIdHeader(undefined, 'req-1');
    expect(headers['x-request-id']).toBe('req-1');
  });

  it('keeps existing x-request-id header', () => {
    const headers = attachRequestIdHeader({ 'x-request-id': 'existing' }, 'req-2');
    expect(headers['x-request-id']).toBe('existing');
  });
});
