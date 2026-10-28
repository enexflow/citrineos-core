// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { AuthorizationStatusEnum } from '@citrineos/base';

export type AuthorizationSelection = {
  id?: number;
  status?: string | null;
  cacheExpiryDateTime?: string | Date | null;
  updatedAt?: string | Date | null;
};

/**
 * enexflow: an idToken can exist once per (tenantPartner, roamingPartner),
 * e.g. a token moved from one eMSP to another behind a hub.
 * Pick deterministically: usable rows first, then most recently updated.
 */
export function selectAuthorization<T extends AuthorizationSelection>(
  authorizations: T[] | undefined,
  now: Date = new Date(),
): T | undefined {
  if (!authorizations?.length) return undefined;
  const isUsable = (a: T): boolean =>
    (!a.status || a.status === AuthorizationStatusEnum.Accepted) &&
    (!a.cacheExpiryDateTime || new Date(a.cacheExpiryDateTime) > now);
  const time = (a: T): number => (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
  return [...authorizations].sort(
    (a, b) =>
      Number(isUsable(b)) - Number(isUsable(a)) || time(b) - time(a) || (b.id ?? 0) - (a.id ?? 0),
  )[0];
}
