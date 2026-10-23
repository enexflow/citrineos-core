// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { MASKED_SECRET, redactConfig } from '../../src/index.js';

// Runtime module config: SystemConfig merged with BootstrapConfig. Every credential starts with 'fake-secret-'.
function aConfig() {
  return {
    centralSystem: { host: 'csms.example', port: 8080, systemApiToken: 'fake-secret-api-token' },
    oidcClient: {
      tokenUrl: 'https://idp.example/token',
      clientId: 'fake-client-id',
      clientSecret: 'fake-secret-oidc-client',
      audience: 'fake-audience',
    },
    ocpiServer: { host: 'ocpi.example', port: 8085, adminToken: 'fake-secret-ocpi-admin-token' },
    modules: {
      transactions: {
        signedMeterValuesConfiguration: {
          publicKeyFileId: 'meter-public-key',
          signingMethod: 'ECDSA',
        },
      },
    },
    util: {
      cache: { redis: { url: 'rediss://cache-user:fake-secret-redis@cache.example:6380/0' } },
      messageBroker: {
        amqp: {
          url: 'amqp://broker-user:fake-secret-amqp@broker.example:5672/vhost',
          exchange: 'citrineos',
        },
        kafka: {
          brokers: ['kafka.example:9092'],
          sasl: { mechanism: 'plain', username: 'kafka-user', password: 'fake-secret-sasl' },
        },
      },
      authProvider: {
        oidc: {
          jwksUri: 'https://idp.example/certs',
          issuer: 'https://idp.example',
          audience: 'x',
        },
        localByPass: false,
      },
      networkConnection: {
        websocketServers: [
          {
            id: '0',
            tlsKeyFilePath: '/certs/leaf.key',
            mtlsCertificateAuthorityKeyFilePath: '/certs/sub-ca.key',
            rootCACertificateFilePath: '/certs/root.pem',
          },
        ],
      },
      certificateAuthority: {
        v2gCA: {
          name: 'hubject',
          hubject: {
            baseUrl: 'https://v2g.example',
            tokenUrl: 'https://v2g.example/token',
            clientId: 'fake-hubject-client-id',
            clientSecret: 'fake-secret-hubject-client',
          },
        },
        chargingStationCA: {
          name: 'acme',
          acme: { env: 'staging', accountKeyFilePath: '/certs/acme.key', email: 'ops@example.com' },
        },
      },
    },
    database: { host: 'db.example', username: 'db-user', password: 'fake-secret-db' },
    fileAccess: {
      s3: {
        endpoint: 'https://s3.example',
        defaultBucketName: 'bucket',
        accessKeyId: 'fake-secret-s3-access-key-id',
        secretAccessKey: 'fake-secret-s3-secret-access-key',
      },
      gcp: {
        projectId: 'gcp-project',
        credentials: { client_email: 'svc@example.com', private_key: 'fake-secret-gcp-key' },
      },
    },
  };
}

const CREDENTIAL_PATHS = [
  'centralSystem.systemApiToken',
  'oidcClient.clientSecret',
  'ocpiServer.adminToken',
  'util.messageBroker.kafka.sasl.password',
  'util.certificateAuthority.v2gCA.hubject.clientSecret',
  'database.password',
  'fileAccess.s3.accessKeyId',
  'fileAccess.s3.secretAccessKey',
  'fileAccess.gcp.credentials',
];

const URL_PATHS: [string, string][] = [
  ['util.messageBroker.amqp.url', `amqp://broker-user:${MASKED_SECRET}@broker.example:5672/vhost`],
  ['util.cache.redis.url', `rediss://cache-user:${MASKED_SECRET}@cache.example:6380/0`],
];

const NON_SECRET_PATHS = [
  'centralSystem.host',
  'oidcClient.tokenUrl',
  'oidcClient.clientId',
  'oidcClient.audience',
  'util.authProvider.oidc.jwksUri',
  'util.authProvider.oidc.issuer',
  'util.authProvider.localByPass',
  'util.messageBroker.amqp.exchange',
  'util.messageBroker.kafka.brokers',
  'util.messageBroker.kafka.sasl.username',
  'util.networkConnection.websocketServers.0.tlsKeyFilePath',
  'util.networkConnection.websocketServers.0.mtlsCertificateAuthorityKeyFilePath',
  'util.certificateAuthority.v2gCA.hubject.tokenUrl',
  'util.certificateAuthority.v2gCA.hubject.clientId',
  'util.certificateAuthority.chargingStationCA.acme.accountKeyFilePath',
  'modules.transactions.signedMeterValuesConfiguration.publicKeyFileId',
  'database.username',
  'fileAccess.s3.endpoint',
  'fileAccess.gcp.projectId',
];

function valueAt(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], source);
}

function setAt(target: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const parent = valueAt(target, keys.slice(0, -1).join('.')) as Record<string, unknown>;
  parent[keys[keys.length - 1]] = value;
}

describe('redactConfig', () => {
  it.each(CREDENTIAL_PATHS)('masks %s', (path) => {
    const config = aConfig();
    expect(valueAt(config, path)).toBeDefined();

    expect(valueAt(redactConfig(config), path)).toBe(MASKED_SECRET);
  });

  it.each(URL_PATHS)('masks only the password of the URL in %s', (path, expected) => {
    expect(valueAt(redactConfig(aConfig()), path)).toBe(expected);
  });

  it.each(NON_SECRET_PATHS)('keeps %s', (path) => {
    const config = aConfig();
    expect(valueAt(config, path)).toBeDefined();

    expect(valueAt(redactConfig(config), path)).toEqual(valueAt(config, path));
  });

  it('changes nothing but the credentials', () => {
    const expected = structuredClone(aConfig());
    CREDENTIAL_PATHS.forEach((path) => setAt(expected, path, MASKED_SECRET));
    URL_PATHS.forEach(([path, url]) => setAt(expected, path, url));

    const redacted = redactConfig(aConfig());

    expect(redacted).toEqual(expected);
    expect(JSON.stringify(redacted)).not.toContain('fake-secret-');
  });

  it('leaves an unset credential unset', () => {
    const config = { centralSystem: { host: 'csms.example', systemApiToken: undefined } };

    expect(redactConfig(config)).toStrictEqual(config);
  });

  it('returns a copy without mutating the input', () => {
    const config = aConfig();
    const snapshot = structuredClone(config);

    const redacted = redactConfig(config);

    expect(config).toEqual(snapshot);
    expect(redacted).not.toBe(config);
    expect(redacted.oidcClient).not.toBe(config.oidcClient);
    expect(redacted.util.networkConnection.websocketServers).not.toBe(
      config.util.networkConnection.websocketServers,
    );
    expect(redacted.util.networkConnection.websocketServers[0]).not.toBe(
      config.util.networkConnection.websocketServers[0],
    );
  });
});
