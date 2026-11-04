// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { OCPP1_6 } from '@citrineos/base';
import type { IMessage, MeterValueDto } from '@citrineos/base';
import { OCPP1_6_Mapper, Transaction } from '@citrineos/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsModule } from '../../src/module/module.js';

// The handlers are exercised on a bare instance: the constructor wires RabbitMQ, Sequelize and
// file storage, none of which the 1.6 StopTransaction / MeterValues handlers touch.
describe('TransactionsModule - OCPP 1.6 handlers', () => {
  const tenantId = 1;
  const stationId = 'cp002';

  let module: any;
  let logger: { debug: any; info: any; warn: any; error: any };
  let transactionEventRepository: {
    createStopTransaction: any;
    updateTransactionByMeterValues: any;
  };

  const message = <T>(payload: T) =>
    ({
      context: { tenantId, stationId, correlationId: 'corr-1' },
      payload,
    }) as unknown as IMessage<T>;

  const rawReading = (timestamp: string, value: string) => ({
    timestamp,
    sampledValue: [
      {
        value,
        measurand: OCPP1_6.MeterValuesRequestMeasurand.Energy_Active_Import_Register,
        unit: OCPP1_6.MeterValuesRequestUnit.Wh,
      },
    ],
  });

  const stopRequest = (
    overrides: Partial<OCPP1_6.StopTransactionRequest> = {},
  ): OCPP1_6.StopTransactionRequest => ({
    transactionId: 8,
    meterStop: 28724,
    timestamp: '2026-10-29T09:11:05.000Z',
    ...overrides,
  });

  beforeEach(() => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    transactionEventRepository = {
      createStopTransaction: vi.fn().mockResolvedValue({ id: 1 }),
      updateTransactionByMeterValues: vi.fn().mockResolvedValue(undefined),
    };
    module = Object.create(TransactionsModule.prototype);
    module._logger = logger;
    module._transactionEventRepository = transactionEventRepository;
    module._authorizeRepository = {
      readOnlyOneByQuerystring: vi.fn().mockResolvedValue(undefined),
      readOnlyOneByQuery: vi.fn(),
    };
    module.sendCallResultWithMessage = vi.fn().mockResolvedValue({ success: true });

    vi.spyOn(Transaction, 'findOne').mockResolvedValue({
      id: 42,
      transactionId: '8',
      isActive: true,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('StopTransaction', () => {
    const handle = (request: OCPP1_6.StopTransactionRequest) =>
      module._handleOcpp16StopTransaction(message(request));

    it('defaults the stopped reason to Local when the station omits it (OCPP 1.6 §4.10)', async () => {
      await handle(stopRequest());

      expect(transactionEventRepository.createStopTransaction).toHaveBeenCalledWith(
        tenantId,
        42,
        stationId,
        28724,
        new Date('2026-10-29T09:11:05.000Z'),
        [],
        OCPP1_6.StopTransactionRequestReason.Local,
        undefined,
      );
    });

    it('keeps the reason sent by the station', async () => {
      await handle(stopRequest({ reason: OCPP1_6.StopTransactionRequestReason.EVDisconnected }));

      expect(transactionEventRepository.createStopTransaction.mock.calls[0][6]).toBe(
        OCPP1_6.StopTransactionRequestReason.EVDisconnected,
      );
    });

    it('answers but does not close again an already-ended transaction', async () => {
      vi.mocked(Transaction.findOne).mockResolvedValue({ id: 42, isActive: false } as any);

      await handle(stopRequest());

      expect(module.sendCallResultWithMessage).toHaveBeenCalledTimes(1);
      expect(transactionEventRepository.createStopTransaction).not.toHaveBeenCalled();
    });

    it('answers but does nothing for an unknown transaction', async () => {
      vi.mocked(Transaction.findOne).mockResolvedValue(null);

      await handle(stopRequest());

      expect(module.sendCallResultWithMessage).toHaveBeenCalledTimes(1);
      expect(transactionEventRepository.createStopTransaction).not.toHaveBeenCalled();
    });

    it('passes the transactionData readings to the close', async () => {
      await handle(
        stopRequest({ transactionData: [rawReading('2026-10-29T09:11:04.500Z', '28724')] }),
      );

      const meterValues: MeterValueDto[] =
        transactionEventRepository.createStopTransaction.mock.calls[0][5];
      expect(meterValues).toHaveLength(1);
      expect(meterValues[0].sampledValue[0].value).toBe(28724);
    });

    it('drops an unparsable reading and still closes with the others', async () => {
      const mapper = vi.spyOn(OCPP1_6_Mapper.MeterValueMapper, 'fromMeterValueType');
      mapper.mockImplementationOnce(() => {
        throw new Error('bad reading');
      });

      await handle(
        stopRequest({
          transactionData: [
            rawReading('2026-10-29T09:11:00.000Z', 'garbage'),
            rawReading('2026-10-29T09:11:04.500Z', '28724'),
          ],
        }),
      );

      const meterValues: MeterValueDto[] =
        transactionEventRepository.createStopTransaction.mock.calls[0][5];
      expect(meterValues).toHaveLength(1);
      expect(meterValues[0].timestamp).toBe('2026-10-29T09:11:04.500Z');
      expect(logger.error).toHaveBeenCalledWith(
        'Dropping unparsable StopTransaction transactionData reading',
        expect.objectContaining({ stationId, readingTimestamp: '2026-10-29T09:11:00.000Z' }),
      );
    });

    it('does not pass readings left without sampled values (SignedData only)', async () => {
      vi.spyOn(OCPP1_6_Mapper.MeterValueMapper, 'fromMeterValueType').mockReturnValueOnce({
        timestamp: '2026-10-29T09:11:00.000Z',
        sampledValue: [] as any,
      });

      await handle(stopRequest({ transactionData: [rawReading('2026-10-29T09:11:00.000Z', '1')] }));

      expect(transactionEventRepository.createStopTransaction.mock.calls[0][5]).toEqual([]);
    });

    it('logs what is needed to close by hand instead of throwing when the close fails', async () => {
      transactionEventRepository.createStopTransaction.mockRejectedValue(new Error('db down'));

      await expect(handle(stopRequest())).resolves.toBeUndefined();

      expect(transactionEventRepository.createStopTransaction).toHaveBeenCalledTimes(1);
      expect(module.sendCallResultWithMessage).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'StopTransaction not stored, transaction left open',
        expect.objectContaining({
          stationId,
          transactionId: 8,
          transactionDatabaseId: 42,
          meterStop: 28724,
          timestamp: '2026-10-29T09:11:05.000Z',
          reason: OCPP1_6.StopTransactionRequestReason.Local,
        }),
      );
    });
  });

  describe('MeterValues', () => {
    const handle = (request: OCPP1_6.MeterValuesRequest) =>
      module._handleOcpp16MeterValues(message(request));

    it('does not store meter values left without sampled values (SignedData only)', async () => {
      vi.spyOn(OCPP1_6_Mapper.MeterValueMapper, 'fromMeterValueType').mockReturnValue({
        timestamp: '2026-10-29T09:11:00.000Z',
        sampledValue: [] as any,
      });

      await handle({
        connectorId: 1,
        transactionId: 8,
        meterValue: [rawReading('2026-10-29T09:11:00.000Z', '1')],
      });

      expect(transactionEventRepository.updateTransactionByMeterValues).not.toHaveBeenCalled();
      expect(module.sendCallResultWithMessage).toHaveBeenCalledTimes(1);
    });

    it('stores only the meter values that still have sampled values', async () => {
      vi.spyOn(OCPP1_6_Mapper.MeterValueMapper, 'fromMeterValueType').mockReturnValueOnce({
        timestamp: '2026-10-29T09:11:00.000Z',
        sampledValue: [] as any,
      });

      await handle({
        connectorId: 1,
        transactionId: 8,
        meterValue: [
          rawReading('2026-10-29T09:11:00.000Z', '1'),
          rawReading('2026-10-29T09:11:10.000Z', '28650'),
        ],
      });

      const [, stored, , transactionId] =
        transactionEventRepository.updateTransactionByMeterValues.mock.calls[0];
      expect(transactionId).toBe(8);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ tenantId, connectorId: 1 });
      expect(stored[0].sampledValue[0].value).toBe(28650);
    });
  });
});
