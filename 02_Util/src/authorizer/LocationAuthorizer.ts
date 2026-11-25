// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  AuthMethodEnum,
  AuthorizationStatusEnum,
  IdTokenEnum,
  LocationAuthorizationMode,
  type AuthorizationStatusEnumType,
  type IAuthorizer,
  type IdTokenEnumType,
  type IMessageContext,
  type LocationAuthorizationModeType,
  type SystemConfig,
} from '@citrineos/base';
import type { Authorization, ILocationRepository } from '@citrineos/data';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';

/** Token types that identify a physical badge. Other types (Central, eMAID, ...) are not checked. */
const CHECKED_ID_TOKEN_TYPES: ReadonlySet<IdTokenEnumType> = new Set([
  IdTokenEnum.ISO14443,
  IdTokenEnum.MacAddress,
]);

/**
 * enexflow fork (TECH-2463): restricts locally managed badges to the locations listed in
 * `Authorization.locations`. A badge with no location, or whose locations do not include the
 * station's location, is refused with `NotAtThisLocation`.
 *
 * Only tokens without a tenant partner, whose OCPI auth method is neither COMMAND nor
 * AUTH_REQUEST, and whose type is ISO14443 or MacAddress are checked. Partner tokens, remote
 * start commands and technical tokens pass through.
 *
 * Behaviour is driven by `SystemConfig.locationAuthorizationMode`:
 * - `off`: no check.
 * - `log-only`: would-be refusals are logged and the token is accepted.
 * - `enforce`: would-be refusals are returned.
 *
 * Never persists the authorization: saving it would fire the AuthorizationNotify trigger and
 * push Token PATCHes to OCPI partners.
 */
export class LocationAuthorizer implements IAuthorizer {
  private readonly _locationRepository: ILocationRepository;
  private readonly _config: SystemConfig;
  private readonly _logger: Logger<ILogObj>;

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
  }

  async authorize(
    authorization: Authorization,
    context: IMessageContext,
  ): Promise<AuthorizationStatusEnumType> {
    const mode = this._mode();
    if (mode === LocationAuthorizationMode.off) {
      return authorization.status;
    }
    if (authorization.status !== AuthorizationStatusEnum.Accepted) {
      return authorization.status;
    }
    if (!this._isInScope(authorization)) {
      return authorization.status;
    }

    const tokenLabel = `authorization ${authorization.id} (${authorization.idTokenType})`;
    const refusal =
      mode === LocationAuthorizationMode.enforce ? 'refusing' : '[log-only] would refuse';

    if (authorization.locations === undefined || authorization.locations === null) {
      this._logger.error(
        `Locations not loaded for ${tokenLabel} at station ${context.stationId}, ${refusal}`,
      );
      return this._refuse(mode, AuthorizationStatusEnum.Invalid);
    }

    const station = await this._locationRepository.readChargingStationByStationId(
      context.tenantId,
      context.stationId,
    );
    const stationLocationId = station?.locationId;
    if (stationLocationId === undefined || stationLocationId === null) {
      this._logger.error(
        `Station ${context.stationId} (tenant ${context.tenantId}) has no locationId, ${refusal} ${tokenLabel}`,
      );
      return this._refuse(mode, AuthorizationStatusEnum.NotAtThisLocation);
    }

    const allowedLocationIds = authorization.locations.map((l) => l.locationId);
    if (!allowedLocationIds.includes(stationLocationId)) {
      this._logger.warn(
        `Station ${context.stationId}: ${refusal} ${tokenLabel}, station location ${stationLocationId} not in allowed locations [${allowedLocationIds.join(', ')}]`,
      );
      return this._refuse(mode, AuthorizationStatusEnum.NotAtThisLocation);
    }

    return authorization.status;
  }

  private _mode(): LocationAuthorizationModeType {
    return this._config.locationAuthorizationMode ?? LocationAuthorizationMode['log-only'];
  }

  private _isInScope(authorization: Authorization): boolean {
    if (authorization.tenantPartnerId !== undefined && authorization.tenantPartnerId !== null) {
      return false;
    }
    if (
      authorization.ocpiAuthMethod === AuthMethodEnum.COMMAND ||
      authorization.ocpiAuthMethod === AuthMethodEnum.AUTH_REQUEST
    ) {
      return false;
    }
    return !!authorization.idTokenType && CHECKED_ID_TOKEN_TYPES.has(authorization.idTokenType);
  }

  private _refuse(
    mode: LocationAuthorizationModeType,
    status: AuthorizationStatusEnumType,
  ): AuthorizationStatusEnumType {
    return mode === LocationAuthorizationMode.enforce ? status : AuthorizationStatusEnum.Accepted;
  }
}
