// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { BootstrapConfig } from '@citrineos/base';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { ITenantPartnerRepository } from '../../../interfaces/index.js';
import { TenantPartner } from '../model/TenantPartner.js';
import { SequelizeRepository } from './Base.js';

export class SequelizeTenantPartnerRepository
  extends SequelizeRepository<TenantPartner>
  implements ITenantPartnerRepository
{
  constructor(config: BootstrapConfig, logger?: Logger<ILogObj>, sequelizeInstance?: Sequelize) {
    super(config, TenantPartner.MODEL_NAME, logger, sequelizeInstance);
  }

  async getHubPartner(
    tenantId: number,
    countryCode: string,
    partyIds: string[],
  ): Promise<TenantPartner | undefined> {
    const partners = await this.readAllByQuery(tenantId, {
      where: {
        tenantId,
        countryCode,
        partyId: { [Op.in]: partyIds },
      },
    });
    return partners[0];
  }
}
