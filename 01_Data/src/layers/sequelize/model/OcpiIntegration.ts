// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { OcpiIntegrationDto, PartnerProfile } from '@citrineos/base';
import { Column, DataType, HasMany, Model, Table } from 'sequelize-typescript';
import { TenantPartner } from './TenantPartner.js';

@Table
export class OcpiIntegration extends Model implements OcpiIntegrationDto {
  static readonly MODEL_NAME: string = 'OcpiIntegration';

  @Column(DataType.JSONB)
  declare partnerProfileOCPI?: PartnerProfile | null;

  @HasMany(() => TenantPartner)
  declare tenantPartners?: TenantPartner[];
}
