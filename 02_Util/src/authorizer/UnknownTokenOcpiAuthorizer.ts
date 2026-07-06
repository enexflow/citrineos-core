// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  AuthorizationStatusEnum,
  type AuthorizationStatusEnumType,
  type IdTokenEnumType,
  type IMessageContext,
  type SystemConfig,
} from '@citrineos/base';
import type { ILocationRepository, ITenantPartnerRepository } from '@citrineos/data';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { OidcTokenProvider } from '../authorization/index.js';
import type {
  RealTimeAuthorizationRequestBody,
  RealTimeAuthorizationResponse,
} from './RealTimeAuthorizer.js';

// The hub TenantPartner that unknown tokens are delegated to for real-time authorization.
// Warning : As of now, only one hub partner is supported. In case of several partners, need for a rework to send authorization to all partners.
const HUB_PARTNER_PARTY_IDS = ['007', '107'];

/**
 * Delegates real-time authorization of unknown tokens to the OCPI module's
 * `/realTimeAuth` endpoint, which performs the OCPI `POST /authorize` against the eMSP.
 */
export class UnknownTokenOcpiAuthorizer {
  private readonly _locationRepository: ILocationRepository;
  private readonly _tenantPartnerRepository: ITenantPartnerRepository;
  private readonly _config: SystemConfig;
  private readonly _logger: Logger<ILogObj>;
  private readonly _oidcTokenProvider?: OidcTokenProvider;

  constructor(
    locationRepository: ILocationRepository,
    tenantPartnerRepository: ITenantPartnerRepository,
    config: SystemConfig,
    logger?: Logger<ILogObj>,
  ) {
    this._locationRepository = locationRepository;
    this._tenantPartnerRepository = tenantPartnerRepository;
    this._config = config;
    this._logger = logger
      ? logger.getSubLogger({ name: this.constructor.name })
      : new Logger<ILogObj>({ name: this.constructor.name });
    if (config.oidcClient) {
      this._oidcTokenProvider = new OidcTokenProvider(config.oidcClient, this._logger);
    }
  }

  async authorize(
    idToken: string,
    idTokenType: IdTokenEnumType,
    context: IMessageContext,
  ): Promise<AuthorizationStatusEnumType> {
    const hubPartner = await this._tenantPartnerRepository.getHubPartner(
      context.tenantId,
      HUB_PARTNER_COUNTRY_CODE,
      HUB_PARTNER_PARTY_IDS,
    );
    if (!hubPartner?.id) {
      this._logger.debug(
        `No hub TenantPartner found for tenant ${context.tenantId} (${HUB_PARTNER_COUNTRY_CODE} ${HUB_PARTNER_PARTY_IDS.join('/')}); cannot delegate real-time authorization`,
      );
      return AuthorizationStatusEnum.Unknown;
    }

    const chargingStation = await this._locationRepository.readChargingStationByStationId(
      context.tenantId,
      context.stationId,
    );

    const payload: RealTimeAuthorizationRequestBody = {
      tenantPartnerId: hubPartner.id,
      idToken,
      idTokenType,
      locationId: chargingStation?.locationId?.toString(),
      stationId: context.stationId,
    };

    const url = this._buildRealTimeAuthUrl();
    this._logger.debug(
      `Delegating unknown-token real-time authorization for partner ${hubPartner.id} to ${url}`,
    );

    try {
      const headers: { [key: string]: string } = {
        'Content-Type': 'application/json',
      };
      // The OCPI `/realTimeAuth` endpoint is an admin endpoint. When citrineos-ocpi is
      // configured with OIDC, it expects a Bearer JWT (client-credentials); otherwise we
      // fall back to the legacy `Token <adminToken>` scheme.
      if (this._oidcTokenProvider) {
        try {
          const token = await this._oidcTokenProvider.getToken();
          headers['Authorization'] = `Bearer ${token}`;
        } catch (error) {
          this._logger.error('Failed to get OIDC token for real-time authorization:', error);
          return AuthorizationStatusEnum.Unknown;
        }
      } else if (this._config.ocpiServer.adminToken) {
        headers['Authorization'] = `Token ${this._config.ocpiServer.adminToken}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        this._logger.error(
          `Real-time authorization request to ${url} failed: HTTP ${response.status} ${responseBody}`,
        );
        return AuthorizationStatusEnum.Unknown;
      }

      const responseJson = (await response.json()) as RealTimeAuthorizationResponse;
      this._logger.debug(`Real-time auth response: ${responseJson?.data?.allowed}`);

      switch (responseJson?.data?.allowed) {
        case 'ALLOWED':
          return AuthorizationStatusEnum.Accepted;
        case 'BLOCKED':
          return AuthorizationStatusEnum.Blocked;
        case 'EXPIRED':
          return AuthorizationStatusEnum.Expired;
        case 'NO_CREDIT':
          return AuthorizationStatusEnum.NoCredit;
        case 'NOT_ALLOWED':
          return AuthorizationStatusEnum.NotAtThisLocation;
        default:
          return AuthorizationStatusEnum.Unknown;
      }
    } catch (error) {
      this._logger.error(`Real-time authorization for unknown token failed: ${error}`);
      return AuthorizationStatusEnum.Unknown;
    }
  }

  private _buildRealTimeAuthUrl(): string {
    const { host, port, version } = this._config.ocpiServer;
    // Mirrors the citrineos-ocpi route: global '/ocpi' prefix + Tokens controller
    // base '/:role(cpo|emsp)/:versionId/tokens' + the '/realTimeAuth' admin endpoint.
    return `http://${host}:${port}/ocpi/emsp/${version}/tokens/realTimeAuth`;
  }
}
