// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import type { BootstrapConfig } from '@citrineos/base';
import type { ILogObj, Logger } from 'tslog';
import { DefaultSequelizeInstance } from '../../../src/layers/sequelize/util.js';

const FAKE_PASSWORD = 'fakeDbPassw0rdQ';

describe('DefaultSequelizeInstance', () => {
  it('logs only non-secret connection settings when initialized', async () => {
    const info = vi.fn();
    const subLogger = { info, error: vi.fn() };
    const logger = { getSubLogger: () => subLogger } as unknown as Logger<ILogObj>;
    const config = {
      database: {
        host: 'db-host.example',
        port: 5432,
        database: 'citrine_test_db',
        dialect: 'postgres',
        username: 'citrine_user',
        password: FAKE_PASSWORD,
        sync: false,
      },
    } as unknown as BootstrapConfig;

    // Builds a real Sequelize instance; nothing connects until authenticate(), which is stubbed.
    const instance = DefaultSequelizeInstance.getInstance(config, logger);
    vi.spyOn(instance, 'authenticate').mockResolvedValue();

    await DefaultSequelizeInstance.initializeSequelize();

    const infoLogs = info.mock.calls.map((args) => args.map(String).join(' '));
    const prefix = 'Sequelize initialized: ';
    const initLine = infoLogs.find((line) => line.startsWith(prefix));
    expect(initLine).toBeDefined();
    expect(initLine).toContain('db-host.example');
    expect(initLine).toContain('citrine_test_db');
    expect(initLine).toContain('postgres');
    expect(infoLogs.join('\n')).not.toContain(FAKE_PASSWORD);
    // Allowlist: the password key must be absent, not merely masked.
    expect(JSON.parse(initLine!.slice(prefix.length))).not.toHaveProperty('password');
  });
});
