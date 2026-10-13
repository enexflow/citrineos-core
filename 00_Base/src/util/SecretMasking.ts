// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { OCPP2_0_1 } from '../ocpp/model/index.js';
import { MessageTypeId } from '../ocpp/rpc/message.js';

/** Placeholder written in place of a station credential in OCPP history, logs and webhooks. */
export const MASKED_SECRET = '********';

type JsonRecord = Record<string, unknown>;

const PASSWORD_VARIABLE_NAMES = new Set(['basicauthpassword']);
// OCPP 1.6 Security Whitepaper: AuthorizationKey is the Basic Auth password of the station.
const OCPP16_SECRET_CONFIGURATION_KEYS = new Set(['authorizationkey']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tell whether a device model variable holds a credential (names are case-insensitive in OCPP). */
export function isPasswordVariable(variableName: unknown, dataType?: unknown): boolean {
  return (
    dataType === OCPP2_0_1.DataEnumType.passwordString ||
    (typeof variableName === 'string' && PASSWORD_VARIABLE_NAMES.has(variableName.toLowerCase()))
  );
}

/** Tell whether an OCPP 1.6 configuration key holds a credential. */
export function isOcpp16SecretConfigurationKey(key: unknown): boolean {
  return typeof key === 'string' && OCPP16_SECRET_CONFIGURATION_KEYS.has(key.toLowerCase());
}

function maskField(item: JsonRecord, field: string): JsonRecord {
  const value = item[field];
  return typeof value === 'string' && value !== '' ? { ...item, [field]: MASKED_SECRET } : item;
}

function mapItems(
  payload: JsonRecord,
  field: string,
  mask: (item: JsonRecord) => JsonRecord,
): JsonRecord {
  const items = payload[field];
  if (!Array.isArray(items)) {
    return payload;
  }
  let changed = false;
  const maskedItems = items.map((item: unknown) => {
    if (!isRecord(item)) {
      return item;
    }
    const maskedItem = mask(item);
    changed ||= maskedItem !== item;
    return maskedItem;
  });
  return changed ? { ...payload, [field]: maskedItems } : payload;
}

function variableNameOf(item: JsonRecord): unknown {
  return isRecord(item.variable) ? item.variable.name : undefined;
}

function maskPasswordAttributeValue(item: JsonRecord): JsonRecord {
  return isPasswordVariable(variableNameOf(item)) ? maskField(item, 'attributeValue') : item;
}

/** Return the payload with credentials masked, copying only what changes; the input is never mutated. */
export function maskOcppPayloadSecrets<T>(payload: T): T {
  if (!isRecord(payload)) {
    return payload;
  }
  let masked: JsonRecord = payload;
  // 2.0.1 SetVariablesRequest and GetVariablesResponse
  masked = mapItems(masked, 'setVariableData', maskPasswordAttributeValue);
  masked = mapItems(masked, 'getVariableResult', maskPasswordAttributeValue);
  // 2.0.1 NotifyReportRequest
  masked = mapItems(masked, 'reportData', (reportData) => {
    const characteristics = reportData.variableCharacteristics;
    const dataType = isRecord(characteristics) ? characteristics.dataType : undefined;
    return isPasswordVariable(variableNameOf(reportData), dataType)
      ? mapItems(reportData, 'variableAttribute', (attribute) => maskField(attribute, 'value'))
      : reportData;
  });
  // 1.6 GetConfigurationResponse
  masked = mapItems(masked, 'configurationKey', (configuration) =>
    isOcpp16SecretConfigurationKey(configuration.key)
      ? maskField(configuration, 'value')
      : configuration,
  );
  // 1.6 ChangeConfigurationRequest
  if (isOcpp16SecretConfigurationKey(masked.key)) {
    masked = maskField(masked, 'value');
  }
  return masked as T;
}

/** Return an OCPP-J Call or CallResult with credentials masked; the input is never mutated. */
export function maskOcppMessageSecrets<T>(rpcMessage: T): T {
  if (!Array.isArray(rpcMessage)) {
    return rpcMessage;
  }
  const payloadIndex =
    rpcMessage[0] === MessageTypeId.Call
      ? 3
      : rpcMessage[0] === MessageTypeId.CallResult
        ? 2
        : undefined;
  if (payloadIndex === undefined) {
    return rpcMessage;
  }
  const payload: unknown = rpcMessage[payloadIndex];
  const maskedPayload = maskOcppPayloadSecrets(payload);
  if (maskedPayload === payload) {
    return rpcMessage;
  }
  const masked: unknown[] = [...rpcMessage];
  masked[payloadIndex] = maskedPayload;
  return masked as T;
}

/** Mask credentials in a raw OCPP-J frame; an unparseable frame is returned as is. */
export function maskRawOcppMessageSecrets(rawMessage: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return rawMessage;
  }
  const masked = maskOcppMessageSecrets(parsed);
  return masked === parsed ? rawMessage : JSON.stringify(masked);
}

/** Drop the values a station reports for a credential, so a report never replaces the stored hash. */
export function omitReportedPasswordValues(
  reportData: OCPP2_0_1.ReportDataType,
): OCPP2_0_1.ReportDataType {
  if (
    !isPasswordVariable(reportData.variable?.name, reportData.variableCharacteristics?.dataType)
  ) {
    return reportData;
  }
  return {
    ...reportData,
    variableAttribute: reportData.variableAttribute.map(
      ({ value: _value, ...attribute }) => attribute,
    ) as OCPP2_0_1.ReportDataType['variableAttribute'],
  };
}
