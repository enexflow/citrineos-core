// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { SystemConfig } from '@citrineos/base';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { isApiDocsExposed } from '../../src/util/apiDocs.js';
import { initSwagger } from '../../src/util/swagger.js';

const IN_CLUSTER = { KUBERNETES_SERVICE_HOST: '10.100.0.1' };
const DOCS_PATHS = ['/docs', '/docs/', '/docs/json', '/docs/yaml', '/docs/static/index.html'];

describe('isApiDocsExposed', () => {
  it.each(['dev', 'staging'])('exposes docs in the %s namespace', (namespace) => {
    expect(isApiDocsExposed(IN_CLUSTER, () => namespace)).toBe(true);
  });

  it.each(['prod', 'demo', 'default', ''])('hides docs in the "%s" namespace', (namespace) => {
    expect(isApiDocsExposed(IN_CLUSTER, () => namespace)).toBe(false);
  });

  it('hides docs in a pod whose namespace cannot be read', () => {
    expect(isApiDocsExposed(IN_CLUSTER, () => undefined)).toBe(false);
  });

  it('exposes docs outside Kubernetes', () => {
    expect(isApiDocsExposed({}, () => undefined)).toBe(true);
  });
});

describe('initSwagger docs routes', () => {
  const config = { util: { swagger: { path: '/docs' } } } as unknown as SystemConfig;
  let server: ReturnType<typeof Fastify> | undefined;

  const start = async (exposeDocs: boolean) => {
    server = Fastify();
    await initSwagger(config, server, exposeDocs);
    server.get('/data/ping', async () => ({ ok: true }));
    await server.ready();
    return server;
  };

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves no docs route when docs are hidden, but still builds the spec', async () => {
    const app = await start(false);
    for (const url of DOCS_PATHS) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: '/data/ping' })).statusCode).toBe(200);
    expect(Object.keys(app.swagger().paths ?? {})).toContain('/data/ping');
  });

  it('serves the UI and the OpenAPI document when docs are exposed', async () => {
    const app = await start(true);
    for (const url of ['/docs/', '/docs/json', '/docs/yaml']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
  });
});
