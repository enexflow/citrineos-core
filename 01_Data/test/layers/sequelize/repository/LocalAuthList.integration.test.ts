// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { BootstrapConfig } from '@citrineos/base';
import { OCPP2_0_1 } from '@citrineos/base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Authorization,
  LocalListAuthorization,
  Tenant,
} from '../../../../src/layers/sequelize/index.js';
import { SequelizeAuthorizationRepository } from '../../../../src/layers/sequelize/repository/Authorization.js';
import { SequelizeLocalAuthListRepository } from '../../../../src/layers/sequelize/repository/LocalAuthList.js';
import { setupTestDatabase } from './setupTestDatabase.js';

describe('SequelizeLocalAuthListRepository - integration', () => {
  const db = setupTestDatabase();
  const stationId = 'station-1';
  const correlationId = 'corr-1';
  let repo: SequelizeLocalAuthListRepository;
  let authA: Authorization;
  let authB: Authorization;

  const authData: OCPP2_0_1.AuthorizationData[] = [
    { idToken: { idToken: 'AAAA0001', type: OCPP2_0_1.IdTokenEnumType.ISO14443 } },
    { idToken: { idToken: 'BBBB0002', type: OCPP2_0_1.IdTokenEnumType.ISO14443 } },
  ];

  beforeAll(() => {
    const config = {} as BootstrapConfig;
    repo = new SequelizeLocalAuthListRepository(
      config,
      undefined,
      db.sequelize,
      new SequelizeAuthorizationRepository(config, undefined, db.sequelize),
    );
  });

  beforeEach(async () => {
    await db.cleanup();
    await Tenant.create({ id: 1, name: 'tenant-1', isUserTenant: false } as any);
    authA = await Authorization.create({
      tenantId: 1,
      idToken: 'AAAA0001',
      idTokenType: 'ISO14443',
      status: 'Accepted',
      language1: 'fr',
      chargingPriority: 3,
    } as any);
    authB = await Authorization.create({
      tenantId: 1,
      idToken: 'BBBB0002',
      idTokenType: 'ISO14443',
      status: 'Accepted',
    } as any);
  });

  it('resolves undefined when no local list version exists, including the entries', async () => {
    const result = await repo.readOnlyOneByQuery(1, {
      where: { stationId },
      include: [LocalListAuthorization],
    });
    expect(result).toBeUndefined();
  });

  it('snapshots the authorization attributes into the send local list entries', async () => {
    const sendLocalList = await repo.createSendLocalListFromRequestData(
      1,
      stationId,
      correlationId,
      OCPP2_0_1.UpdateEnumType.Full,
      2,
      authData,
    );
    const entries = sendLocalList.localAuthorizationList ?? [];
    expect(entries).toHaveLength(2);
    const entryA = entries.find((e) => e.authorizationId === authA.id);
    expect(entryA).toBeDefined();
    expect(entryA?.idToken).toBe('AAAA0001');
    expect(entryA?.idTokenType).toBe('ISO14443');
    expect(entryA?.status).toBe('Accepted');
    expect(entryA?.language1).toBe('fr');
    expect(entryA?.chargingPriority).toBe(3);
    expect(entryA?.tenantId).toBe(1);
    expect(entries.find((e) => e.authorizationId === authB.id)?.idToken).toBe('BBBB0002');
  });

  it('persists the pushed version with its entries after acceptance', async () => {
    await repo.createSendLocalListFromRequestData(
      1,
      stationId,
      correlationId,
      OCPP2_0_1.UpdateEnumType.Full,
      2,
      authData,
    );
    const sendLocalList = await repo.getSendLocalListRequestByStationIdAndCorrelationId(
      1,
      stationId,
      correlationId,
    );
    expect(sendLocalList?.localAuthorizationList).toHaveLength(2);

    const version = await repo.createOrUpdateLocalListVersionFromStationIdAndSendLocalList(
      1,
      stationId,
      sendLocalList!,
    );
    expect(version.versionNumber).toBe(2);
    expect(version.localAuthorizationList).toHaveLength(2);

    const stored = await repo.readOnlyOneByQuery(1, {
      where: { stationId },
      include: [LocalListAuthorization],
    });
    expect(stored?.versionNumber).toBe(2);
    expect(stored?.localAuthorizationList).toHaveLength(2);
  });
});
