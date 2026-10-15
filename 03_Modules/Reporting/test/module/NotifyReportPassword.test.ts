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
import { describe, expect, it, vi } from 'vitest';
import { ReportingModule } from '../../src/module/module.js';

const PASSWORD = 'S3cret-Station-Password!';

function aNotifyReport() {
  const payload: OCPP2_0_1.NotifyReportRequest = {
    requestId: 1,
    generatedAt: '2026-10-13T00:00:00.000Z',
    seqNo: 0,
    reportData: [
      {
        component: { name: 'SecurityCtrlr' },
        variable: { name: 'BasicAuthPassword' },
        variableAttribute: [
          {
            type: OCPP2_0_1.AttributeEnumType.Actual,
            value: PASSWORD,
            mutability: OCPP2_0_1.MutabilityEnumType.WriteOnly,
          },
        ],
        variableCharacteristics: {
          dataType: OCPP2_0_1.DataEnumType.passwordString,
          supportsMonitoring: false,
        },
      },
      {
        component: { name: 'OCPPCommCtrlr' },
        variable: { name: 'HeartbeatInterval' },
        variableAttribute: [{ type: OCPP2_0_1.AttributeEnumType.Actual, value: '60' }],
      },
    ],
  };
  return RequestBuilder.buildCall(
    'station-1',
    'report-1',
    1,
    OCPP2_0_1_CallAction.NotifyReport,
    payload,
    EventGroup.Reporting,
    MessageOrigin.ChargingStation,
    OCPPVersion.OCPP2_0_1,
  );
}

// Handlers are invoked on a stub so the test needs neither a broker nor a database.
function aReportingModuleStub() {
  return {
    _logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _deviceModelRepository: {
      createOrUpdateDeviceModelByStationId: vi.fn().mockResolvedValue([]),
      updateResultByStationId: vi.fn(),
    },
    _cache: { set: vi.fn().mockResolvedValue(true) },
    sendCallResultWithMessage: vi.fn().mockResolvedValue({ success: true }),
    config: { maxCachingSeconds: 10 },
  };
}

describe('ReportingModule NotifyReport password handling (TECH-2381)', () => {
  it('should not pass a station-reported password to the device model', async () => {
    const module = aReportingModuleStub();

    await (ReportingModule.prototype as any)._handleNotifyReport.call(module, aNotifyReport());

    const calls = module._deviceModelRepository.createOrUpdateDeviceModelByStationId.mock.calls;
    expect(calls).toHaveLength(2);
    const [passwordAttribute] = calls[0][1].variableAttribute;
    expect('value' in passwordAttribute).toBe(false);
    expect(passwordAttribute.mutability).toBe(OCPP2_0_1.MutabilityEnumType.WriteOnly);
    expect(calls[1][1].variableAttribute[0].value).toBe('60');
  });

  it('should not log a station-reported password', async () => {
    const module = aReportingModuleStub();

    await (ReportingModule.prototype as any)._handleNotifyReport.call(module, aNotifyReport());

    expect(module._logger.info).toHaveBeenCalledWith(
      'NotifyReport received:',
      expect.anything(),
      undefined,
    );
    expect(JSON.stringify(module._logger.info.mock.calls)).not.toContain(PASSWORD);
  });
});
