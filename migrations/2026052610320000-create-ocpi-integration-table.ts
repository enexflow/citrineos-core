// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "OcpiIntegrations" (
        "id" SERIAL PRIMARY KEY,
        "partnerProfileOCPI" JSONB,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
      ADD COLUMN IF NOT EXISTS "ocpiIntegrationId" INTEGER
      REFERENCES "OcpiIntegrations"("id")
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
    `);

    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        partner RECORD;
        new_integration_id INTEGER;
      BEGIN
        FOR partner IN
          SELECT "id", "partnerProfileOCPI"
          FROM "TenantPartners"
          WHERE "partnerProfileOCPI" IS NOT NULL
        LOOP
          INSERT INTO "OcpiIntegrations" ("partnerProfileOCPI", "createdAt", "updatedAt")
          VALUES (partner."partnerProfileOCPI", NOW(), NOW())
          RETURNING "id" INTO new_integration_id;

          UPDATE "TenantPartners"
          SET "ocpiIntegrationId" = new_integration_id
          WHERE "id" = partner."id";
        END LOOP;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "idx_tenant_partners_ocpi_integration_id"
      ON "TenantPartners" ("ocpiIntegrationId");
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
      DROP COLUMN IF EXISTS "partnerProfileOCPI";
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
      ADD COLUMN IF NOT EXISTS "partnerProfileOCPI" JSONB;
    `);

    await queryInterface.sequelize.query(`
      UPDATE "TenantPartners" tp
      SET "partnerProfileOCPI" = oi."partnerProfileOCPI"
      FROM "OcpiIntegrations" oi
      WHERE tp."ocpiIntegrationId" = oi."id";
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "idx_tenant_partners_ocpi_integration_id";
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
      DROP COLUMN IF EXISTS "ocpiIntegrationId";
    `);

    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "OcpiIntegrations";
    `);
  },
};
