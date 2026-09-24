// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Split Cdrs.tenantPartnerId into from/to for received vs sent CDRs.
 * Existing rows are received → fromTenantPartnerId = tenantPartnerId.
 */
export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`

      -- Views depend on Cdrs.tenantPartnerId
      DROP VIEW IF EXISTS "OCPISessionsWithCdr";

      -- Old unique indexes reference tenantPartnerId
      DROP INDEX IF EXISTS "Cdrs_ocpiCdrId_tenantPartnerId_key";
      DROP INDEX IF EXISTS "Cdrs_ocpiCdrId_tenantPartnerId_roamingPartnerId_key";
      DROP INDEX IF EXISTS "idx_cdrs_tenant_partner_id";

      ALTER TABLE "Cdrs"
        DROP CONSTRAINT IF EXISTS "Cdrs_tenantPartnerId_fkey";

      ALTER TABLE "Cdrs"
        ADD COLUMN IF NOT EXISTS "fromTenantPartnerId" INTEGER
          REFERENCES "TenantPartners"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS "toTenantPartnerId" INTEGER
          REFERENCES "TenantPartners"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS "transactionId" INTEGER
          REFERENCES "Transactions"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "successfullySentAt" TIMESTAMPTZ;

      -- All existing rows are received CDRs
      UPDATE "Cdrs"
      SET "fromTenantPartnerId" = "tenantPartnerId"
      WHERE "fromTenantPartnerId" IS NULL
        AND "tenantPartnerId" IS NOT NULL;

      ALTER TABLE "Cdrs"
        DROP COLUMN IF EXISTS "tenantPartnerId";

      -- Exactly one counterparty side for P2P
      ALTER TABLE "Cdrs"
        DROP CONSTRAINT IF EXISTS "Cdrs_from_or_to_partner_check";
      ALTER TABLE "Cdrs"
        ADD CONSTRAINT "Cdrs_from_or_to_partner_check" CHECK (
          ("fromTenantPartnerId" IS NOT NULL AND "toTenantPartnerId" IS NULL)
          OR
          ("fromTenantPartnerId" IS NULL AND "toTenantPartnerId" IS NOT NULL)
        );

      -- Received uniqueness (from partner)
      CREATE UNIQUE INDEX IF NOT EXISTS "Cdrs_ocpiCdrId_fromTenantPartnerId_key"
        ON "Cdrs" ("ocpiCdrId", "fromTenantPartnerId")
        WHERE "fromTenantPartnerId" IS NOT NULL AND "roamingPartnerId" IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "Cdrs_ocpiCdrId_fromTenantPartnerId_roamingPartnerId_key"
        ON "Cdrs" ("ocpiCdrId", "fromTenantPartnerId", "roamingPartnerId")
        WHERE "fromTenantPartnerId" IS NOT NULL AND "roamingPartnerId" IS NOT NULL;

      -- Sent uniqueness (to partner)
      CREATE UNIQUE INDEX IF NOT EXISTS "Cdrs_ocpiCdrId_toTenantPartnerId_key"
        ON "Cdrs" ("ocpiCdrId", "toTenantPartnerId")
        WHERE "toTenantPartnerId" IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "Cdrs_transactionId_toTenantPartnerId_key"
        ON "Cdrs" ("transactionId", "toTenantPartnerId")
        WHERE "transactionId" IS NOT NULL AND "toTenantPartnerId" IS NOT NULL;

      CREATE INDEX IF NOT EXISTS "idx_cdrs_from_tenant_partner_id"
        ON "Cdrs" ("fromTenantPartnerId");
      CREATE INDEX IF NOT EXISTS "idx_cdrs_to_tenant_partner_id"
        ON "Cdrs" ("toTenantPartnerId");
    CREATE OR REPLACE VIEW "OCPISessionsWithCdr" AS
    SELECT
      COALESCE(s."tenantId", c."tenantId") AS "tenantId",
      s."id" AS "sessionId",
      COALESCE(s."tenantPartnerId", c."fromTenantPartnerId") AS "tenantPartnerId",
      COALESCE(s."roamingPartnerId", c."roamingPartnerId") AS "roamingPartnerId",
      s."ocpiSessionId",
      COALESCE(s."countryCode", c."countryCode") AS "countryCode",
      COALESCE(s."partyId", c."partyId") AS "partyId",
      s."startDateTime",
      s."endDateTime",
      s."lastUpdated" AS "sessionLastUpdated",
      s."status",
      c."id" AS "cdrId",
      c."ocpiCdrId",
      c."credit",
      c."creditReferenceId",
      c."lastUpdated" AS "cdrLastUpdated",
      s."cdrToken"
    FROM "Sessions" s
    FULL OUTER JOIN "Cdrs" c
      ON c."sessionId" = s."ocpiSessionId"
     AND c."countryCode" = s."countryCode"
     AND c."partyId" = s."partyId"
     AND c."fromTenantPartnerId" = s."tenantPartnerId"
     AND c."roamingPartnerId" IS NOT DISTINCT FROM s."roamingPartnerId"
    WHERE s."id" IS NULL
       OR (s."status" = 'COMPLETED' AND s."endDateTime" IS NOT NULL);
  `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`

      -- Views depend on Cdrs.tenantPartnerId
      DROP VIEW IF EXISTS "OCPISessionsWithCdr";

      DROP INDEX IF EXISTS "idx_cdrs_to_tenant_partner_id";
      DROP INDEX IF EXISTS "idx_cdrs_from_tenant_partner_id";
      DROP INDEX IF EXISTS "Cdrs_transactionId_toTenantPartnerId_key";
      DROP INDEX IF EXISTS "Cdrs_ocpiCdrId_toTenantPartnerId_key";
      DROP INDEX IF EXISTS "Cdrs_ocpiCdrId_fromTenantPartnerId_roamingPartnerId_key";
      DROP INDEX IF EXISTS "Cdrs_ocpiCdrId_fromTenantPartnerId_key";

      ALTER TABLE "Cdrs"
        DROP CONSTRAINT IF EXISTS "Cdrs_from_or_to_partner_check";

      ALTER TABLE "Cdrs"
        ADD COLUMN IF NOT EXISTS "tenantPartnerId" INTEGER
          REFERENCES "TenantPartners"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

      -- Restore received rows only; sent rows cannot be mapped back cleanly
      UPDATE "Cdrs"
      SET "tenantPartnerId" = "fromTenantPartnerId"
      WHERE "fromTenantPartnerId" IS NOT NULL;

      DELETE FROM "Cdrs" WHERE "tenantPartnerId" IS NULL;

      ALTER TABLE "Cdrs"
        ALTER COLUMN "tenantPartnerId" SET NOT NULL;

      ALTER TABLE "Cdrs"
        DROP COLUMN IF EXISTS "successfullySentAt",
        DROP COLUMN IF EXISTS "transactionId",
        DROP COLUMN IF EXISTS "toTenantPartnerId",
        DROP COLUMN IF EXISTS "fromTenantPartnerId";

      CREATE UNIQUE INDEX IF NOT EXISTS "Cdrs_ocpiCdrId_tenantPartnerId_key"
        ON "Cdrs" ("ocpiCdrId", "tenantPartnerId")
        WHERE "roamingPartnerId" IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "Cdrs_ocpiCdrId_tenantPartnerId_roamingPartnerId_key"
        ON "Cdrs" ("ocpiCdrId", "tenantPartnerId", "roamingPartnerId")
        WHERE "roamingPartnerId" IS NOT NULL;

      CREATE INDEX IF NOT EXISTS "idx_cdrs_tenant_partner_id"
        ON "Cdrs" ("tenantPartnerId");
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
        c."lastUpdated"     AS "cdrLastUpdated",
        s."cdrToken"
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
};
