// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'tslog';
import type { ILogObj } from 'tslog';
import { describe, expect, it, vi } from 'vitest';
import {
  AbstractModule,
  EventGroup,
  Message,
  MessageOrigin,
  MessageState,
  OCPP2_0_1,
  OCPP2_0_1_CallAction,
  OCPPVersion,
} from '../../src/index.js';
import type { ICache, IMessageHandler, IMessageSender, SystemConfig } from '../../src/index.js';
import type { OCPPValidator } from '../../src/interfaces/modules/OCPPValidator.js';

const PASSWORD = 'S3cret-Station-Password!';

class ModuleWithoutHandlers extends AbstractModule {}

function aModule() {
  const validator = {
    sanitizeOCPPPayload: (payload: unknown) => payload,
    validateOCPPRequest: () => ({ isValid: true }),
  } as unknown as OCPPValidator;
  const sender = { sendResponse: vi.fn().mockResolvedValue(undefined) };
  const module = new ModuleWithoutHandlers(
    {} as SystemConfig,
    {} as ICache,
    {} as IMessageHandler,
    sender as unknown as IMessageSender,
    EventGroup.Reporting,
    new Logger<ILogObj>({ minLevel: 7 }),
    validator,
  );
  return { module, sender };
}

describe('AbstractModule', () => {
  it('never logs a station password reported in a message whose handling fails', async () => {
    const { module, sender } = aModule();
    const logError = vi.spyOn((module as any)._logger, 'error');
    const payload: OCPP2_0_1.NotifyReportRequest = {
      requestId: 1,
      generatedAt: '2026-10-13T00:00:00Z',
      seqNo: 0,
      reportData: [
        {
          component: { name: 'SecurityCtrlr' },
          variable: { name: 'BasicAuthPassword' },
          variableAttribute: [{ value: PASSWORD }],
        },
      ],
    };
    const message = new Message(
      MessageOrigin.ChargingStation,
      EventGroup.Reporting,
      OCPP2_0_1_CallAction.NotifyReport,
      MessageState.Request,
      { stationId: 'cp001', tenantId: 1, correlationId: 'c-1', timestamp: '' },
      payload,
      OCPPVersion.OCPP2_0_1,
    );

    await module.handle(message);

    expect(sender.sendResponse).toHaveBeenCalledTimes(1);
    const failure = logError.mock.calls.find(([text]) => text === 'Failed handling message: ');
    expect(failure).toBeDefined();
    const logged = JSON.stringify(failure);
    expect(logged).toContain('NotifyReport');
    expect(logged).not.toContain(PASSWORD);
  });
});
