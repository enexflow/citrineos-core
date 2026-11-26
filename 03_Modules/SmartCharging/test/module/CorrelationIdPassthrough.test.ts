// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { OCPP1_6, OCPP2_0_1 } from '@citrineos/base';
import { describe, expect, it, vi } from 'vitest';
import { SmartChargingOcpp16Api } from '../../src/module/1.6/MessageApi.js';
import { SmartChargingOcpp201Api } from '../../src/module/2.0.1/MessageApi.js';

// enexflow fork: callers (ts-api, citrine-ocpp) find the station's reply in OCPPMessages by this id.
const CORRELATION_ID = 'caller-correlation-id';

function anApiStub<T extends object>(apiClass: { prototype: T }) {
  const sendCall = vi.fn().mockResolvedValue({ success: true });
  const api = Object.assign(Object.create(apiClass.prototype), {
    _logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _module: { sendCall },
  }) as T;
  return { api, sendCall };
}

function declaredQuerystrings(apiClass: object, methodName: string) {
  const endpoints = Reflect.getMetadata('METADATA_MESSAGE_ENDPOINTS', apiClass) as {
    methodName: string;
    optionalQuerystrings?: Record<string, unknown>;
  }[];
  return endpoints.find((endpoint) => endpoint.methodName === methodName)?.optionalQuerystrings;
}

describe('SmartCharging 2.0.1 forwards the caller correlationId', () => {
  const cases = [
    {
      method: 'clearChargingProfile',
      request: { chargingProfileId: 9 } as OCPP2_0_1.ClearChargingProfileRequest,
    },
    {
      method: 'getChargingProfiles',
      request: {
        requestId: 1,
        chargingProfile: { chargingProfileId: [9] },
      } as OCPP2_0_1.GetChargingProfilesRequest,
    },
    {
      method: 'getCompositeSchedule',
      request: { evseId: 0, duration: 3600 } as OCPP2_0_1.GetCompositeScheduleRequest,
    },
  ] as const;

  it.each(cases)('$method passes it to sendCall', async ({ method, request }) => {
    const { api, sendCall } = anApiStub(SmartChargingOcpp201Api);

    await (api[method] as (...args: unknown[]) => Promise<unknown>)(
      ['CS-1'],
      request,
      undefined,
      1,
      { correlationId: CORRELATION_ID },
    );

    expect(sendCall).toHaveBeenCalledOnce();
    expect(sendCall.mock.calls[0][6]).toBe(CORRELATION_ID);
  });

  it.each(cases)('$method declares the correlationId querystring', ({ method }) => {
    expect(declaredQuerystrings(SmartChargingOcpp201Api, method)).toHaveProperty('correlationId');
  });
});

describe('SmartCharging 1.6 forwards the caller correlationId', () => {
  const cases = [
    {
      method: 'setChargingProfile',
      request: { connectorId: 0 } as OCPP1_6.SetChargingProfileRequest,
    },
    { method: 'clearChargingProfile', request: { id: 9 } as OCPP1_6.ClearChargingProfileRequest },
    {
      method: 'getCompositeSchedule',
      request: { connectorId: 1, duration: 3600 } as OCPP1_6.GetCompositeScheduleRequest,
    },
  ] as const;

  it.each(cases)('$method passes it to sendCall', async ({ method, request }) => {
    const { api, sendCall } = anApiStub(SmartChargingOcpp16Api);

    await (api[method] as (...args: unknown[]) => Promise<unknown>)(
      ['CS-1'],
      request,
      undefined,
      1,
      { correlationId: CORRELATION_ID },
    );

    expect(sendCall).toHaveBeenCalledOnce();
    expect(sendCall.mock.calls[0][6]).toBe(CORRELATION_ID);
  });

  it.each(cases)('$method declares the correlationId querystring', ({ method }) => {
    expect(declaredQuerystrings(SmartChargingOcpp16Api, method)).toHaveProperty('correlationId');
  });
});
