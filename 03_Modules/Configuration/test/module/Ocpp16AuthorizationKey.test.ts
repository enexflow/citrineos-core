// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  EventGroup,
  MASKED_SECRET,
  MessageOrigin,
  OCPP1_6,
  OCPP1_6_CallAction,
  OCPPVersion,
  RequestBuilder,
} from '@citrineos/base';
import { ChargingStation } from '@citrineos/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationModule } from '../../src/module/module.js';

const PASSWORD = '0123456789abcdef0123456789abcdef';
const STATION_ID = 'station-1';
const TENANT_ID = 1;

// Handlers are invoked on a stub so the test needs neither a broker nor a database.
function aConfigurationModuleStub() {
  return {
    _logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _config: { maxCachingSeconds: 10 },
    _cache: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      onChange: vi.fn().mockResolvedValue(null),
    },
    _ocppMessageRepository: { readOnlyOneByQuery: vi.fn() },
    _changeConfigurationRepository: {
      createOrUpdateChangeConfiguration: vi.fn().mockResolvedValue({}),
      readAllByQuery: vi.fn().mockResolvedValue([]),
    },
    _bootService: {
      createOcpp16BootNotificationResponse: vi
        .fn()
        .mockResolvedValue({ status: OCPP1_6.BootNotificationResponseStatus.Pending }),
      cacheOcpp16ChargerActionsPermissions: vi.fn(),
      updateOcpp16BootConfig: vi.fn().mockResolvedValue({ id: 1 }),
    },
    _bootRepository: { updateByKey: vi.fn() },
    _locationRepository: { createOrUpdateChargingStation: vi.fn().mockResolvedValue({}) },
    sendCall: vi.fn().mockResolvedValue({ success: true }),
    sendCallResultWithMessage: vi.fn().mockResolvedValue({ success: true }),
  };
}

function aResponse(action: OCPP1_6_CallAction, payload: object) {
  return RequestBuilder.buildCallResult(
    STATION_ID,
    'corr-1',
    TENANT_ID,
    action,
    payload,
    EventGroup.Configuration,
    MessageOrigin.ChargingStation,
    OCPPVersion.OCPP1_6,
  );
}

function handler(name: string) {
  return (ConfigurationModule.prototype as any)[name] as (...args: unknown[]) => Promise<void>;
}

describe('ConfigurationModule OCPP 1.6 AuthorizationKey (TECH-2381)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not store an accepted AuthorizationKey change', async () => {
    const module = aConfigurationModuleStub();
    module._ocppMessageRepository.readOnlyOneByQuery.mockResolvedValue({
      message: [
        2,
        'corr-1',
        'ChangeConfiguration',
        { key: 'AuthorizationKey', value: MASKED_SECRET },
      ],
    });

    await handler('_handleOcpp16ChangeConfiguration').call(
      module,
      aResponse(OCPP1_6_CallAction.ChangeConfiguration, { status: 'Accepted' }),
    );

    expect(
      module._changeConfigurationRepository.createOrUpdateChangeConfiguration,
    ).not.toHaveBeenCalled();
  });

  it('should still store other accepted configuration changes', async () => {
    const module = aConfigurationModuleStub();
    module._ocppMessageRepository.readOnlyOneByQuery.mockResolvedValue({
      message: [2, 'corr-1', 'ChangeConfiguration', { key: 'HeartbeatInterval', value: '60' }],
    });

    await handler('_handleOcpp16ChangeConfiguration').call(
      module,
      aResponse(OCPP1_6_CallAction.ChangeConfiguration, { status: 'Accepted' }),
    );

    expect(
      module._changeConfigurationRepository.createOrUpdateChangeConfiguration,
    ).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ key: 'HeartbeatInterval', value: '60' }),
    );
  });

  it('should not store an AuthorizationKey reported by GetConfiguration', async () => {
    const module = aConfigurationModuleStub();

    await handler('_handleOcpp16GetConfiguration').call(
      module,
      aResponse(OCPP1_6_CallAction.GetConfiguration, {
        configurationKey: [
          { key: 'HeartbeatInterval', readonly: false, value: '60' },
          { key: 'AuthorizationKey', readonly: false, value: PASSWORD },
        ],
      }),
    );

    const stored =
      module._changeConfigurationRepository.createOrUpdateChangeConfiguration.mock.calls;
    expect(stored).toHaveLength(1);
    expect(stored[0][1]).toMatchObject({ key: 'HeartbeatInterval', value: '60' });
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
  });

  it('should not replay a stored AuthorizationKey on a pending boot', async () => {
    vi.spyOn(ChargingStation, 'build').mockReturnValue({} as ChargingStation);
    const module = aConfigurationModuleStub();
    module._changeConfigurationRepository.readAllByQuery.mockResolvedValue([
      { key: 'AuthorizationKey', value: PASSWORD },
      { key: 'HeartbeatInterval', value: '60' },
    ]);
    const bootNotification = RequestBuilder.buildCall(
      STATION_ID,
      'boot-1',
      TENANT_ID,
      OCPP1_6_CallAction.BootNotification,
      { chargePointVendor: 'Vendor', chargePointModel: 'Model' },
      EventGroup.Configuration,
      MessageOrigin.ChargingStation,
      OCPPVersion.OCPP1_6,
    );

    await handler('_handleOcpp16BootNotification').call(module, bootNotification);

    const changeConfigurationCalls = module.sendCall.mock.calls.filter(
      (call) => call[3] === OCPP1_6_CallAction.ChangeConfiguration,
    );
    expect(changeConfigurationCalls).toHaveLength(1);
    expect(changeConfigurationCalls[0][4]).toEqual({ key: 'HeartbeatInterval', value: '60' });
    expect(JSON.stringify(module.sendCall.mock.calls)).not.toContain(PASSWORD);
  });
});
