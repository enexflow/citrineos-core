// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import Fastify from 'fastify';
import { Logger } from 'tslog';
import type { ILogObj } from 'tslog';
import { afterEach, describe, expect, it } from 'vitest';
import { AbstractModuleApi, AsDataEndpoint, HttpMethod, Namespace } from '../../src/index.js';
import type { IModule, SystemConfig } from '../../src/index.js';

const FAKE_CLIENT_SECRET = 'fake-oidc-client-secret';
const FAKE_BROKER_PASSWORD = 'fake-broker-password';
const TOKEN_URL = 'https://idp.example/token';
const SYSTEM_CONFIG_URL = '/data/test/systemConfig';

class DataApi extends AbstractModuleApi<IModule> {
  @AsDataEndpoint(Namespace.BootConfig, HttpMethod.Get)
  async getBootConfig(): Promise<object> {
    return {};
  }

  protected _toDataPath(input: Namespace): string {
    return super._toDataPath(input, 'test');
  }
}

function aConfig(util: Record<string, unknown> = {}): SystemConfig {
  return {
    oidcClient: {
      tokenUrl: TOKEN_URL,
      clientId: 'fake-client-id',
      clientSecret: FAKE_CLIENT_SECRET,
      audience: 'fake-audience',
    },
    util: {
      messageBroker: {
        amqp: {
          url: `amqp://broker-user:${FAKE_BROKER_PASSWORD}@broker.example:5672`,
          exchange: 'citrineos',
        },
      },
      ...util,
    },
  } as unknown as SystemConfig;
}

describe('AbstractModuleApi system config routes', () => {
  let server: ReturnType<typeof Fastify> | undefined;

  const start = async (config: SystemConfig) => {
    server = Fastify();
    // The constructor registers the routes on the server.
    new DataApi({ config } as IModule, server, null, new Logger<ILogObj>({ minLevel: 7 }));
    await server.ready();
    return server;
  };

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves the system config without credentials', async () => {
    const app = await start(aConfig());

    const response = await app.inject({ method: 'GET', url: SYSTEM_CONFIG_URL });

    expect(response.statusCode).toBe(200);
    expect(response.json().oidcClient.tokenUrl).toBe(TOKEN_URL);
    expect(response.json().util.messageBroker.amqp.url).toContain('broker-user:');
    expect(response.body).not.toContain(FAKE_CLIENT_SECRET);
    expect(response.body).not.toContain(FAKE_BROKER_PASSWORD);
  });

  it.each([{}, { allowSystemConfigUpdate: false }])(
    'does not register the system config update route with util %j',
    async (util) => {
      const app = await start(aConfig(util));

      expect(app.hasRoute({ method: 'GET', url: SYSTEM_CONFIG_URL })).toBe(true);
      expect(app.hasRoute({ method: 'PUT', url: SYSTEM_CONFIG_URL })).toBe(false);
      expect((await app.inject({ method: 'PUT', url: SYSTEM_CONFIG_URL })).statusCode).toBe(404);
    },
  );

  it('registers the system config update route when allowSystemConfigUpdate is true', async () => {
    const app = await start(aConfig({ allowSystemConfigUpdate: true }));

    expect(app.hasRoute({ method: 'PUT', url: SYSTEM_CONFIG_URL })).toBe(true);
  });
});
