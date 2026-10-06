// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { IMessageContext, SystemConfig } from '@citrineos/base';
import { AuthorizationStatusEnum, IdTokenEnum } from '@citrineos/base';
import type { ILocationRepository } from '@citrineos/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnknownTokenOcpiAuthorizer } from '../../src/authorizer/UnknownTokenOcpiAuthorizer.js';

const context = { tenantId: 1, stationId: 'cp001' } as IMessageContext;
const config = {
  ocpiServer: { host: 'ocpi', port: 8085, version: '2.2.1', adminToken: 'admin' },
} as unknown as SystemConfig;

function okResponse(allowed: string): Response {
  return new Response(JSON.stringify({ timestamp: '2026-10-06T00:00:00Z', data: { allowed } }), {
    status: 200,
  });
}

describe('UnknownTokenOcpiAuthorizer', () => {
  let locationRepository: {
    readChargingStationByStationId: ReturnType<typeof vi.fn>;
    readByKey: ReturnType<typeof vi.fn>;
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let authorizer: UnknownTokenOcpiAuthorizer;

  beforeEach(() => {
    locationRepository = {
      readChargingStationByStationId: vi.fn().mockResolvedValue({ id: 'cp001', locationId: 42 }),
      readByKey: vi.fn().mockResolvedValue({ id: 42, disableOCPI: false }),
    };
    fetchMock = vi.fn().mockResolvedValue(okResponse('ALLOWED'));
    vi.stubGlobal('fetch', fetchMock);
    authorizer = new UnknownTokenOcpiAuthorizer(
      locationRepository as unknown as ILocationRepository,
      config,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips partners when OCPI is disabled on the station location', async () => {
    locationRepository.readByKey.mockResolvedValue({ id: 42, disableOCPI: true });

    const status = await authorizer.authorize('TOKEN1', IdTokenEnum.ISO14443, context);

    expect(status).toBe(AuthorizationStatusEnum.Unknown);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the OCPI module for the tenant without pinning a partner', async () => {
    const status = await authorizer.authorize('TOKEN1', IdTokenEnum.ISO14443, context);

    expect(status).toBe(AuthorizationStatusEnum.Accepted);
    expect(locationRepository.readByKey).toHaveBeenCalledWith(1, 42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ocpi:8085/ocpi/emsp/2.2.1/tokens/realTimeAuth');
    expect(init.headers.Authorization).toBe('Token admin');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      tenantId: 1,
      idToken: 'TOKEN1',
      idTokenType: IdTokenEnum.ISO14443,
      locationId: '42',
      stationId: 'cp001',
    });
  });

  it('still asks partners for a station without a location', async () => {
    locationRepository.readChargingStationByStationId.mockResolvedValue(undefined);

    const status = await authorizer.authorize('TOKEN1', IdTokenEnum.ISO14443, context);

    expect(status).toBe(AuthorizationStatusEnum.Accepted);
    expect(locationRepository.readByKey).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).locationId).toBeUndefined();
  });

  it.each([
    ['BLOCKED', AuthorizationStatusEnum.Blocked],
    ['EXPIRED', AuthorizationStatusEnum.Expired],
    ['NO_CREDIT', AuthorizationStatusEnum.NoCredit],
    ['NOT_ALLOWED', AuthorizationStatusEnum.NotAtThisLocation],
    ['SOMETHING_ELSE', AuthorizationStatusEnum.Unknown],
  ])('maps OCPI %s to %s', async (allowed, expected) => {
    fetchMock.mockResolvedValue(okResponse(allowed));

    expect(await authorizer.authorize('TOKEN1', IdTokenEnum.ISO14443, context)).toBe(expected);
  });

  it('returns Unknown when the OCPI module answers an HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    expect(await authorizer.authorize('TOKEN1', IdTokenEnum.ISO14443, context)).toBe(
      AuthorizationStatusEnum.Unknown,
    );
  });

  it('returns Unknown when the OCPI module times out', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    expect(await authorizer.authorize('TOKEN1', IdTokenEnum.ISO14443, context)).toBe(
      AuthorizationStatusEnum.Unknown,
    );
  });
});
