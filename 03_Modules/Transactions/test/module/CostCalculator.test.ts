// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@citrineos/base';
import { CostCalculator } from '../../src/module/CostCalculator.js';

describe('CostCalculator', () => {
  // TODO: Remove this test once tariff-based cost calculation is reimplemented
  it('returns 0 until tariff-based cost calculation is reimplemented', async () => {
    const calculator = new CostCalculator(
      { findByStationId: vi.fn() } as any,
      { recalculateTotalKwh: vi.fn() } as any,
    );
    expect(await calculator.calculateTotalCost(DEFAULT_TENANT_ID, 'station-1', 20)).toBe(0);
  });
});
