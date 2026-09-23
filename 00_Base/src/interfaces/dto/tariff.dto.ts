// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { BaseSchema } from './types/base.dto.js';

export const TariffElementSchema = z.object({
  id: z.number().int().optional(),
  priceComponents: z
    .array(
      z.object({
        type: z.string(),
        price: z.number().min(0),
        vat: z.number().min(0).nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  restrictions: z.record(z.string(), z.any()).nullable().optional(),
});

export const TariffSchema = BaseSchema.extend({
  id: z.number().int().optional(),
  ocpiTariffId: z.string().max(36).nullable().optional(), // OCPI CiString(36)
  currency: z.string().length(3), // CHAR(3)
  authorizationAmount: z.number().min(0).nullable().optional(), // DECIMAL
  paymentFee: z.number().min(0).nullable().optional(), // DECIMAL
  taxRate: z.number().min(0).nullable().optional(), // DECIMAL
  tariffAltText: z.record(z.string(), z.any()).nullable().optional(), // JSONB
  tariffType: z.string().max(36).nullable().optional(),
  tariffAltUrl: z.string().nullable().optional(),
  minPrice: z.record(z.string(), z.any()).nullable().optional(),
  maxPrice: z.record(z.string(), z.any()).nullable().optional(),
  energyMix: z.record(z.string(), z.any()).nullable().optional(),
  startDateTime: z.coerce.date().nullable().optional(),
  endDateTime: z.coerce.date().nullable().optional(),
  tenantPartnerId: z.number().int().nullable().optional(),
  roamingPartnerId: z.number().int().nullable().optional(),
  TariffElements: z.array(TariffElementSchema).nullable().optional(),
});

export const TariffProps = TariffSchema.keyof().enum;

export type TariffDto = z.infer<typeof TariffSchema>;

export const TariffCreateSchema = TariffSchema.omit({
  id: true,
  ocpiTariffId: true,
  tenant: true,
  updatedAt: true,
  createdAt: true,
});

export type TariffCreate = z.infer<typeof TariffCreateSchema>;

export const tariffSchemas = {
  Tariff: TariffSchema,
  TariffCreate: TariffCreateSchema,
};
