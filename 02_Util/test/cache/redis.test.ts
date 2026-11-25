// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { createClient } from 'redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisCache } from '../../src/cache/redis.js';

vi.mock('redis', () => ({
  createClient: vi.fn(),
}));

type KeyspaceListener = (message: string, channel: string) => void;

function aFakeSubscriber() {
  const subscriber = {
    listener: undefined as KeyspaceListener | undefined,
    channel: undefined as string | undefined,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockImplementation(async (channel: string, listener: KeyspaceListener) => {
      subscriber.channel = channel;
      subscriber.listener = listener;
    }),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  return subscriber;
}

function aFakeMainClient(subscriber: ReturnType<typeof aFakeSubscriber>) {
  return {
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    set: vi.fn(),
    duplicate: vi.fn().mockReturnValue(subscriber),
  };
}

describe('RedisCache.onChange', () => {
  let subscriber: ReturnType<typeof aFakeSubscriber>;
  let client: ReturnType<typeof aFakeMainClient>;
  let cache: RedisCache;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    subscriber = aFakeSubscriber();
    client = aFakeMainClient(subscriber);
    client.get.mockResolvedValue('value');
    (createClient as ReturnType<typeof vi.fn>).mockReset();
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    cache = new RedisCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves with the value read at the namespaced key once the wait elapses without events', async () => {
    const promise = cache.onChange('k', 30, 'ns');
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(promise).resolves.toBe('value');
    expect(client.get).toHaveBeenCalledWith('ns:k');
    expect(client.get).not.toHaveBeenCalledWith('ns:ns:k');
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
  });

  it('opens the subscriber from the main client and subscribes to the keyspace channel after connecting', async () => {
    void cache.onChange('k', 30, 'ns');
    await vi.advanceTimersByTimeAsync(0);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(subscriber.connect).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith('__keyspace@0__:ns:k', expect.any(Function));
    expect(subscriber.connect.mock.invocationCallOrder[0]).toBeLessThan(
      subscriber.subscribe.mock.invocationCallOrder[0],
    );
  });

  it('resolves early on a set event and closes the subscriber exactly once', async () => {
    const promise = cache.onChange('k', 30, 'ns');
    await vi.advanceTimersByTimeAsync(0);

    subscriber.listener!('set', '__keyspace@0__:ns:k');

    await expect(promise).resolves.toBe('value');
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('ns:k');
    expect(subscriber.quit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it.each(['del', 'expire'])(
    'resolves null on a %s event and closes the subscriber once',
    async (event) => {
      const promise = cache.onChange('k', 30, 'ns');
      await vi.advanceTimersByTimeAsync(0);

      subscriber.listener!(event, '__keyspace@0__:ns:k');

      await expect(promise).resolves.toBeNull();
      expect(subscriber.quit).toHaveBeenCalledTimes(1);
      expect(client.get).not.toHaveBeenCalled();
    },
  );

  it.each(['expired', 'hset'])(
    'ignores an unrelated %s event until the wait elapses',
    async (event) => {
      let settled = false;
      const promise = cache.onChange('k', 30, 'ns').then((value) => {
        settled = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(0);

      subscriber.listener!(event, '__keyspace@0__:ns:k');
      await vi.advanceTimersByTimeAsync(29_000);
      expect(settled).toBe(false);
      expect(subscriber.quit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toBe('value');
    },
  );

  it('deserializes the value into the class constructor on a set event', async () => {
    class Lock {
      owner!: string;
    }
    client.get.mockResolvedValue(JSON.stringify({ owner: 'cs-1' }));

    const promise = cache.onChange<Lock>('k', 30, 'ns', () => Lock);
    await vi.advanceTimersByTimeAsync(0);
    subscriber.listener!('set', '__keyspace@0__:ns:k');

    const result = await promise;
    expect(result).toBeInstanceOf(Lock);
    expect(result).toEqual({ owner: 'cs-1' });
  });

  it('falls back to the default namespace when none is given', async () => {
    const promise = cache.onChange('k', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      '__keyspace@0__:default:k',
      expect.any(Function),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBe('value');
    expect(client.get).toHaveBeenCalledWith('default:k');
  });
});
