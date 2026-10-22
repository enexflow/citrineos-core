// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { MASKED_SECRET } from '../util/SecretMasking.js';

// Tested on the lowercased key without separators; anchoring spares tokenUrl and *KeyFilePath.
const CREDENTIAL_KEY = /password|secret|(token|apikey|privatekey|accesskey(id)?|credentials?)$/;

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function maskUrlPassword(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (!url.password) {
    return value;
  }
  url.password = MASKED_SECRET;
  return url.href;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskUrlPassword(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        isCredentialKey(key) && nested !== undefined && nested !== null
          ? MASKED_SECRET
          : redact(nested),
      ]),
    );
  }
  return value;
}

/** Return a deep copy of a configuration with its credentials masked; the input is never mutated. */
export function redactConfig<T>(config: T): T {
  return redact(config) as T;
}
