// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheNamespace, DEFAULT_TENANT_ID, type IWebsocketConnection } from '@citrineos/base';
import { MemoryCache, WebsocketNetworkConnection } from '../../src/index.js';

const PING_INTERVAL = 60;
const STATION_ID = 'cp001';
const IDENTIFIER = `${DEFAULT_TENANT_ID}:${STATION_ID}`;

class FakeWebSocket extends EventEmitter {
  readyState = 1;
  protocol = 'ocpp2.0.1';
  onmessage?: (event: { data: string }) => void;
  onerror?: unknown;
  pause = vi.fn();
  resume = vi.fn();
  ping = vi.fn();
  pong = vi.fn();
  send = vi.fn((_message: string, cb: (error?: Error) => void) => cb());
  close = vi.fn(() => this.closed());
  terminate = vi.fn(() => this.closed());

  closed() {
    this.readyState = 3;
    this.emit('close');
  }
}

function aRouter() {
  return {
    networkHook: undefined as unknown,
    registerConnection: vi.fn().mockResolvedValue(true),
    deregisterConnection: vi.fn().mockResolvedValue(true),
    releaseConnection: vi.fn().mockResolvedValue(true),
    onMessage: vi.fn().mockResolvedValue(true),
  };
}

function aNetworkConnection(cache: MemoryCache, router: ReturnType<typeof aRouter>) {
  const config: any = { util: { networkConnection: { websocketServers: [] } } };
  return new WebsocketNetworkConnection(
    config,
    cache,
    {} as any,
    router as any,
    undefined,
    async () => true,
  );
}

const serverConfig: any = { id: '0', tenantId: DEFAULT_TENANT_ID };

async function connect(network: WebsocketNetworkConnection, ws: FakeWebSocket) {
  const req: any = { url: `/${STATION_ID}`, headers: {}, socket: { remoteAddress: '10.0.0.1' } };
  await (network as any)._onConnection(ws, serverConfig, PING_INTERVAL, req);
}

async function cachedConnection(cache: MemoryCache): Promise<IWebsocketConnection | null> {
  const value = await cache.get<string>(IDENTIFIER, CacheNamespace.Connections);
  return value ? JSON.parse(value) : null;
}

describe('WebsocketNetworkConnection', () => {
  let cache: MemoryCache;
  let router: ReturnType<typeof aRouter>;
  let network: WebsocketNetworkConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MemoryCache();
    router = aRouter();
    network = aNetworkConnection(cache, router);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('liveness', () => {
    it('terminates a connection that answered neither pong nor message since the last ping', async () => {
      const ws = new FakeWebSocket();
      await connect(network, ws);

      await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);
      expect(ws.ping).toHaveBeenCalledTimes(1);
      expect(ws.terminate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);
      expect(ws.terminate).toHaveBeenCalledTimes(1);
      expect(router.deregisterConnection).toHaveBeenCalledWith(DEFAULT_TENANT_ID, STATION_ID);
      expect(await cachedConnection(cache)).toBeNull();
    });

    it('keeps a connection that answers pings', async () => {
      const ws = new FakeWebSocket();
      await connect(network, ws);

      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);
        ws.emit('pong');
      }

      expect(ws.ping).toHaveBeenCalledTimes(3);
      expect(ws.terminate).not.toHaveBeenCalled();
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('counts an incoming message as a sign of life', async () => {
      const ws = new FakeWebSocket();
      await connect(network, ws);

      await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);
      ws.onmessage!({ data: '[2,"1","Heartbeat",{}]' });
      await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);

      expect(ws.terminate).not.toHaveBeenCalled();
      expect(ws.ping).toHaveBeenCalledTimes(2);
    });
  });

  describe('reconnection on the same instance', () => {
    it('accepts the new connection and closes the previous one without unregistering the station', async () => {
      const previous = new FakeWebSocket();
      const current = new FakeWebSocket();
      await connect(network, previous);
      await connect(network, current);

      expect(previous.close).toHaveBeenCalledWith(1000, 'Replaced by a new connection');
      await vi.advanceTimersByTimeAsync(0);
      expect(router.deregisterConnection).not.toHaveBeenCalled();
      expect(router.releaseConnection).not.toHaveBeenCalled();
      expect(await cachedConnection(cache)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);
      expect(current.ping).toHaveBeenCalledTimes(1);
      expect(current.close).not.toHaveBeenCalled();
    });

    it('ignores a late close of the replaced websocket', async () => {
      const previous = new FakeWebSocket();
      previous.close = vi.fn(); // close handshake still pending
      const current = new FakeWebSocket();
      await connect(network, previous);
      await connect(network, current);

      previous.closed();
      await vi.advanceTimersByTimeAsync(0);

      expect(router.deregisterConnection).not.toHaveBeenCalled();
      expect(await cachedConnection(cache)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(PING_INTERVAL * 1000);
      expect(current.close).not.toHaveBeenCalled();
      await network.sendMessage(IDENTIFIER, '[2,"1","Reset",{}]');
      expect(current.send).toHaveBeenCalledTimes(1);
      expect(previous.send).not.toHaveBeenCalled();
    });

    it('fully unregisters the station when its current websocket closes', async () => {
      const ws = new FakeWebSocket();
      await connect(network, ws);

      ws.closed();
      await vi.advanceTimersByTimeAsync(0);

      expect(router.deregisterConnection).toHaveBeenCalledWith(DEFAULT_TENANT_ID, STATION_ID);
      expect(await cachedConnection(cache)).toBeNull();
    });
  });

  describe('reconnection on another instance (shared cache)', () => {
    let otherRouter: ReturnType<typeof aRouter>;
    let otherNetwork: WebsocketNetworkConnection;

    beforeEach(() => {
      otherRouter = aRouter();
      otherNetwork = aNetworkConnection(cache, otherRouter);
    });

    it('closes the replaced websocket at its next ping and only releases this instance', async () => {
      const previous = new FakeWebSocket();
      const current = new FakeWebSocket();
      await connect(network, previous);
      await vi.advanceTimersByTimeAsync(10_000);
      await connect(otherNetwork, current);

      await vi.advanceTimersByTimeAsync((PING_INTERVAL - 10) * 1000);

      expect(previous.close).toHaveBeenCalledWith(1000, 'Replaced by a new connection');
      expect(router.releaseConnection).toHaveBeenCalledWith(DEFAULT_TENANT_ID, STATION_ID);
      expect(router.deregisterConnection).not.toHaveBeenCalled();
      expect(otherRouter.deregisterConnection).not.toHaveBeenCalled();
      expect(await cachedConnection(cache)).not.toBeNull();
      expect(current.close).not.toHaveBeenCalled();
    });

    it('does not send on the replaced websocket', async () => {
      const previous = new FakeWebSocket();
      await connect(network, previous);
      await connect(otherNetwork, new FakeWebSocket());

      await expect(network.sendMessage(IDENTIFIER, '[2,"1","Reset",{}]')).rejects.toThrow();

      expect(previous.send).not.toHaveBeenCalled();
      expect(previous.close).toHaveBeenCalledWith(1000, 'Replaced by a new connection');
    });
  });
});
