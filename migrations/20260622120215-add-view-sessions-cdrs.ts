// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
        CREATE OR REPLACE VIEW "OCPISessionsWithCdr" AS
        SELECT
  COALESCE(s."tenantId", c."tenantId") AS "tenantId",
  s."id"              AS "sessionId",
  COALESCE(s."tenantPartnerId", c."tenantPartnerId") AS "tenantPartnerId",
  COALESCE(s."roamingPartnerId", c."roamingPartnerId") AS "roamingPartnerId",
  s."ocpiSessionId",
  COALESCE(s."countryCode", c."countryCode") AS "countryCode",
  COALESCE(s."partyId", c."partyId") AS "partyId",
  s."startDateTime",
  s."endDateTime",
  s."lastUpdated"     AS "sessionLastUpdated",
  s."status",
  c."id"              AS "cdrId",
  c."ocpiCdrId",
  c."credit",
  c."creditReferenceId",
  c."lastUpdated"     AS "cdrLastUpdated"
FROM "Sessions" s
FULL OUTER JOIN "Cdrs" c
  ON c."sessionId" = s."ocpiSessionId"
 AND c."countryCode" = s."countryCode"
 AND c."partyId" = s."partyId"
 AND c."tenantPartnerId" = s."tenantPartnerId"
 AND c."roamingPartnerId" IS NOT DISTINCT FROM s."roamingPartnerId"
WHERE s."id" IS NULL
   OR (s."status" = 'COMPLETED' AND s."endDateTime" IS NOT NULL);
      `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      DROP VIEW IF EXISTS "OCPISessionsWithCdr"
    `);
  },
};
