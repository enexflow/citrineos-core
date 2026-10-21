// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '../../src/index.js';
import type { SystemConfigInput } from '../../src/config/types.js';

const FAKE_SECRET = 'not-json-fake-secret-Zq7!x';
const FAKE_PASSWORD = 'fakeBrokerPassw0rdQ';

const CONSOLE_METHODS = ['debug', 'log', 'info', 'warn', 'error'] as const;

describe('defineConfig environment variable merge logging', () => {
  let spies: Record<(typeof CONSOLE_METHODS)[number], ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    spies = {} as typeof spies;
    for (const method of CONSOLE_METHODS) {
      spies[method] = vi.spyOn(console, method).mockImplementation(() => {});
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function allConsoleOutput(): string {
    return JSON.stringify(CONSOLE_METHODS.map((method) => spies[method].mock.calls));
  }

  it('does not log values of non-JSON environment variables mapped as strings', () => {
    vi.stubEnv('CITRINEOS_OIDCCLIENT_CLIENTSECRET', FAKE_SECRET);
    vi.stubEnv('CITRINEOS_util_messageBroker_amqp_url', `amqp://user:${FAKE_PASSWORD}@broker:5672`);

    // Config is empty so schema validation throws, after the env merge has logged.
    expect(() => defineConfig({} as SystemConfigInput)).toThrow();

    expect(spies.debug).toHaveBeenCalledWith(
      expect.stringContaining('CITRINEOS_OIDCCLIENT_CLIENTSECRET'),
    );
    expect(spies.debug).toHaveBeenCalledWith(
      expect.stringContaining('CITRINEOS_util_messageBroker_amqp_url'),
    );
    const output = allConsoleOutput();
    expect(output).not.toContain(FAKE_SECRET);
    expect(output).not.toContain(FAKE_PASSWORD);
  });

  it('reports unknown config segments by variable name without logging the value', () => {
    vi.stubEnv('CITRINEOS_NOTASEGMENT_PASSWORD', FAKE_SECRET);

    expect(() => defineConfig({} as SystemConfigInput)).toThrow();

    expect(spies.error).toHaveBeenCalledWith(
      expect.stringContaining('CITRINEOS_NOTASEGMENT_PASSWORD'),
    );
    expect(allConsoleOutput()).not.toContain(FAKE_SECRET);
  });
});
