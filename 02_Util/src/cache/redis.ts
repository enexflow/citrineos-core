// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { ICache } from '@citrineos/base';
import type { ClassConstructor } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import type {
  RedisClientOptions,
  RedisClientType,
  RedisFunctions,
  RedisModules,
  RedisScripts,
} from 'redis';
import { createClient } from 'redis';

/**
 * Implementation of cache interface with redis storage
 */
export class RedisCache implements ICache {
  private _client: RedisClientType<RedisModules, RedisFunctions, RedisScripts>;

  constructor(clientOptions?: RedisClientOptions) {
    this._client = clientOptions ? createClient(clientOptions) : createClient();
    this._client.on('connect', () => console.log('Redis client connected'));
    this._client.on('ready', () => console.log('Redis client ready to use'));
    this._client.on('error', (err) => console.error('Redis error', err));
    this._client.on('end', () => console.log('Redis client disconnected'));
    this._client
      .connect()
      .then()
      .catch((error) => {
        console.log('Error connecting to Redis', error);
      });
  }

  exists(key: string, namespace?: string): Promise<boolean> {
    namespace = namespace || 'default';
    key = `${namespace}:${key}`;
    return this._client.exists(key).then((result) => result === 1);
  }

  remove(key: string, namespace?: string | undefined): Promise<boolean> {
    namespace = namespace || 'default';
    key = `${namespace}:${key}`;
    return this._client.del(key).then((result) => result === 1);
  }

  onChange<T>(
    key: string,
    waitSeconds: number,
    namespace?: string | undefined,
    classConstructor?: (() => ClassConstructor<T>) | undefined,
  ): Promise<T | null> {
    namespace = namespace || 'default';
    const namespaceKey = `${namespace}:${key}`;

    return new Promise((resolve) => {
      // Create a Redis subscriber to listen for operations affecting the key.
      // duplicate() reuses the main client's connection options; it must be connected explicitly.
      const subscriber = this._client.duplicate();
      let closed = false;

      // Cancel the fallback timer and close the subscriber, exactly once
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        if (subscriber.isOpen) {
          subscriber.quit().catch((error) => {
            console.log('Error quitting subscriber', error);
          });
        }
      };

      subscriber.on('error', (err) => console.error('Redis subscriber error', err));

      // Channel: Key-space, message: the name of the event, which is the command executed on the key.
      // node-redis invokes the listener as (message, channel).
      subscriber
        .connect()
        .then(async () => {
          // The wait may already have elapsed while connecting; don't leave the connection open
          if (closed) {
            await subscriber.quit();
            return;
          }
          await subscriber.subscribe(`__keyspace@0__:${namespaceKey}`, (message) => {
            switch (message) {
              case 'set':
                resolve(this.get(key, namespace, classConstructor));
                cleanup();
                break;
              case 'del':
              case 'expire':
                resolve(null);
                cleanup();
                break;
              default:
                // Do nothing
                break;
            }
          });
        })
        .catch((error) => {
          // The fallback timer below is still armed and will resolve and clean up
          console.log('Error creating Redis subscriber', error);
        });
      const timer = setTimeout(() => {
        resolve(this.get(key, namespace, classConstructor));
        cleanup();
      }, waitSeconds * 1000);
    });
  }

  get<T>(
    key: string,
    namespace?: string,
    classConstructor?: () => ClassConstructor<T>,
  ): Promise<T | null> {
    namespace = namespace || 'default';
    key = `${namespace}:${key}`;
    return this._client.get(key).then((result) => {
      if (result) {
        if (classConstructor) {
          return plainToInstance(classConstructor(), JSON.parse(result));
        }
        return result as T;
      }
      return null;
    });
  }

  set(key: string, value: string, namespace?: string, expireSeconds?: number): Promise<boolean> {
    namespace = namespace || 'default';
    key = `${namespace}:${key}`;
    const setOptions = expireSeconds ? { EX: expireSeconds } : undefined;
    return this._client.set(key, value, setOptions).then((result) => {
      if (result) {
        return result === 'OK';
      }
      return false;
    });
  }

  setIfNotExist(
    key: string,
    value: string,
    namespace?: string,
    expireSeconds?: number,
  ): Promise<boolean> {
    namespace = namespace || 'default';
    key = `${namespace}:${key}`;
    return this._client
      .set(key, value, expireSeconds ? { EX: expireSeconds, NX: true } : { NX: true })
      .then((result) => {
        if (result) {
          return result === 'OK';
        }
        return false;
      });
  }
}
