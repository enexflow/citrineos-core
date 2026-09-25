// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import * as amqplib from 'amqplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache, RabbitMqReceiver } from '../../../src/index.js';

vi.mock('amqplib', () => ({
  connect: vi.fn(),
}));

function aFakeChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue(undefined),
    unbindQueue: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue({ messageCount: 0 }),
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

describe('RabbitMqReceiver reconnection', () => {
  let receiver: RabbitMqReceiver;
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

    receiver = new RabbitMqReceiver(config, undefined, undefined, new MemoryCache());
    await receiver.initConnection();
    await receiver.subscribe('cp001', ['Heartbeat' as any]);

    // Sanity check on the fixture itself before exercising the reconnect path.
    expect(amqplib.connect).toHaveBeenCalledTimes(1);
    expect(channels[0].consume).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    const interval = (receiver as any)._reconnectInterval;
    if (interval) clearInterval(interval);
    vi.useRealTimers();
  });

  it('opens exactly one AMQP connection/consumer per reconnect cycle, despite the circuit breaker OPEN callback firing mid-reconnect', async () => {
    // `_connectWithRetry()` calls `triggerSuccess()` (which synchronously fires the circuit
    // breaker's OPEN state-change callback) before it awaits `_resubscribeAll()`. Before the
    // fix, that callback independently kicked off its own `_connectWithRetry()` call while the
    // original one was still resubscribing, opening a second connection/channel and
    // double-consuming the same queue - leaving `this._channel` pointing at whichever one
    // resolved last.
    await (receiver as any)._handleDisconnect();
    const reconnectedChannel = await (receiver as any)._connectOnce();

    expect(amqplib.connect).toHaveBeenCalledTimes(2);
    expect(channels).toHaveLength(2);
    expect(channels[1].consume).toHaveBeenCalledTimes(1);
    expect(reconnectedChannel).toBe(channels[1]);
    expect((receiver as any)._channel).toBe(channels[1]);
  });

  it('reuses the in-flight reconnect attempt instead of racing a second connection', async () => {
    await (receiver as any)._handleDisconnect();

    const [first, second] = await Promise.all([
      (receiver as any)._connectOnce(),
      (receiver as any)._connectOnce(),
    ]);

    expect(amqplib.connect).toHaveBeenCalledTimes(2); // 1 initial connect + 1 reconnect, not 3
    expect(first).toBe(second);
  });

  it('recovers via the reconnect interval after a real connection-close event without duplicating consumers', async () => {
    vi.useFakeTimers();

    // Grab the 'close' listener the receiver attached to the live connection, and fire it the
    // way amqplib would on an actual broker disconnect.
    const closeHandler = connections[0].on.mock.calls.find(([event]) => event === 'close')?.[1];
    expect(closeHandler).toBeDefined();
    closeHandler();

    // Reconnect interval fires after `maxReconnectDelay` seconds.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(amqplib.connect).toHaveBeenCalledTimes(2);
    expect(channels).toHaveLength(2);
    expect(channels[1].consume).toHaveBeenCalledTimes(1);
    expect((receiver as any)._channel).toBe(channels[1]);
  });

  describe('broker-side consumer cancel (queue deleted, connection still up)', () => {
    const consumerCallback = (channel: ReturnType<typeof aFakeChannel>) =>
      channel.consume.mock.calls[0][1] as (msg: amqplib.ConsumeMessage | null) => void;

    it('re-declares the queue, its bindings and the consumer on the same connection', async () => {
      const channel = channels[0];
      channel.assertQueue.mockClear();
      channel.bindQueue.mockClear();

      consumerCallback(channel)(null);
      await vi.waitFor(() => expect(channel.consume).toHaveBeenCalledTimes(2));

      expect(channel.assertQueue).toHaveBeenCalledWith('rabbit_queue_cp001', expect.anything());
      expect(channel.bindQueue).toHaveBeenCalledWith(
        'rabbit_queue_cp001',
        'test-exchange',
        '',
        expect.objectContaining({ action: 'Heartbeat' }),
      );
      expect(amqplib.connect).toHaveBeenCalledTimes(1);
      expect(connections[0].close).not.toHaveBeenCalled();
    });

    it('does not re-subscribe when the cancel comes from our own unsubscribe', async () => {
      const channel = channels[0];
      channel.deleteQueue.mockImplementation(() => {
        // The broker sends basic.cancel before delete-ok.
        consumerCallback(channel)(null);
        return Promise.resolve({ messageCount: 0 });
      });

      await receiver.unsubscribe('cp001');
      await new Promise((res) => setTimeout(res, 0));

      expect(channel.consume).toHaveBeenCalledTimes(1);
    });

    it('forces a full reconnect when re-subscribing fails', async () => {
      const channel = channels[0];
      channel.assertQueue.mockRejectedValueOnce(new Error('NOT_FOUND - home node down'));

      consumerCallback(channel)(null);

      await vi.waitFor(() => expect(connections[0].close).toHaveBeenCalledTimes(1));
    });
  });

  it('forces a full reconnect when the channel is closed while the connection stays up', () => {
    const channelCloseHandler = channels[0].on.mock.calls.find(([event]) => event === 'close')?.[1];
    expect(channelCloseHandler).toBeDefined();

    channelCloseHandler();

    return vi.waitFor(() => expect(connections[0].close).toHaveBeenCalledTimes(1));
  });
});
