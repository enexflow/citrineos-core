// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { selectAuthorization } from '../../src/util/selectAuthorization.js';

const now = new Date('2026-10-28T12:00:00Z');

describe('selectAuthorization', () => {
  it('returns undefined for no rows', () => {
    expect(selectAuthorization([], now)).toBeUndefined();
    expect(selectAuthorization(undefined, now)).toBeUndefined();
  });

  it('returns the only row whatever its status', () => {
    const blocked = { id: 1, status: 'Blocked', updatedAt: '2026-01-01T00:00:00Z' };
    expect(selectAuthorization([blocked], now)).toBe(blocked);
  });

  it('prefers an accepted row over a more recent blocked one', () => {
    const accepted = { id: 1, status: 'Accepted', updatedAt: '2026-01-01T00:00:00Z' };
    const blocked = { id: 2, status: 'Blocked', updatedAt: '2026-10-01T00:00:00Z' };
    expect(selectAuthorization([blocked, accepted], now)).toBe(accepted);
  });

  it('treats an expired cache as not usable', () => {
    const expired = {
      id: 1,
      status: 'Accepted',
      cacheExpiryDateTime: '2026-10-28T11:00:00Z',
      updatedAt: '2026-10-28T10:00:00Z',
    };
    const valid = { id: 2, status: 'Accepted', updatedAt: '2026-01-01T00:00:00Z' };
    expect(selectAuthorization([expired, valid], now)).toBe(valid);
  });

  it('treats a missing status as usable', () => {
    const noStatus = { id: 1, status: null, updatedAt: '2026-01-01T00:00:00Z' };
    const blocked = { id: 2, status: 'Blocked', updatedAt: '2026-10-01T00:00:00Z' };
    expect(selectAuthorization([blocked, noStatus], now)).toBe(noStatus);
  });

  it('picks the most recently updated among usable rows', () => {
    const oldAbc = { id: 1, status: 'Accepted', updatedAt: '2026-01-01T00:00:00Z' };
    const newBdc = { id: 2, status: 'Accepted', updatedAt: '2026-06-01T00:00:00Z' };
    expect(selectAuthorization([oldAbc, newBdc], now)).toBe(newBdc);
  });

  it('breaks ties on highest id', () => {
    const a = { id: 1, status: 'Accepted', updatedAt: '2026-06-01T00:00:00Z' };
    const b = { id: 2, status: 'Accepted', updatedAt: '2026-06-01T00:00:00Z' };
    expect(selectAuthorization([a, b], now)).toBe(b);
  });

  it('falls back to the most recent row when none is usable', () => {
    const old = { id: 1, status: 'Blocked', updatedAt: '2026-01-01T00:00:00Z' };
    const recent = { id: 2, status: 'Expired', updatedAt: '2026-06-01T00:00:00Z' };
    expect(selectAuthorization([old, recent], now)).toBe(recent);
  });
});
