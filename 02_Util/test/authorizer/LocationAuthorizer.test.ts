// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { IMessageContext, LocationAuthorizationModeType, SystemConfig } from '@citrineos/base';
import { AuthMethodEnum, AuthorizationStatusEnum, IdTokenEnum } from '@citrineos/base';
import type { Authorization, ILocationRepository } from '@citrineos/data';
import { Logger, type ILogObj } from 'tslog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationAuthorizer } from '../../src/authorizer/LocationAuthorizer.js';

const STATION_LOCATION_ID = 42;
const context = { tenantId: 1, stationId: 'cp001' } as IMessageContext;

function anAuthorization(overrides: Partial<Record<string, unknown>> = {}): Authorization & {
  save: ReturnType<typeof vi.fn>;
} {
  return {
    id: 7,
    idToken: 'BADGE1',
    idTokenType: IdTokenEnum.ISO14443,
    status: AuthorizationStatusEnum.Accepted,
    tenantPartnerId: null,
    ocpiAuthMethod: null,
    locations: [{ locationId: STATION_LOCATION_ID }],
    save: vi.fn(),
    ...overrides,
  } as unknown as Authorization & { save: ReturnType<typeof vi.fn> };
}

describe('LocationAuthorizer', () => {
  let locationRepository: { readChargingStationByStationId: ReturnType<typeof vi.fn> };
  let logger: Logger<ILogObj>;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function anAuthorizer(mode: LocationAuthorizationModeType = 'enforce'): LocationAuthorizer {
    return new LocationAuthorizer(
      locationRepository as unknown as ILocationRepository,
      { locationAuthorizationMode: mode } as unknown as SystemConfig,
      logger,
    );
  }

  beforeEach(() => {
    locationRepository = {
      readChargingStationByStationId: vi
        .fn()
        .mockResolvedValue({ id: 'cp001', locationId: STATION_LOCATION_ID }),
    };
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    const subLogger = { warn: warnSpy, error: errorSpy, debug: vi.fn(), info: vi.fn() };
    logger = { getSubLogger: () => subLogger } as unknown as Logger<ILogObj>;
  });

  describe('enforce', () => {
    it('refuses a badge with no location', async () => {
      const authorization = anAuthorization({ locations: [] });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).toBe(AuthorizationStatusEnum.NotAtThisLocation);
      expect(locationRepository.readChargingStationByStationId).toHaveBeenCalledWith(1, 'cp001');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('accepts a badge allowed at the station location', async () => {
      const authorization = anAuthorization({
        locations: [{ locationId: 1 }, { locationId: STATION_LOCATION_ID }],
      });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).toBe(AuthorizationStatusEnum.Accepted);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('refuses a badge allowed only at another location', async () => {
      const authorization = anAuthorization({ locations: [{ locationId: 1 }] });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).toBe(AuthorizationStatusEnum.NotAtThisLocation);
    });

    it('checks MacAddress tokens', async () => {
      const authorization = anAuthorization({
        idTokenType: IdTokenEnum.MacAddress,
        locations: [],
      });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).toBe(AuthorizationStatusEnum.NotAtThisLocation);
    });

    it('refuses when the authorization locations were not loaded', async () => {
      const authorization = anAuthorization({ locations: undefined });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).not.toBe(AuthorizationStatusEnum.Accepted);
      expect(errorSpy).toHaveBeenCalled();
      expect(locationRepository.readChargingStationByStationId).not.toHaveBeenCalled();
    });

    it('refuses when the station has no locationId', async () => {
      locationRepository.readChargingStationByStationId.mockResolvedValue({
        id: 'cp001',
        locationId: null,
      });

      const status = await anAuthorizer().authorize(anAuthorization(), context);

      expect(status).toBe(AuthorizationStatusEnum.NotAtThisLocation);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('refuses when the station is unknown', async () => {
      locationRepository.readChargingStationByStationId.mockResolvedValue(undefined);

      const status = await anAuthorizer().authorize(anAuthorization(), context);

      expect(status).toBe(AuthorizationStatusEnum.NotAtThisLocation);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('out of scope tokens pass through', () => {
    it.each([
      ['partner token', { tenantPartnerId: 3 }],
      ['remote start command', { ocpiAuthMethod: AuthMethodEnum.COMMAND }],
      ['real-time auth request', { ocpiAuthMethod: AuthMethodEnum.AUTH_REQUEST }],
      ['Central token (Payter, auto-repair)', { idTokenType: IdTokenEnum.Central }],
      ['eMAID token', { idTokenType: IdTokenEnum.eMAID }],
      ['untyped token', { idTokenType: null }],
    ])('%s', async (_label, overrides) => {
      const authorization = anAuthorization({ ...overrides, locations: [] });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).toBe(AuthorizationStatusEnum.Accepted);
      expect(locationRepository.readChargingStationByStationId).not.toHaveBeenCalled();
    });

    it('accepts a WHITELIST badge only when the location matches', async () => {
      const authorization = anAuthorization({
        ocpiAuthMethod: AuthMethodEnum.WHITELIST,
        locations: [],
      });

      const status = await anAuthorizer().authorize(authorization, context);

      expect(status).toBe(AuthorizationStatusEnum.NotAtThisLocation);
    });
  });

  it.each([
    AuthorizationStatusEnum.Blocked,
    AuthorizationStatusEnum.Expired,
    AuthorizationStatusEnum.Invalid,
  ])('returns a %s status unchanged', async (inputStatus) => {
    const authorization = anAuthorization({ status: inputStatus, locations: [] });

    const status = await anAuthorizer().authorize(authorization, context);

    expect(status).toBe(inputStatus);
    expect(locationRepository.readChargingStationByStationId).not.toHaveBeenCalled();
  });

  describe('log-only', () => {
    it('accepts a badge with no location and logs a warning', async () => {
      const status = await anAuthorizer('log-only').authorize(
        anAuthorization({ locations: [] }),
        context,
      );

      expect(status).toBe(AuthorizationStatusEnum.Accepted);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[log-only] would refuse'));
    });

    it('accepts a badge at another location and logs a warning', async () => {
      const status = await anAuthorizer('log-only').authorize(
        anAuthorization({ locations: [{ locationId: 1 }] }),
        context,
      );

      expect(status).toBe(AuthorizationStatusEnum.Accepted);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('accepts and logs an error when the station has no locationId', async () => {
      locationRepository.readChargingStationByStationId.mockResolvedValue({ locationId: null });

      const status = await anAuthorizer('log-only').authorize(anAuthorization(), context);

      expect(status).toBe(AuthorizationStatusEnum.Accepted);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('keeps a non-Accepted status', async () => {
      const status = await anAuthorizer('log-only').authorize(
        anAuthorization({ status: AuthorizationStatusEnum.Blocked, locations: [] }),
        context,
      );

      expect(status).toBe(AuthorizationStatusEnum.Blocked);
    });
  });

  it('skips every check when off', async () => {
    const status = await anAuthorizer('off').authorize(anAuthorization({ locations: [] }), context);

    expect(status).toBe(AuthorizationStatusEnum.Accepted);
    expect(locationRepository.readChargingStationByStationId).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('defaults to log-only when the mode is not configured', async () => {
    const authorizer = new LocationAuthorizer(
      locationRepository as unknown as ILocationRepository,
      {} as SystemConfig,
      logger,
    );

    const status = await authorizer.authorize(anAuthorization({ locations: [] }), context);

    expect(status).toBe(AuthorizationStatusEnum.Accepted);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never saves the authorization', async () => {
    const authorizations = [
      anAuthorization(),
      anAuthorization({ locations: [] }),
      anAuthorization({ locations: [{ locationId: 1 }] }),
      anAuthorization({ locations: undefined }),
      anAuthorization({ tenantPartnerId: 3 }),
    ];
    for (const mode of ['off', 'log-only', 'enforce'] as const) {
      for (const authorization of authorizations) {
        await anAuthorizer(mode).authorize(authorization, context);
      }
    }

    for (const authorization of authorizations) {
      expect(authorization.save).not.toHaveBeenCalled();
    }
  });
});
