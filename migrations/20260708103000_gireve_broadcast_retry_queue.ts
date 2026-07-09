// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import type { QueryInterface } from 'sequelize';

const TABLE_NAME = 'GireveBroadcastRetryQueues';

/**
 * Outbox used to retry failed pushes to Gireve (CDRs, sessions, tariffs).
 *
 * This table is intentionally simple and uses a natural dedupe key:
 * (moduleId, partnerTenantPartnerId, resourceType, resourceId) => latest wins.
 */
export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "${TABLE_NAME}" (
        "id" uuid PRIMARY KEY,
        "partnerTenantPartnerId" integer NOT NULL,
        "cpoCountryCode" text NOT NULL,
        "cpoPartyId" text NOT NULL,
        "moduleId" text NOT NULL,
        "interfaceRole" text NOT NULL,
        "httpMethod" text NOT NULL,
        "resourceType" text NOT NULL,
        "resourceId" text NOT NULL,
        "ocpiPath" text,
        "payload" jsonb NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "attemptCount" integer NOT NULL DEFAULT 0,
        "nextRetryAt" timestamptz NOT NULL,
        "lastError" text,
        "sentAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("moduleId", "partnerTenantPartnerId", "resourceType", "resourceId")
      );
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "${TABLE_NAME}";
    `);
  },
};
