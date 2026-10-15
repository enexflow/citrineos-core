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
import type { ILocationRepository } from '@citrineos/data';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { OidcTokenProvider } from '../authorization/index.js';
import type {
  RealTimeAuthorizationRequestBody,
  RealTimeAuthorizationResponse,
} from './RealTimeAuthorizer.js';

const REAL_TIME_AUTH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Delegates real-time authorization of unknown tokens to the OCPI module's
 * `/realTimeAuth` endpoint, which asks every real-time eMSP/hub partner in parallel.
 */
export class UnknownTokenOcpiAuthorizer {
  private readonly _locationRepository: ILocationRepository;
  private readonly _config: SystemConfig;
  private readonly _logger: Logger<ILogObj>;
  private readonly _oidcTokenProvider?: OidcTokenProvider;

  constructor(
    locationRepository: ILocationRepository,
    config: SystemConfig,
    logger?: Logger<ILogObj>,
  ) {
    this._locationRepository = locationRepository;
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
    const chargingStation = await this._locationRepository.readChargingStationByStationId(
      context.tenantId,
      context.stationId,
    );
    const location = chargingStation?.locationId
      ? await this._locationRepository.readByKey(context.tenantId, chargingStation.locationId)
      : undefined;
    if (location?.disableOCPI) {
      this._logger.debug(
        `OCPI disabled on location ${location.id} of station ${context.stationId}, skipping partner authorization`,
      );
      return AuthorizationStatusEnum.Unknown;
    }

    const payload: RealTimeAuthorizationRequestBody = {
      tenantId: context.tenantId,
      idToken,
      idTokenType,
      locationId: chargingStation?.locationId?.toString(),
      stationId: context.stationId,
    };

    const url = this._buildRealTimeAuthUrl();
    this._logger.debug(`Delegating unknown-token real-time authorization to ${url}`);

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
        signal: AbortSignal.timeout(REAL_TIME_AUTH_REQUEST_TIMEOUT_MS),
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
