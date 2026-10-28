// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { BootstrapConfig } from '@citrineos/base';
import { Model, Sequelize, type ModelStatic } from 'sequelize-typescript';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import {
  type AuthorizationQuerystring,
  type IAuthorizationRepository,
} from '../../../interfaces/index.js';
import { Authorization } from '../model/index.js';
import { AuthorizationTenant } from '../model/AuthorizationTenant.js';
import { AuthorizationLocation } from '../model/AuthorizationLocation.js';
import { SequelizeTenantJunctionRepository } from './BaseJunction.js';
import { selectAuthorization } from '../../../util/selectAuthorization.js';

export class SequelizeAuthorizationRepository
  extends SequelizeTenantJunctionRepository<Authorization>
  implements IAuthorizationRepository
{
  constructor(config: BootstrapConfig, logger?: Logger<ILogObj>, sequelizeInstance?: Sequelize) {
    super(config, Authorization.MODEL_NAME, logger, sequelizeInstance);
  }

  protected getJunctionModel(): ModelStatic<Model> {
    return AuthorizationTenant;
  }

  protected getJunctionForeignKey(): string {
    return 'authorizationId';
  }

  async readAllByQuerystring(
    tenantId: number,
    query: AuthorizationQuerystring,
  ): Promise<Authorization[]> {
    return await super.readAllByQuery(tenantId, this._constructQuery(query, tenantId));
  }

  async readOnlyOneByQuerystring(
    tenantId: number,
    query: AuthorizationQuerystring,
  ): Promise<Authorization | undefined> {
    return await super.readOnlyOneByQuery(tenantId, this._constructQuery(query, tenantId));
  }

  async readBestByQuerystring(
    tenantId: number,
    query: AuthorizationQuerystring,
  ): Promise<Authorization | undefined> {
    const authorizations = await this.readAllByQuerystring(tenantId, query);
    if (authorizations.length > 1) {
      this.logger.warn(
        `idToken ${query.idToken} matches ${authorizations.length} authorizations: ` +
          authorizations
            .map(
              (a) =>
                `${a.id} (tenantPartner=${a.tenantPartnerId}, roamingPartner=${a.roamingPartnerId}, status=${a.status})`,
            )
            .join(', '),
      );
    }
    return selectAuthorization(authorizations);
  }

  /**
   * Private Methods
   */

  private _constructQuery(queryParams: AuthorizationQuerystring, tenantId: number): object {
    const where: any = {};
    if (queryParams.idToken) {
      where.idToken = queryParams.idToken;
    }
    // 1.6 doesn't have the concept of token type. But we need to support token type for 2.0.1 messages.
    if (queryParams.type) {
      where.idTokenType = queryParams.type;
    }

    return {
      where,
      include: [
        {
          model: AuthorizationTenant,
          as: 'tenants',
          required: true,
          where: { tenantId },
          attributes: [],
        },
        {
          model: AuthorizationLocation,
          as: 'locations',
          required: false,
          attributes: ['locationId'],
        },
      ],
    };
  }
}
