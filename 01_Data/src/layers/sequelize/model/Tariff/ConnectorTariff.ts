// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_TENANT_ID } from '@citrineos/base';
import type { CreationOptional } from 'sequelize';
import {
  BeforeCreate,
  BeforeUpdate,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import type { ConnectorDto, TariffDto, TenantDto, TenantPartnerDto } from '@citrineos/base';
import { Tenant } from '../Tenant.js';
import { TenantPartner } from '../TenantPartner.js';
import { Connector } from '../Location/Connector.js';
import { Tariff } from './Tariffs.js';

@Table({ tableName: 'ConnectorTariffs' })
export class ConnectorTariff extends Model {
  static readonly MODEL_NAME: string = 'ConnectorTariff';

  declare id: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  @Column({ type: DataType.STRING(36), allowNull: false })
  declare connectorOcpiId: string;

  @Column({ type: DataType.STRING(36), allowNull: false })
  declare tariffOcpiId: string;

  @ForeignKey(() => Connector)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  })
  declare connectorId: number;
  @BelongsTo(() => Connector)
  declare connector?: ConnectorDto;
  @ForeignKey(() => Tariff)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  })
  declare tariffId: number;
  @BelongsTo(() => Tariff)
  declare tariff?: TariffDto;
  @ForeignKey(() => TenantPartner)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  })
  declare tenantPartnerId?: number | null;
  @BelongsTo(() => TenantPartner)
  declare tenantPartner?: TenantPartnerDto; // not TenantPartner
  @ForeignKey(() => Tenant)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  })
  declare tenantId: number;
  @BelongsTo(() => Tenant)
  declare tenant?: TenantDto;

  //   @BelongsTo(() => Tenant)
  //   declare tenant?: Tenant;

  //   public static newInstance(data: ConnectorTariffData): ConnectorTariff {
  //     return ConnectorTariff.build({ ...data });
  //   }

  //   @BelongsTo(() => Connector)
  // declare connector?: ConnectorDto;
  // @BelongsTo(() => Tariff)
  // declare tariff?: TariffDto;

  @BeforeUpdate
  @BeforeCreate
  static setDefaultTenant(instance: ConnectorTariff) {
    if (instance.tenantId == null) {
      instance.tenantId = DEFAULT_TENANT_ID;
    }
  }

  constructor(...args: any[]) {
    super(...args);
    if (this.tenantId == null) {
      this.tenantId = DEFAULT_TENANT_ID;
    }
  }
}

export interface ConnectorTariffData {
  connectorOcpiId: string;
  tariffOcpiId: string;
  connectorId: number;
  tariffId: number;
  tenantPartnerId?: number | null;
  tenantId?: number;
}
