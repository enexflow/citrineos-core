// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
        CREATE OR REPLACE VIEW "OCPIBillingCpo" AS
        SELECT
        c."id",
        c."tenantId",
        c."startDateTime" AS "session_start",
        c."endDateTime" AS "session_end",
        c."totalEnergy" AS "energy_charged_kwh",
        (c."totalCost"->>'excl_vat')::numeric AS "total_cost_eur_excl_vat",
        c."cdrToken"->>'uid' AS "badge_id",
        c."cdrLocation"->>'name' AS "location",
        c."toTenantPartnerId" AS "billed_to_tenant_partner_id",
        c."roamingPartnerId" AS "billed_to_roaming_partner_id"
        FROM "Cdrs" c
        WHERE c."toTenantPartnerId" IS NOT NULL
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      DROP VIEW IF EXISTS "OCPIBillingCpo"
    `);
  },
};
