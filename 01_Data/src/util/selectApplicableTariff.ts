// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { TariffDto } from '@citrineos/base';

export type ConnectorTariffSelection = {
  id?: number;
  tariffId: number;
  tariff?: TariffDto;
};

export function selectApplicableTariff(
  connectorTariffs: ConnectorTariffSelection[] | undefined,
  timestamp: Date,
): number | undefined {
  if (!connectorTariffs?.length) return undefined;
  const applicable = connectorTariffs.find((ct) => {
    const tariff = ct.tariff;
    if (!tariff) return false;
    const start = tariff.startDateTime ? new Date(tariff.startDateTime) : null;
    const end = tariff.endDateTime ? new Date(tariff.endDateTime) : null;
    if (start && timestamp < start) return false;
    if (end && timestamp > end) return false;
    return true;
  });

  return applicable?.tariff?.id ?? applicable?.tariffId;
}
