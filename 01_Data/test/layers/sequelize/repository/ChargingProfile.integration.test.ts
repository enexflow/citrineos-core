// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { setupTestDatabase } from './setupTestDatabase.js';
import { SequelizeChargingProfileRepository } from '../../../../src/layers/sequelize/repository/ChargingProfile.js';
import {
  ChargingProfile,
  ChargingSchedule,
  SalesTariff,
  Tenant,
} from '../../../../src/layers/sequelize/index.js';
import type { ChargingProfileInput } from '../../../../src/layers/sequelize/mapper/2.0.1/ChargingProfileMapper.js';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const TENANT_ID = 1;
const STATION_ID = 'K0032128';

function profileInput(scheduleId: number, limit: number): ChargingProfileInput {
  return {
    id: 10001,
    stackLevel: 1,
    chargingProfilePurpose: 'TxDefaultProfile',
    chargingProfileKind: 'Absolute',
    validFrom: '2026-10-22T11:00:00.000Z',
    validTo: '2026-10-22T12:00:00.000Z',
    chargingSchedule: [
      {
        id: scheduleId,
        startSchedule: '2026-10-22T11:00:00.000Z',
        chargingRateUnit: 'W',
        chargingSchedulePeriod: [{ startPeriod: 0, limit }],
      },
    ],
  };
}

describe('SequelizeChargingProfileRepository - integration', () => {
  const db = setupTestDatabase();
  let repo: SequelizeChargingProfileRepository;

  beforeAll(() => {
    repo = new SequelizeChargingProfileRepository({} as any, undefined, db.sequelize);
  });

  beforeEach(async () => {
    await db.sequelize.query(`
      TRUNCATE TABLE "SalesTariffs", "ChargingSchedules", "ChargingProfiles", "Tenants"
      RESTART IDENTITY CASCADE
    `);
    await Tenant.create({ id: TENANT_ID, name: 'tenant-1', isUserTenant: false } as any);
  });

  async function expectSingleProfileWithSchedule(scheduleId: number, limit: number) {
    const profiles = await ChargingProfile.findAll({ where: { stationId: STATION_ID } });
    expect(profiles).toHaveLength(1);
    const schedules = await ChargingSchedule.findAll({ where: { stationId: STATION_ID } });
    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe(scheduleId);
    expect(schedules[0].chargingProfileDatabaseId).toBe(profiles[0].databaseId);
    expect(schedules[0].chargingSchedulePeriod[0].limit).toBe(limit);
  }

  it('replaces the schedules and sales tariff of an existing profile', async () => {
    await repo.createOrUpdateChargingProfile(
      TENANT_ID,
      {
        ...profileInput(1, 11000),
        chargingSchedule: [
          {
            ...profileInput(1, 11000).chargingSchedule[0],
            salesTariff: {
              id: 1,
              salesTariffEntry: [{ relativeTimeInterval: { start: 0 } }],
            },
          },
        ],
      },
      STATION_ID,
      1,
    );

    const updated = await repo.createOrUpdateChargingProfile(
      TENANT_ID,
      profileInput(2, 22000),
      STATION_ID,
      1,
      'EMS',
      true,
    );

    expect(updated.isActive).toBe(true);
    expect(updated.chargingLimitSource).toBe('EMS');
    await expectSingleProfileWithSchedule(2, 22000);
    expect(await SalesTariff.count()).toBe(0);
  });

  // Two instances stand in for two server replicas, where only the row lock serializes upserts.
  describe.each([
    ['one repository instance', 1],
    ['two repository instances', 2],
  ])('with %s', (_label, instanceCount) => {
    function upsertConcurrently(limit: number) {
      const repos = [
        repo,
        new SequelizeChargingProfileRepository({} as any, undefined, db.sequelize),
      ];
      return Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          repos[i % instanceCount].createOrUpdateChargingProfile(
            TENANT_ID,
            profileInput(1, limit),
            STATION_ID,
            1,
            'CSO',
            true,
          ),
        ),
      );
    }

    it('handles concurrent upserts of an existing profile without error', async () => {
      await repo.createOrUpdateChargingProfile(TENANT_ID, profileInput(1, 11000), STATION_ID, 1);

      await upsertConcurrently(22000);

      await expectSingleProfileWithSchedule(1, 22000);
    });

    it('handles concurrent upserts of a new profile without error', async () => {
      await upsertConcurrently(22000);

      await expectSingleProfileWithSchedule(1, 22000);
    });
  });

  it('keeps upserting a profile after a failed upsert of the same profile', async () => {
    vi.spyOn(repo as any, '_createOrUpdateChargingProfile').mockRejectedValueOnce(
      new Error('connection lost'),
    );

    const results = await Promise.allSettled([
      repo.createOrUpdateChargingProfile(TENANT_ID, profileInput(1, 11000), STATION_ID, 1),
      repo.createOrUpdateChargingProfile(TENANT_ID, profileInput(1, 22000), STATION_ID, 1),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
    await expectSingleProfileWithSchedule(1, 22000);
    expect((repo as any)._upsertQueues.size).toBe(0);
  });
});
