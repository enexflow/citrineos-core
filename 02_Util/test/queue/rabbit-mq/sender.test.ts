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
    close: vi.fn().mockResolvedValue(undefined),
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

  it('closes the connection when the broker closes the channel while the connection stays up, instead of leaking it', async () => {
    // e.g. a 403 on publish closes the channel only. Dropping the connection reference without
    // closing it left one open connection on the broker per reconnect.
    const channelCloseHandler = channels[0].on.mock.calls.find(([event]) => event === 'close')?.[1];
    expect(channelCloseHandler).toBeDefined();

    channelCloseHandler();

    await vi.waitFor(() => expect(connections[0].close).toHaveBeenCalledTimes(1));
  });

  it('leaves the current connection alone when a superseded channel closes', async () => {
    const staleChannelCloseHandler = channels[0].on.mock.calls.find(
      ([event]) => event === 'close',
    )?.[1];
    await (sender as any)._handleDisconnect();
    await (sender as any)._connectOnce();

    staleChannelCloseHandler();
    await new Promise((res) => setTimeout(res, 0));

    expect(connections[0].close).not.toHaveBeenCalled();
    expect(connections[1].close).not.toHaveBeenCalled();
  });

  it('handles the disconnect itself when closing the connection of a closed channel fails', async () => {
    connections[0].close.mockRejectedValue(new Error('Connection closed'));
    const channelCloseHandler = channels[0].on.mock.calls.find(([event]) => event === 'close')?.[1];

    channelCloseHandler();

    await vi.waitFor(() => expect((sender as any)._connection).toBeUndefined());
    expect((sender as any)._circuitBreaker.state).toBe('FAILING');
  });

  it('closes the connection when its setup is refused after connect, instead of leaking one per retry', async () => {
    vi.useFakeTimers();
    await (sender as any)._handleDisconnect();
    (amqplib.connect as any).mockImplementationOnce(() => {
      const channel = aFakeChannel();
      channel.assertExchange.mockRejectedValue(new Error('ACCESS_REFUSED'));
      const connection = aFakeConnection(channel);
      channels.push(channel);
      connections.push(connection);
      return Promise.resolve(connection);
    });

    const reconnect = (sender as any)._connectOnce();
    await vi.advanceTimersByTimeAsync(1000);
    const channel = await reconnect;

    expect(amqplib.connect).toHaveBeenCalledTimes(3);
    expect(connections[1].close).toHaveBeenCalledTimes(1);
    expect(connections[2].close).not.toHaveBeenCalled();
    expect(channel).toBe(channels[2]);
  });

  it('keeps retrying when closing the failed connection never settles (no Close-Ok from the broker)', async () => {
    vi.useFakeTimers();
    await (sender as any)._handleDisconnect();
    (amqplib.connect as any).mockImplementationOnce(() => {
      const channel = aFakeChannel();
      channel.assertExchange.mockRejectedValue(new Error('ACCESS_REFUSED'));
      const connection = aFakeConnection(channel);
      // amqplib only settles close() on Close-Ok: a broker dying mid-close leaves it pending.
      connection.close.mockReturnValue(new Promise(() => {}));
      channels.push(channel);
      connections.push(connection);
      return Promise.resolve(connection);
    });

    const reconnect = (sender as any)._connectOnce();
    await vi.advanceTimersByTimeAsync(1000);
    const channel = await reconnect;

    expect(connections[1].close).toHaveBeenCalledTimes(1);
    expect(amqplib.connect).toHaveBeenCalledTimes(3);
    expect(channel).toBe(channels[2]);
  });

  it('registers error listeners before any setup call, so a refused setup cannot crash the process', () => {
    const [connection] = connections;
    const [channel] = channels;
    const onError = (calls: unknown[][]) => calls.findIndex(([event]) => event === 'error');
    const connectionErrorAt =
      connection.on.mock.invocationCallOrder[onError(connection.on.mock.calls)];
    const channelErrorAt = channel.on.mock.invocationCallOrder[onError(channel.on.mock.calls)];

    expect(connectionErrorAt).toBeLessThan(connection.createChannel.mock.invocationCallOrder[0]);
    expect(channelErrorAt).toBeLessThan(channel.assertExchange.mock.invocationCallOrder[0]);
  });
});
