// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  isOcpp16SecretConfigurationKey,
  isPasswordVariable,
  MASKED_SECRET,
  maskOcppMessageSecrets,
  maskOcppPayloadSecrets,
  maskRawOcppMessageSecrets,
  OCPP2_0_1,
  omitReportedPasswordValues,
} from '../../src';

const PASSWORD = 'S3cret-Station-Password!';

function setVariablesCall(variableName: string, value: string): any[] {
  return [
    2,
    'msg-1',
    'SetVariables',
    {
      setVariableData: [
        {
          component: { name: 'OCPPCommCtrlr' },
          variable: { name: 'HeartbeatInterval' },
          attributeValue: '60',
        },
        {
          component: { name: 'SecurityCtrlr' },
          variable: { name: variableName },
          attributeType: 'Actual',
          attributeValue: value,
        },
      ],
    },
  ];
}

describe('SecretMasking', () => {
  describe('isPasswordVariable', () => {
    it('should match BasicAuthPassword case-insensitively', () => {
      expect(isPasswordVariable('BasicAuthPassword')).toBe(true);
      expect(isPasswordVariable('basicauthpassword')).toBe(true);
    });

    it('should match any passwordString variable', () => {
      expect(isPasswordVariable('VendorSecret', OCPP2_0_1.DataEnumType.passwordString)).toBe(true);
    });

    it('should not match other variables', () => {
      expect(isPasswordVariable('HeartbeatInterval', OCPP2_0_1.DataEnumType.integer)).toBe(false);
      expect(isPasswordVariable(undefined)).toBe(false);
    });
  });

  describe('isOcpp16SecretConfigurationKey', () => {
    it('should match AuthorizationKey case-insensitively', () => {
      expect(isOcpp16SecretConfigurationKey('AuthorizationKey')).toBe(true);
      expect(isOcpp16SecretConfigurationKey('authorizationkey')).toBe(true);
      expect(isOcpp16SecretConfigurationKey('HeartbeatInterval')).toBe(false);
      expect(isOcpp16SecretConfigurationKey(undefined)).toBe(false);
    });
  });

  describe('maskOcppMessageSecrets', () => {
    it('should mask the BasicAuthPassword of a SetVariables call without mutating it', () => {
      const call = setVariablesCall('BasicAuthPassword', PASSWORD);
      const original = structuredClone(call);

      const masked = maskOcppMessageSecrets(call);

      expect(call).toEqual(original);
      expect(JSON.stringify(masked)).not.toContain(PASSWORD);
      expect(masked).toEqual([
        2,
        'msg-1',
        'SetVariables',
        {
          setVariableData: [
            original[3].setVariableData[0],
            { ...original[3].setVariableData[1], attributeValue: MASKED_SECRET },
          ],
        },
      ]);
      // Untouched entries are shared, not copied.
      expect((masked as any)[3].setVariableData[0]).toBe(call[3].setVariableData[0]);
    });

    it('should mask a password returned in a GetVariables result', () => {
      const callResult = [
        3,
        'msg-2',
        {
          getVariableResult: [
            {
              attributeStatus: 'Accepted',
              component: { name: 'SecurityCtrlr' },
              variable: { name: 'BasicAuthPassword' },
              attributeValue: PASSWORD,
            },
          ],
        },
      ];

      const masked = maskOcppMessageSecrets(callResult);

      expect(JSON.stringify(masked)).not.toContain(PASSWORD);
      expect((masked as any)[2].getVariableResult[0].attributeValue).toBe(MASKED_SECRET);
    });

    it('should mask the password values of a NotifyReport', () => {
      const call = [
        2,
        'msg-3',
        'NotifyReport',
        {
          requestId: 1,
          generatedAt: '2026-10-13T00:00:00Z',
          seqNo: 0,
          reportData: [
            {
              component: { name: 'SecurityCtrlr' },
              variable: { name: 'BasicAuthPassword' },
              variableAttribute: [{ type: 'Actual', value: PASSWORD, mutability: 'WriteOnly' }],
            },
            {
              component: { name: 'VendorCtrlr' },
              variable: { name: 'VendorSecret' },
              variableAttribute: [{ value: 'vendor-secret' }],
              variableCharacteristics: { dataType: 'passwordString', supportsMonitoring: false },
            },
            {
              component: { name: 'SecurityCtrlr' },
              variable: { name: 'SecurityProfile' },
              variableAttribute: [{ value: '1' }],
            },
          ],
        },
      ];

      const masked = maskOcppMessageSecrets(call) as any;

      expect(JSON.stringify(masked)).not.toContain(PASSWORD);
      expect(JSON.stringify(masked)).not.toContain('vendor-secret');
      expect(masked[3].reportData[0].variableAttribute[0]).toEqual({
        type: 'Actual',
        value: MASKED_SECRET,
        mutability: 'WriteOnly',
      });
      expect(masked[3].reportData[2].variableAttribute[0].value).toBe('1');
    });

    it('should mask an OCPP 1.6 ChangeConfiguration AuthorizationKey', () => {
      const call = [
        2,
        'msg-4',
        'ChangeConfiguration',
        { key: 'AuthorizationKey', value: PASSWORD },
      ];

      expect(maskOcppMessageSecrets(call)).toEqual([
        2,
        'msg-4',
        'ChangeConfiguration',
        { key: 'AuthorizationKey', value: MASKED_SECRET },
      ]);
    });

    it('should mask an AuthorizationKey returned by an OCPP 1.6 GetConfiguration', () => {
      const callResult = [
        3,
        'msg-5',
        {
          configurationKey: [
            { key: 'HeartbeatInterval', readonly: false, value: '60' },
            { key: 'AuthorizationKey', readonly: false, value: PASSWORD },
          ],
        },
      ];

      const masked = maskOcppMessageSecrets(callResult) as any;

      expect(masked[2].configurationKey).toEqual([
        { key: 'HeartbeatInterval', readonly: false, value: '60' },
        { key: 'AuthorizationKey', readonly: false, value: MASKED_SECRET },
      ]);
    });

    it('should return messages without credentials as is', () => {
      const call = setVariablesCall('HeartbeatInterval', '60');
      const callError = [4, 'msg-6', 'InternalError', 'boom', {}];

      expect(maskOcppMessageSecrets(call)).toBe(call);
      expect(maskOcppMessageSecrets(callError)).toBe(callError);
      expect(maskOcppMessageSecrets('not an rpc message')).toBe('not an rpc message');
    });

    it('should keep an empty password as is', () => {
      const call = setVariablesCall('BasicAuthPassword', '');

      expect(maskOcppMessageSecrets(call)).toBe(call);
    });
  });

  describe('maskOcppPayloadSecrets', () => {
    it('should mask a bare payload', () => {
      const payload = { key: 'AuthorizationKey', value: PASSWORD };

      expect(maskOcppPayloadSecrets(payload)).toEqual({
        key: 'AuthorizationKey',
        value: MASKED_SECRET,
      });
      expect(payload.value).toBe(PASSWORD);
    });
  });

  describe('maskRawOcppMessageSecrets', () => {
    it('should mask a raw frame', () => {
      const raw = JSON.stringify(setVariablesCall('BasicAuthPassword', PASSWORD));

      const masked = maskRawOcppMessageSecrets(raw);

      expect(masked).not.toContain(PASSWORD);
      expect(masked).toContain(MASKED_SECRET);
    });

    it('should return clean or unparseable frames unchanged', () => {
      const clean = JSON.stringify(setVariablesCall('HeartbeatInterval', '60'));

      expect(maskRawOcppMessageSecrets(clean)).toBe(clean);
      expect(maskRawOcppMessageSecrets('[2, "msg", ')).toBe('[2, "msg", ');
    });
  });

  describe('omitReportedPasswordValues', () => {
    it('should drop the reported values of a password variable', () => {
      const reportData: OCPP2_0_1.ReportDataType = {
        component: { name: 'SecurityCtrlr' },
        variable: { name: 'BasicAuthPassword' },
        variableAttribute: [
          {
            type: OCPP2_0_1.AttributeEnumType.Actual,
            value: PASSWORD,
            mutability: OCPP2_0_1.MutabilityEnumType.WriteOnly,
          },
        ],
      };

      const result = omitReportedPasswordValues(reportData);

      expect(result.variableAttribute).toEqual([
        {
          type: OCPP2_0_1.AttributeEnumType.Actual,
          mutability: OCPP2_0_1.MutabilityEnumType.WriteOnly,
        },
      ]);
      expect('value' in result.variableAttribute[0]).toBe(false);
      expect(reportData.variableAttribute[0].value).toBe(PASSWORD);
    });

    it('should keep other variables as is', () => {
      const reportData: OCPP2_0_1.ReportDataType = {
        component: { name: 'SecurityCtrlr' },
        variable: { name: 'SecurityProfile' },
        variableAttribute: [{ value: '1' }],
      };

      expect(omitReportedPasswordValues(reportData)).toBe(reportData);
    });
  });
});
