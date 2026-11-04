// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { OCPP1_6, OCPP2_0_1 } from '@citrineos/base';
import { setupTestDatabase } from './setupTestDatabase.js';
import { SequelizeTransactionEventRepository } from '../../../../src/layers/sequelize/repository/TransactionEvent.js';
import {
  ChargingStation,
  Connector,
  MeterValue,
  StartTransaction,
  StopTransaction,
  Tenant,
  Transaction,
  TransactionEvent,
} from '../../../../src/layers/sequelize/index.js';
import { Op } from 'sequelize';
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

describe('SequelizeTransactionEventRepository - OCPP 1.6 createStopTransaction', () => {
  const db = setupTestDatabase();
  let repo: SequelizeTransactionEventRepository;

  const tenantId = 1;
  const stationId = 'cp002';

  const energyReading = (timestamp: string, energyWh: number) => ({
    timestamp,
    sampledValue: [
      {
        value: energyWh,
        context: OCPP2_0_1.ReadingContextEnumType.Sample_Periodic,
        measurand: OCPP2_0_1.MeasurandEnumType.Energy_Active_Import_Register,
        location: OCPP2_0_1.LocationEnumType.Outlet,
        unitOfMeasure: { unit: 'Wh', multiplier: 0 },
      },
    ],
  });

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

  const startTransaction = async () => {
    const transaction = await Transaction.create({
      tenantId,
      stationId,
      transactionId: '8',
      isActive: true,
      meterStart: 27.776,
    } as any);
    await StartTransaction.create({
      tenantId,
      stationId,
      meterStart: 27776,
      timestamp: '2026-10-29T09:10:35.778Z',
      transactionDatabaseId: transaction.id,
    } as any);
    // Readings already received through MeterValues during the session
    for (const reading of [
      energyReading('2026-10-29T09:10:45.346Z', 28026.64),
      energyReading('2026-10-29T09:10:55.367Z', 28582.15),
    ]) {
      await MeterValue.create({
        ...reading,
        tenantId,
        transactionDatabaseId: transaction.id,
        transactionId: '8',
      } as any);
    }
    return transaction;
  };

  it('closes the transaction in one write and does not store repeated transactionData readings', async () => {
    const transaction = await startTransaction();

    const repeatedWithNewMeasurand = energyReading('2026-10-29T09:10:55.367Z', 28582.15);
    repeatedWithNewMeasurand.sampledValue.push({
      value: 3300,
      context: OCPP2_0_1.ReadingContextEnumType.Sample_Periodic,
      measurand: OCPP2_0_1.MeasurandEnumType.Power_Active_Import,
      location: OCPP2_0_1.LocationEnumType.Outlet,
      unitOfMeasure: { unit: 'W', multiplier: 0 },
    });

    await repo.createStopTransaction(
      tenantId,
      transaction.id,
      stationId,
      28724,
      new Date('2026-10-29T09:11:05.000Z'),
      [
        energyReading('2026-10-29T09:10:45.346Z', 28026.64), // exact repeat: skipped
        repeatedWithNewMeasurand, // repeat + new Power value: only Power is stored
        energyReading('2026-10-29T09:11:04.500Z', 28724), // new reading: stored
      ] as any,
      'EVDisconnected',
    );

    const closed = (await Transaction.findByPk(transaction.id))!;
    expect(closed.isActive).toBe(false);
    expect(Number(closed.totalKwh)).toBeCloseTo(0.948, 3);
    expect(closed.stoppedReason).toBe('EVDisconnected');
    expect(new Date(closed.endTime!).toISOString()).toBe('2026-10-29T09:11:05.000Z');

    const stopReadings = await MeterValue.findAll({
      where: {
        transactionDatabaseId: transaction.id,
        stopTransactionDatabaseId: { [Op.ne]: null },
      },
      order: [['timestamp', 'ASC']],
    });
    expect(stopReadings).toHaveLength(2);
    expect(stopReadings[0].sampledValue.map((sv) => sv.measurand)).toEqual([
      OCPP2_0_1.MeasurandEnumType.Power_Active_Import,
    ]);
    expect(stopReadings[1].sampledValue[0].value).toBe(28724);
    expect(stopReadings.every((mv) => mv.transactionId === '8')).toBe(true);

    expect(await MeterValue.count({ where: { transactionDatabaseId: transaction.id } })).toBe(4);
  });

  it('closes the transaction when a stored reading contains a null sampled value (legacy SignedData)', async () => {
    const transaction = await startTransaction();
    const withSignedData = energyReading('2026-10-29T09:11:00.000Z', 28650);
    await MeterValue.create({
      ...withSignedData,
      sampledValue: [...withSignedData.sampledValue, null],
      tenantId,
      transactionDatabaseId: transaction.id,
      transactionId: '8',
    } as any);

    await repo.createStopTransaction(
      tenantId,
      transaction.id,
      stationId,
      28724,
      new Date('2026-10-29T09:11:05.000Z'),
      [
        energyReading('2026-10-29T09:11:00.000Z', 28650), // repeat of the reading stored with the null: skipped
        energyReading('2026-10-29T09:11:04.500Z', 28724),
      ] as any,
      'EVDisconnected',
    );

    const closed = (await Transaction.findByPk(transaction.id))!;
    expect(closed.isActive).toBe(false);
    expect(Number(closed.totalKwh)).toBeCloseTo(0.948, 3);
    expect(
      await MeterValue.count({
        where: {
          transactionDatabaseId: transaction.id,
          stopTransactionDatabaseId: { [Op.ne]: null },
        },
      }),
    ).toBe(1);
  });
  const stop = (transactionDatabaseId: number) =>
    repo.createStopTransaction(
      tenantId,
      transactionDatabaseId,
      stationId,
      28724,
      new Date('2026-10-29T09:11:05.000Z'),
      [energyReading('2026-10-29T09:11:04.500Z', 28724)] as any,
      'EVDisconnected',
    );

  it('finishes a stop half-written by the pre-atomic code (StopTransaction row on an active transaction)', async () => {
    const transaction = await startTransaction();
    const halfWritten = await StopTransaction.create({
      tenantId,
      stationId,
      transactionDatabaseId: transaction.id,
      meterStop: 28724,
      timestamp: '2026-10-29T09:11:05.000Z',
      reason: 'EVDisconnected',
    } as any);

    const result = await stop(transaction.id);

    expect(result.id).toBe(halfWritten.id);
    const closed = (await Transaction.findByPk(transaction.id))!;
    expect(closed.isActive).toBe(false);
    expect(Number(closed.totalKwh)).toBeCloseTo(0.948, 3);
    expect(await StopTransaction.count({ where: { transactionDatabaseId: transaction.id } })).toBe(
      1,
    );
    expect(await MeterValue.count({ where: { stopTransactionDatabaseId: halfWritten.id } })).toBe(
      1,
    );
  });

  it('ignores a resent StopTransaction for an already closed transaction', async () => {
    const transaction = await startTransaction();
    const first = await stop(transaction.id);
    const emitSpy = vi.spyOn((repo as any).stopTransaction, 'emit');

    const second = await stop(transaction.id);

    expect(second.id).toBe(first.id);
    expect(emitSpy).not.toHaveBeenCalled();
    expect(await StopTransaction.count({ where: { transactionDatabaseId: transaction.id } })).toBe(
      1,
    );
    expect(await MeterValue.count({ where: { transactionDatabaseId: transaction.id } })).toBe(3);
  });

  it('serializes two concurrent StopTransactions instead of failing on the unique constraint', async () => {
    const transaction = await startTransaction();

    const [a, b] = await Promise.all([stop(transaction.id), stop(transaction.id)]);

    expect(a.id).toBe(b.id);
    expect((await Transaction.findByPk(transaction.id))!.isActive).toBe(false);
    expect(await StopTransaction.count({ where: { transactionDatabaseId: transaction.id } })).toBe(
      1,
    );
    expect(await MeterValue.count({ where: { transactionDatabaseId: transaction.id } })).toBe(3);
  });
  it('drops only the readings when storing transactionData fails, and still closes the transaction', async () => {
    const transaction = await startTransaction();
    const errorSpy = vi.spyOn((repo as any).logger, 'error');

    await repo.createStopTransaction(
      tenantId,
      transaction.id,
      stationId,
      28724,
      new Date('2026-10-29T09:11:05.000Z'),
      [
        energyReading('2026-10-29T09:11:04.500Z', 28724),
        energyReading('not-a-timestamp', 28724), // rejected by Postgres: aborts the savepoint only
      ] as any,
      'EVDisconnected',
    );

    const closed = (await Transaction.findByPk(transaction.id))!;
    expect(closed.isActive).toBe(false);
    expect(Number(closed.totalKwh)).toBeCloseTo(0.948, 3);
    expect(await StopTransaction.count({ where: { transactionDatabaseId: transaction.id } })).toBe(
      1,
    );
    // The valid reading of the batch is rolled back too: the whole transactionData is dropped.
    expect(await MeterValue.count({ where: { transactionDatabaseId: transaction.id } })).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('transactionData dropped'),
      expect.objectContaining({ droppedMeterValues: 2, droppedSampledValues: 2 }),
    );
  });
  it('rolls back the whole stop when closing the transaction fails', async () => {
    const transaction = await startTransaction();
    vi.spyOn(Transaction.prototype, 'update').mockRejectedValueOnce(new Error('update failed'));

    await expect(stop(transaction.id)).rejects.toThrow('update failed');
    vi.restoreAllMocks();

    expect((await Transaction.findByPk(transaction.id))!.isActive).toBe(true);
    expect(await StopTransaction.count({ where: { transactionDatabaseId: transaction.id } })).toBe(
      0,
    );
    // Only the 2 readings received during the session: the transactionData insert is rolled back too
    expect(await MeterValue.count({ where: { transactionDatabaseId: transaction.id } })).toBe(2);
  });

  describe('1.6 meterStart units (Wh on the wire, kWh on Transaction)', () => {
    const startRequest: OCPP1_6.StartTransactionRequest = {
      connectorId: 1,
      idTag: 'DEADBEEF',
      meterStart: 27776,
      timestamp: '2026-10-29T09:10:35.778Z',
    };

    const startOcpp16Transaction = async () => {
      await Connector.create({
        tenantId,
        stationId,
        connectorId: 1,
        status: 'Available',
        errorCode: 'NoError',
        timestamp: '2026-10-29T09:00:00.000Z',
      } as any);
      (repo as any).chargingStationSequence.getNextSequenceValue = vi.fn().mockResolvedValue(8);
      return repo.createTransactionByStartTransaction(tenantId, startRequest, stationId);
    };

    const meterValuesReading = (timestamp: string, sampledValue: any[]) =>
      ({ timestamp, sampledValue, tenantId, connectorId: 1 }) as any;

    it('stores meterStart in Wh on StartTransaction and in kWh on Transaction', async () => {
      const transaction = await startOcpp16Transaction();

      expect(Number(transaction.meterStart)).toBeCloseTo(27.776, 6);
      expect(Number(transaction.startTransaction!.meterStart)).toBe(27776);
    });

    it('computes the running total in kWh from Wh readings and keeps it on non-energy batches', async () => {
      const transaction = await startOcpp16Transaction();

      await repo.updateTransactionByMeterValues(
        tenantId,
        [
          meterValuesReading('2026-10-29T09:10:55.367Z', [
            {
              value: 28582.15,
              context: 'Sample.Periodic',
              measurand: 'Energy.Active.Import.Register',
              unitOfMeasure: { unit: 'Wh', multiplier: 0 },
            },
          ]),
        ],
        stationId,
        8,
      );
      expect(Number((await Transaction.findByPk(transaction.id))!.totalKwh)).toBeCloseTo(0.806, 3);

      // A batch with only power (no energy register) must not reset the total
      await repo.updateTransactionByMeterValues(
        tenantId,
        [
          meterValuesReading('2026-10-29T09:11:00.000Z', [
            {
              value: 3300,
              context: 'Sample.Periodic',
              measurand: 'Power.Active.Import',
              unitOfMeasure: { unit: 'W', multiplier: 0 },
            },
          ]),
        ],
        stationId,
        8,
      );
      expect(Number((await Transaction.findByPk(transaction.id))!.totalKwh)).toBeCloseTo(0.806, 3);
    });
  });
});
