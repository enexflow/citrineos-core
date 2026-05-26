// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod/v4';
import { PartnerProfileSchema } from './types/ocpi.registration.js';

export const OcpiIntegrationSchema = z.object({
  id: z.number().int().optional(),
  partnerProfileOCPI: PartnerProfileSchema.nullable().optional(),
  updatedAt: z.date().optional(),
  createdAt: z.date().optional(),
});

export const OcpiIntegrationProps = OcpiIntegrationSchema.keyof().enum;

export type OcpiIntegrationDto = z.infer<typeof OcpiIntegrationSchema>;

export const OcpiIntegrationCreateSchema = OcpiIntegrationSchema.omit({
  id: true,
  updatedAt: true,
  createdAt: true,
});

export type OcpiIntegrationCreate = z.infer<typeof OcpiIntegrationCreateSchema>;

export const ocpiIntegrationSchemas = {
  OcpiIntegration: OcpiIntegrationSchema,
  OcpiIntegrationCreate: OcpiIntegrationCreateSchema,
};
