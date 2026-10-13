// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { generateKeyPairSync } from 'crypto';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OIDCConfig } from '../../src/authorization/provider/OIDCAuthProvider.js';
import { OIDCAuthProvider } from '../../src/authorization/provider/OIDCAuthProvider.js';

const signingKey = vi.hoisted(() => ({ publicKeyPem: '', privateKeyPem: '' }));

// One signing key for every issuer: only the iss check can tell the tokens apart.
vi.mock('jwks-rsa', () => ({
  default: vi.fn(() => ({
    getSigningKey: (
      _kid: string,
      callback: (error: Error | null, key?: { getPublicKey: () => string }) => void,
    ) => callback(null, { getPublicKey: () => signingKey.publicKeyPem }),
  })),
}));

const INTERNAL_ISSUER = 'http://idp.internal:8080/realms/app';
const EXPECTED_ISSUER = 'https://idp.example.com/realms/app';
const OTHER_ISSUER = 'https://idp.example.org/realms/app';
const DISCOVERY_URL = `${INTERNAL_ISSUER}/.well-known/openid-configuration`;

const baseConfig: OIDCConfig = {
  jwksUri: `${INTERNAL_ISSUER}/protocol/openid-connect/certs`,
  issuer: INTERNAL_ISSUER,
  audience: 'citrineos',
};

const silentLogger = new Logger<ILogObj>({ type: 'hidden' });

function signToken(issuer?: string): string {
  return jwt.sign(
    { sub: 'user-1', resource_access: { citrineos: { roles: ['admin'] } } },
    signingKey.privateKeyPem,
    { algorithm: 'RS256', keyid: 'test-kid', expiresIn: 60, ...(issuer ? { issuer } : {}) },
  );
}

function recordingLogger() {
  const calls = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = { ...calls, getSubLogger: vi.fn() };
  logger.getSubLogger.mockReturnValue(logger);
  return { logger: logger as unknown as Logger<ILogObj>, calls };
}

function stubDiscovery(issuer: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => (issuer === undefined ? {} : { issuer }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OIDCAuthProvider issuer check', () => {
  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    signingKey.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    signingKey.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a token whose iss is the issuer advertised by discovery', async () => {
    const fetchMock = stubDiscovery(EXPECTED_ISSUER);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const result = await provider.authenticateToken(signToken(EXPECTED_ISSUER));

    expect(result.isAuthenticated).toBe(true);
    expect(result.user?.roles).toEqual(['admin']);
    expect(fetchMock).toHaveBeenCalledWith(DISCOVERY_URL, expect.anything());
  });

  it('rejects a token signed with a trusted key but issued by another issuer', async () => {
    stubDiscovery(EXPECTED_ISSUER);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const result = await provider.authenticateToken(signToken(OTHER_ISSUER));

    expect(result.isAuthenticated).toBe(false);
    expect(result.error).toContain('jwt issuer invalid');
  });

  it('rejects a token carrying the internal URL when discovery advertises another issuer', async () => {
    stubDiscovery(EXPECTED_ISSUER);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const result = await provider.authenticateToken(signToken(INTERNAL_ISSUER));

    expect(result.isAuthenticated).toBe(false);
  });

  it('rejects a token without iss', async () => {
    stubDiscovery(EXPECTED_ISSUER);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const result = await provider.authenticateToken(signToken());

    expect(result.isAuthenticated).toBe(false);
    expect(result.error).toContain('jwt issuer invalid');
  });

  it('uses expectedIssuer verbatim without calling discovery', async () => {
    const fetchMock = stubDiscovery(OTHER_ISSUER);
    const provider = new OIDCAuthProvider(
      { ...baseConfig, expectedIssuer: EXPECTED_ISSUER },
      silentLogger,
    );

    const accepted = await provider.authenticateToken(signToken(EXPECTED_ISSUER));
    const rejected = await provider.authenticateToken(signToken(OTHER_ISSUER));

    expect(accepted.isAuthenticated).toBe(true);
    expect(rejected.isAuthenticated).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls discovery once for successive tokens', async () => {
    const fetchMock = stubDiscovery(EXPECTED_ISSUER);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    await provider.authenticateToken(signToken(EXPECTED_ISSUER));
    await provider.authenticateToken(signToken(EXPECTED_ISSUER));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('strips a trailing slash from the configured issuer before discovery', async () => {
    const fetchMock = stubDiscovery(EXPECTED_ISSUER);
    const provider = new OIDCAuthProvider(
      { ...baseConfig, issuer: `${INTERNAL_ISSUER}/` },
      silentLogger,
    );

    await provider.authenticateToken(signToken(EXPECTED_ISSUER));

    expect(fetchMock).toHaveBeenCalledWith(DISCOVERY_URL, expect.anything());
  });

  it('fails closed when discovery is unreachable, then retries on the next request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const whileDown = await provider.authenticateToken(signToken(EXPECTED_ISSUER));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ issuer: EXPECTED_ISSUER }),
    });
    const afterRecovery = await provider.authenticateToken(signToken(EXPECTED_ISSUER));

    expect(whileDown.isAuthenticated).toBe(false);
    expect(afterRecovery.isAuthenticated).toBe(true);
  });

  it('fails closed when discovery answers an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const result = await provider.authenticateToken(signToken(EXPECTED_ISSUER));

    expect(result.isAuthenticated).toBe(false);
    expect(result.error).toContain('HTTP 503');
  });

  it('fails closed when the discovery document has no issuer', async () => {
    stubDiscovery(undefined);
    const provider = new OIDCAuthProvider(baseConfig, silentLogger);

    const result = await provider.authenticateToken(signToken(EXPECTED_ISSUER));

    expect(result.isAuthenticated).toBe(false);
    expect(result.error).toContain('has no issuer');
  });

  it('logs a rejected iss escaped on one line and truncated', async () => {
    stubDiscovery(EXPECTED_ISSUER);
    const { logger, calls } = recordingLogger();
    const provider = new OIDCAuthProvider(baseConfig, logger);
    const forgedIssuer = `x\nERROR Token authentication failed (iss=y)\u001b[31m${'a'.repeat(1000)}`;

    await provider.authenticateToken(signToken(forgedIssuer));

    const messages = calls.error.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('Token authentication failed'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('\n');
    expect(messages[0]).not.toContain('\u001b');
    expect(messages[0].length).toBeLessThan(300);
  });

  it('logs iss=none when the token has no iss', async () => {
    stubDiscovery(EXPECTED_ISSUER);
    const { logger, calls } = recordingLogger();
    const provider = new OIDCAuthProvider(baseConfig, logger);

    await provider.authenticateToken(signToken());

    expect(calls.error).toHaveBeenCalledWith(
      'Token authentication failed (iss=none):',
      expect.anything(),
    );
  });
});

describe('OIDCAuthProvider token extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the bearer token without logging it', async () => {
    stubDiscovery(EXPECTED_ISSUER);
    const { logger, calls } = recordingLogger();
    const provider = new OIDCAuthProvider(baseConfig, logger);
    const token = 'header.payload.signature';
    const request = { headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest;

    const extracted = await provider.extractToken(request);

    expect(extracted).toBe(token);
    const loggedArgs = Object.values(calls).flatMap((fn) => fn.mock.calls.flat());
    expect(loggedArgs.some((arg) => JSON.stringify(arg)?.includes(token))).toBe(false);
  });
});
