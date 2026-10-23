// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  EventGroup,
  MessageOrigin,
  OCPP2_0_1,
  OCPP2_0_1_CallAction,
  OCPPVersion,
  RequestBuilder,
} from '@citrineos/base';
import { MemoryCache } from '@citrineos/util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartChargingModule } from '../../src/module/module.js';

function aSetChargingProfileResponse(
  stationId: string,
  status: OCPP2_0_1.ChargingProfileStatusEnumType,
) {
  return RequestBuilder.buildCallResult(
    stationId,
    'correlation-1',
    1,
    OCPP2_0_1_CallAction.SetChargingProfile,
    { status } as OCPP2_0_1.SetChargingProfileResponse,
    EventGroup.SmartCharging,
    MessageOrigin.ChargingStation,
    OCPPVersion.OCPP2_0_1,
  );
}

// Handlers are invoked on a stub so the test needs neither a broker nor a database.
function aSmartChargingModuleStub() {
  return Object.assign(Object.create(SmartChargingModule.prototype), {
    _logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _cache: new MemoryCache(),
    _chargingProfileRepository: { updateAllByQuery: vi.fn().mockResolvedValue([]) },
    _idGenerator: { generateRequestId: vi.fn().mockResolvedValue(42) },
    sendCall: vi.fn().mockResolvedValue({ success: true }),
  });
}

async function handle(module: unknown, stationId: string, status = 'Accepted') {
  await (SmartChargingModule.prototype as any)._handleSetChargingProfile.call(
    module,
    aSetChargingProfileResponse(stationId, status as OCPP2_0_1.ChargingProfileStatusEnumType),
  );
}

describe('SmartChargingModule SetChargingProfile refresh (TECH-2550)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should send one GetChargingProfiles for a burst of accepted SetChargingProfile', async () => {
    const module = aSmartChargingModuleStub();

    await handle(module, 'K0032128');
    await handle(module, 'K0032128');
    await handle(module, 'K0032128');
    expect(module.sendCall).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(module._chargingProfileRepository.updateAllByQuery).toHaveBeenCalledTimes(1);
    expect(module.sendCall).toHaveBeenCalledTimes(1);
    expect(module.sendCall).toHaveBeenCalledWith(
      'K0032128',
      1,
      OCPPVersion.OCPP2_0_1,
      OCPP2_0_1_CallAction.GetChargingProfiles,
      {
        requestId: 42,
        chargingProfile: { chargingLimitSource: [OCPP2_0_1.ChargingLimitSourceEnumType.CSO] },
      },
    );
  });

  it('should refresh again for a SetChargingProfile accepted after the window', async () => {
    const module = aSmartChargingModuleStub();

    await handle(module, 'K0032128');
    await vi.advanceTimersByTimeAsync(5_000);
    await handle(module, 'K0032128');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(module.sendCall).toHaveBeenCalledTimes(2);
  });

  it('should refresh each station independently', async () => {
    const module = aSmartChargingModuleStub();

    await handle(module, 'K0032128');
    await handle(module, '24BZ4403C');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(module.sendCall).toHaveBeenCalledTimes(2);
  });

  it('should not refresh after a rejected SetChargingProfile', async () => {
    const module = aSmartChargingModuleStub();

    await handle(module, 'K0032128', 'Rejected');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(module.sendCall).not.toHaveBeenCalled();
  });

  it('should log a failed refresh instead of rejecting unhandled', async () => {
    const module = aSmartChargingModuleStub();
    module.sendCall.mockRejectedValue(new Error('broker down'));

    await handle(module, 'K0032128');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(module._logger.error).toHaveBeenCalledWith(
      'Failed to refresh charging profiles of station K0032128: Error: broker down',
    );
  });
});
