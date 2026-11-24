// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  Authenticator,
  BasicAuthenticationFilter,
  NetworkProfileFilter,
  UnknownStationFilter,
} from '../../../src';
import { faker } from '@faker-js/faker';
import { aRequest } from '../../providers/IncomingMessageProvider.js';
import { anAuthenticationOptions } from '../../providers/AuthenticationOptionsProvider.js';
import { DEFAULT_TENANT_ID } from '@citrineos/base';
import { afterEach, beforeEach, describe, expect, it, Mocked, vi } from 'vitest';

describe('Authenticator', () => {
  let unknownStationFilter: Mocked<UnknownStationFilter>;
  let networkProfileFilter: Mocked<NetworkProfileFilter>;
  let basicAuthenticationFilter: Mocked<BasicAuthenticationFilter>;
  let authenticator: Authenticator;

  beforeEach(() => {
    unknownStationFilter = {
      authenticate: vi.fn(),
    } as unknown as Mocked<UnknownStationFilter>;

    networkProfileFilter = {
      authenticate: vi.fn(),
    } as unknown as Mocked<NetworkProfileFilter>;

    basicAuthenticationFilter = {
      authenticate: vi.fn(),
    } as unknown as Mocked<BasicAuthenticationFilter>;

    authenticator = new Authenticator(
      unknownStationFilter,
      networkProfileFilter,
      basicAuthenticationFilter,
    );
  });

  afterEach(() => {
    unknownStationFilter.authenticate.mockReset();
    networkProfileFilter.authenticate.mockReset();
    basicAuthenticationFilter.authenticate.mockReset();
  });

  it('should reject when unknown station filter rejects', async () => {
    const stationId = faker.string.uuid().toString();
    unknownStationFilter.authenticate.mockRejectedValue(new Error('Unknown station'));

    await expect(
      authenticator.authenticate(
        aRequest({ url: `wss://citrineos.io/${stationId}` }),
        DEFAULT_TENANT_ID,
        anAuthenticationOptions(),
      ),
    ).rejects.toThrow();

    expect(networkProfileFilter.authenticate).not.toHaveBeenCalled();
    expect(basicAuthenticationFilter.authenticate).not.toHaveBeenCalled();
  });

  it('should reject when network profile filter rejects', async () => {
    const stationId = faker.string.uuid().toString();
    unknownStationFilter.authenticate.mockResolvedValue(undefined);
    networkProfileFilter.authenticate.mockRejectedValue(new Error('Unauthorized'));

    await expect(
      authenticator.authenticate(
        aRequest({ url: `wss://citrineos.io/${stationId}` }),
        DEFAULT_TENANT_ID,
        anAuthenticationOptions(),
      ),
    ).rejects.toThrow();

    expect(basicAuthenticationFilter.authenticate).not.toHaveBeenCalled();
  });

  it('should reject when basic authentication filter rejects', async () => {
    const stationId = faker.string.uuid().toString();
    unknownStationFilter.authenticate.mockResolvedValue(undefined);
    networkProfileFilter.authenticate.mockResolvedValue(undefined);
    basicAuthenticationFilter.authenticate.mockRejectedValue(new Error('Unauthorized'));

    await expect(async () => {
      await authenticator.authenticate(
        aRequest({ url: `wss://citrineos.io/${stationId}` }),
        DEFAULT_TENANT_ID,
        anAuthenticationOptions(),
      );
    }).rejects.toThrow();
  });

  it('should return identifier when all filters pass', async () => {
    const stationId = faker.string.uuid().toString();
    unknownStationFilter.authenticate.mockResolvedValue(undefined);
    networkProfileFilter.authenticate.mockResolvedValue(undefined);
    basicAuthenticationFilter.authenticate.mockResolvedValue(undefined);

    const identifier = await authenticator.authenticate(
      aRequest({ url: `wss://citrineos.io/${stationId}` }),
      DEFAULT_TENANT_ID,
      anAuthenticationOptions(),
    );

    expect(identifier).toEqual({ identifier: stationId });
  });
});
