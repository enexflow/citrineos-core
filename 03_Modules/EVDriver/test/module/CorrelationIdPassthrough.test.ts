// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { OCPP1_6 } from '@citrineos/base';
import { describe, expect, it, vi } from 'vitest';
import { EVDriverOcpp16Api } from '../../src/module/1.6/MessageApi.js';

// enexflow fork: callers (ts-api, citrine-ocpp) find the station's reply in OCPPMessages by this id.
const CORRELATION_ID = 'caller-correlation-id';

describe('EVDriver 1.6 forwards the caller correlationId', () => {
  const cases = [
    {
      method: 'remoteStartTransaction',
      request: { connectorId: 1, idTag: 'DEADBEEF' } as OCPP1_6.RemoteStartTransactionRequest,
    },
    {
      method: 'remoteStopTransaction',
      request: { transactionId: 42 } as OCPP1_6.RemoteStopTransactionRequest,
    },
  ] as const;

  it.each(cases)('$method passes it to sendCall', async ({ method, request }) => {
    const sendCall = vi.fn().mockResolvedValue({ success: true });
    const api = Object.assign(Object.create(EVDriverOcpp16Api.prototype), {
      _module: { sendCall },
    }) as EVDriverOcpp16Api;

    await api[method](['CS-1'], request as never, undefined, 1, {
      correlationId: CORRELATION_ID,
    });

    expect(sendCall).toHaveBeenCalledOnce();
    expect(sendCall.mock.calls[0][6]).toBe(CORRELATION_ID);
  });

  it.each(cases)('$method declares the correlationId querystring', ({ method }) => {
    const endpoints = Reflect.getMetadata('METADATA_MESSAGE_ENDPOINTS', EVDriverOcpp16Api) as {
      methodName: string;
      optionalQuerystrings?: Record<string, unknown>;
    }[];
    const endpoint = endpoints.find((candidate) => candidate.methodName === method);

    expect(endpoint?.optionalQuerystrings).toHaveProperty('correlationId');
  });
});
