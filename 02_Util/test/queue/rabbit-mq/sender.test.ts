// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import * as amqplib from 'amqplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RabbitMqSender } from '../../../src/index.js';

vi.mock('amqplib', () => ({
  connect: vi.fn(),
}));

function aFakeChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  };
}

function aFakeConnection(channel: ReturnType<typeof aFakeChannel>) {
  return {
    createChannel: vi.fn().mockResolvedValue(channel),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

describe('RabbitMqSender reconnection', () => {
  let sender: RabbitMqSender;
  let channels: ReturnType<typeof aFakeChannel>[];
  let connections: ReturnType<typeof aFakeConnection>[];

  beforeEach(async () => {
    channels = [];
    connections = [];
    (amqplib.connect as any).mockReset();
    (amqplib.connect as any).mockImplementation(() => {
      const channel = aFakeChannel();
      const connection = aFakeConnection(channel);
      channels.push(channel);
      connections.push(connection);
      return Promise.resolve(connection);
    });

    const config: any = {
      util: {
        messageBroker: {
          amqp: { url: 'amqp://localhost', exchange: 'test-exchange' },
        },
      },
      maxReconnectDelay: 30,
    };

    sender = new RabbitMqSender(config);
    // The constructor kicks off the initial connect without awaiting it; wait for it to settle.
    await (sender as any)._connectPromise;

    // Sanity check on the fixture itself before exercising the reconnect path.
    expect(amqplib.connect).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    const interval = (sender as any)._reconnectInterval;
    if (interval) clearInterval(interval);
    vi.useRealTimers();
  });

  it('opens exactly one AMQP connection per reconnect cycle, despite the circuit breaker OPEN callback firing mid-reconnect', async () => {
    // `_connectWithRetry()` calls `triggerSuccess()` synchronously (firing the circuit breaker's
    // OPEN state-change callback) before returning. Before the fix, that callback independently
    // kicked off its own `_connectWithRetry()` call while the original one was still in flight,
    // opening a second connection/channel - leaving `this._channel` pointing at whichever one
    // resolved last, so publishes could go out on a channel with no live connection behind it.
    // Unlike the receiver, `_connectWithRetry()` here doesn't assign `this._channel` itself -
    // callers do that in their `.then()` (constructor, reconnect interval, OPEN callback), so
    // we assert on the resolved channel rather than `this._channel` directly.
    await (sender as any)._handleDisconnect();
    const reconnectedChannel = await (sender as any)._connectOnce();

    expect(amqplib.connect).toHaveBeenCalledTimes(2);
    expect(channels).toHaveLength(2);
    expect(reconnectedChannel).toBe(channels[1]);
  });

  it('reuses the in-flight reconnect attempt instead of racing a second connection', async () => {
    await (sender as any)._handleDisconnect();

    const [first, second] = await Promise.all([
      (sender as any)._connectOnce(),
      (sender as any)._connectOnce(),
    ]);

    expect(amqplib.connect).toHaveBeenCalledTimes(2); // 1 initial connect + 1 reconnect, not 3
    expect(first).toBe(second);
  });

  it('recovers via the reconnect interval after a real connection-close event without opening a duplicate connection', async () => {
    vi.useFakeTimers();

    // Grab the 'close' listener the sender attached to the live connection, and fire it the way
    // amqplib would on an actual broker disconnect.
    const closeHandler = connections[0].on.mock.calls.find(([event]) => event === 'close')?.[1];
    expect(closeHandler).toBeDefined();
    closeHandler();

    // Reconnect interval fires after `maxReconnectDelay` seconds.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(amqplib.connect).toHaveBeenCalledTimes(2);
    expect(channels).toHaveLength(2);
    expect((sender as any)._channel).toBe(channels[1]);
  });
});
