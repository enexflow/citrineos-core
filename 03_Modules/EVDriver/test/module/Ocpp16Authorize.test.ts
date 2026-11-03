// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { IMessage, IMessageContext } from '@citrineos/base';
import { AuthMethodEnum, AuthorizationStatusEnum, IdTokenEnum, OCPP1_6 } from '@citrineos/base';
import { Logger } from 'tslog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVDriverModule } from '../../src/module/module.js';

type Ocpp16AuthorizeHandler = {
  _handleOCPP16Authorize(message: IMessage<OCPP1_6.AuthorizeRequest>): Promise<void>;
};

const context = { tenantId: 1, stationId: 'cp016' } as IMessageContext;
const message = {
  context,
  payload: { idTag: 'BADGE1' },
} as IMessage<OCPP1_6.AuthorizeRequest>;

describe('EVDriverModule OCPP 1.6 Authorize', () => {
  let readAllByQuerystring: ReturnType<typeof vi.fn>;
  let unknownTokenAuthorize: ReturnType<typeof vi.fn>;
  let sendCallResultWithMessage: ReturnType<typeof vi.fn>;
  let module: EVDriverModule;

  function buildModule(withUnknownTokenAuthorizer = true): EVDriverModule {
    // Skips the constructor, which wires RabbitMQ and Sequelize.
    const instance = Object.create(EVDriverModule.prototype) as EVDriverModule;
    Object.assign(instance, {
      _logger: new Logger({ type: 'hidden' }),
      _authorizeRepository: { readAllByQuerystring },
      _authorizers: [],
      _unknownTokenOcpiAuthorizer: withUnknownTokenAuthorizer
        ? { authorize: unknownTokenAuthorize }
        : undefined,
      sendCallResultWithMessage,
    });
    return instance;
  }

  async function authorize(): Promise<OCPP1_6.AuthorizeResponse> {
    await (module as unknown as Ocpp16AuthorizeHandler)._handleOCPP16Authorize(message);
    return sendCallResultWithMessage.mock.calls[0][1];
  }

  beforeEach(() => {
    readAllByQuerystring = vi.fn().mockResolvedValue([]);
    unknownTokenAuthorize = vi.fn().mockResolvedValue(AuthorizationStatusEnum.Accepted);
    sendCallResultWithMessage = vi.fn().mockResolvedValue({ success: true });
    module = buildModule();
  });

  it('asks partners for an unknown idTag as an RFID badge', async () => {
    const response = await authorize();

    expect(response.idTagInfo.status).toBe(OCPP1_6.AuthorizeResponseStatus.Accepted);
    expect(unknownTokenAuthorize).toHaveBeenCalledWith('BADGE1', IdTokenEnum.ISO14443, context);
  });

  it.each([
    [AuthorizationStatusEnum.Blocked, OCPP1_6.AuthorizeResponseStatus.Blocked],
    [AuthorizationStatusEnum.Expired, OCPP1_6.AuthorizeResponseStatus.Expired],
    [AuthorizationStatusEnum.NoCredit, OCPP1_6.AuthorizeResponseStatus.Invalid],
    [AuthorizationStatusEnum.NotAtThisLocation, OCPP1_6.AuthorizeResponseStatus.Invalid],
    [AuthorizationStatusEnum.Unknown, OCPP1_6.AuthorizeResponseStatus.Invalid],
  ])('maps partner status %s to OCPP 1.6 %s', async (partnerStatus, expected) => {
    unknownTokenAuthorize.mockResolvedValue(partnerStatus);

    expect((await authorize()).idTagInfo.status).toBe(expected);
  });

  it('asks partners again instead of reusing a cached real-time auth', async () => {
    readAllByQuerystring.mockResolvedValue([
      {
        idToken: 'BADGE1',
        status: AuthorizationStatusEnum.Accepted,
        ocpiAuthMethod: AuthMethodEnum.AUTH_REQUEST,
      },
    ]);
    unknownTokenAuthorize.mockResolvedValue(AuthorizationStatusEnum.Blocked);

    expect((await authorize()).idTagInfo.status).toBe(OCPP1_6.AuthorizeResponseStatus.Blocked);
    expect(unknownTokenAuthorize).toHaveBeenCalledOnce();
  });

  it('does not ask partners for a locally known idTag', async () => {
    readAllByQuerystring.mockResolvedValue([
      { idToken: 'BADGE1', status: AuthorizationStatusEnum.Accepted },
    ]);

    expect((await authorize()).idTagInfo.status).toBe(OCPP1_6.AuthorizeResponseStatus.Accepted);
    expect(unknownTokenAuthorize).not.toHaveBeenCalled();
  });

  it('rejects an unknown idTag when no OCPI authorizer is configured', async () => {
    module = buildModule(false);

    expect((await authorize()).idTagInfo.status).toBe(OCPP1_6.AuthorizeResponseStatus.Invalid);
  });
});
