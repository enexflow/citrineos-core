// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { OCPP2_0_1 } from '@citrineos/base';
import { setupTestDatabase } from './setupTestDatabase.js';
import { SequelizeTransactionEventRepository } from '../../../../src/layers/sequelize/repository/TransactionEvent.js';
import {
  ChargingStation,
  MeterValue,
  Tenant,
  Transaction,
  TransactionEvent,
} from '../../../../src/layers/sequelize/index.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('SequelizeTransactionEventRepository - stale TransactionEvent handling', () => {
  const db = setupTestDatabase();
  let repo: SequelizeTransactionEventRepository;

  const tenantId = 1;
  const stationId = 'K0029329A';
  const transactionId = '572cf271-6a62-47b9-a872-3276fad88ee2';

  const buildEvent = (
    eventType: OCPP2_0_1.TransactionEventEnumType,
    seqNo: number,
    timestamp: string,
    energyWh: number,
    transactionInfo: Partial<OCPP2_0_1.TransactionType> = {},
  ): OCPP2_0_1.TransactionEventRequest => ({
    eventType,
    seqNo,
    timestamp,
    triggerReason:
      eventType === OCPP2_0_1.TransactionEventEnumType.Ended
        ? OCPP2_0_1.TriggerReasonEnumType.EVCommunicationLost
        : OCPP2_0_1.TriggerReasonEnumType.MeterValuePeriodic,
    transactionInfo: { transactionId, ...transactionInfo },
    meterValue: [
      {
        timestamp,
        sampledValue: [
          {
            value: energyWh,
            measurand: OCPP2_0_1.MeasurandEnumType.Energy_Active_Import_Register,
            context:
              eventType === OCPP2_0_1.TransactionEventEnumType.Ended
                ? OCPP2_0_1.ReadingContextEnumType.Transaction_End
                : OCPP2_0_1.ReadingContextEnumType.Sample_Periodic,
          },
        ],
      },
    ],
  });

  const started = () =>
    buildEvent(OCPP2_0_1.TransactionEventEnumType.Started, 400, '2026-10-06T05:00:00.000Z', 1_000, {
      chargingState: OCPP2_0_1.ChargingStateEnumType.Charging,
    });
  const updated = (seqNo: number, timestamp: string, energyWh: number) =>
    buildEvent(OCPP2_0_1.TransactionEventEnumType.Updated, seqNo, timestamp, energyWh, {
      chargingState: OCPP2_0_1.ChargingStateEnumType.EVConnected,
    });
  const ended = () =>
    buildEvent(OCPP2_0_1.TransactionEventEnumType.Ended, 419, '2026-10-06T06:05:31.708Z', 247_762, {
      chargingState: OCPP2_0_1.ChargingStateEnumType.Idle,
      stoppedReason: OCPP2_0_1.ReasonEnumType.EVDisconnected,
    });

  const send = (event: OCPP2_0_1.TransactionEventRequest) =>
    repo.createOrUpdateTransactionByTransactionEventAndStationId(tenantId, event, stationId);

  const readTransaction = async () =>
    (await Transaction.findOne({ where: { stationId, transactionId } }))!;

  beforeAll(() => {
    repo = new SequelizeTransactionEventRepository(
      {} as any,
      undefined,
      undefined,
      db.sequelize,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {} as any, // chargingStationSequence: unused here, avoids DefaultSequelizeInstance
    );
  });

  beforeEach(async () => {
    await db.cleanup();
    await Tenant.create({ id: tenantId, name: 'tenant-1', isUserTenant: false } as any);
    await ChargingStation.create({ id: stationId, tenantId, isOnline: true } as any);
  });

  it('keeps an ended transaction closed when a late Updated arrives (resent seq 416 after Ended)', async () => {
    await send(started());
    await send(updated(416, '2026-10-06T06:05:17.000Z', 240_000));
    await send(updated(417, '2026-10-06T06:05:20.000Z', 245_000));
    await send(updated(418, '2026-10-06T06:05:25.000Z', 247_000));
    await send(ended());

    const afterEnded = await readTransaction();
    expect(afterEnded.isActive).toBe(false);
    expect(afterEnded.totalKwh).toBeCloseTo(246.762, 3);

    // Charger resends seq 416 once more after reconnecting
    await send(updated(416, '2026-10-06T06:05:17.000Z', 240_000));

    const tx = await readTransaction();
    expect(tx.isActive).toBe(false);
    expect(tx.chargingState).toBe(OCPP2_0_1.ChargingStateEnumType.Idle);
    expect(new Date(tx.endTime!).toISOString()).toBe('2026-10-06T06:05:31.708Z');
    expect(tx.stoppedReason).toBe(OCPP2_0_1.ReasonEnumType.EVDisconnected);
    expect(tx.totalKwh).toBeCloseTo(246.762, 3);
  });

  it('still stores the late event and its meter values for audit', async () => {
    await send(started());
    await send(ended());
    await send(updated(416, '2026-10-06T06:05:17.000Z', 240_000));

    const tx = await readTransaction();
    const events = await TransactionEvent.findAll({ where: { transactionDatabaseId: tx.id } });
    expect(events.map((e) => e.seqNo).sort()).toEqual([400, 416, 419]);

    const meterValues = await MeterValue.findAll({ where: { transactionDatabaseId: tx.id } });
    expect(meterValues).toHaveLength(3);
  });

  it('ignores an out-of-order Updated on an active transaction', async () => {
    await send(started());
    await send(updated(417, '2026-10-06T06:05:20.000Z', 245_000));
    await send(
      buildEvent(
        OCPP2_0_1.TransactionEventEnumType.Updated,
        416,
        '2026-10-06T06:05:17.000Z',
        240_000,
        { chargingState: OCPP2_0_1.ChargingStateEnumType.SuspendedEV },
      ),
    );

    const tx = await readTransaction();
    expect(tx.isActive).toBe(true);
    expect(tx.chargingState).toBe(OCPP2_0_1.ChargingStateEnumType.EVConnected);
    expect(tx.totalKwh).toBeCloseTo(244, 3);
  });

  it('applies in-order Updated events normally', async () => {
    await send(started());
    await send(updated(416, '2026-10-06T06:05:17.000Z', 240_000));
    await send(updated(417, '2026-10-06T06:05:20.000Z', 245_000));

    const tx = await readTransaction();
    expect(tx.isActive).toBe(true);
    expect(tx.chargingState).toBe(OCPP2_0_1.ChargingStateEnumType.EVConnected);
    expect(tx.totalKwh).toBeCloseTo(244, 3);
  });

  it('does not emit a transaction update for a stale event', async () => {
    await send(started());
    await send(ended());

    const listener = vi.fn();
    repo.transaction.on('updated', listener);
    try {
      await send(updated(416, '2026-10-06T06:05:17.000Z', 240_000));
    } finally {
      repo.transaction.off('updated', listener);
    }

    expect(listener).not.toHaveBeenCalled();
  });
});
