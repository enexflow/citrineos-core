// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Extends OCPIBillingCpo for the monthly eMSP invoice (TECH-2283):
 *  - ocpi_cdr_id, successfully_sent_at
 *  - station_id + transaction_id: OCPP transaction ids are only unique per station
 *  - country code, party id and name of the billed TenantPartner and RoamingPartner
 *
 * Columns are appended: CREATE OR REPLACE VIEW cannot rename or reorder existing ones.
 * Needs TenantPartners.name (20261015144813-add-hdv-info).
 */
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
        c."roamingPartnerId" AS "billed_to_roaming_partner_id",
        c."ocpiCdrId" AS "ocpi_cdr_id",
        c."successfullySentAt" AS "successfully_sent_at",
        t."stationId" AS "station_id",
        t."transactionId" AS "transaction_id",
        tp."countryCode" AS "tenant_partner_country_code",
        tp."partyId" AS "tenant_partner_party_id",
        tp."name" AS "tenant_partner_name",
        rp."countryCode" AS "roaming_partner_country_code",
        rp."partyId" AS "roaming_partner_party_id",
        rp."name" AS "roaming_partner_name"
      FROM "Cdrs" c
      LEFT JOIN "TenantPartners" tp ON tp."id" = c."toTenantPartnerId"
      LEFT JOIN "RoamingPartners" rp ON rp."id" = c."roamingPartnerId"
      LEFT JOIN "Transactions" t ON t."id" = c."transactionId"
      WHERE c."toTenantPartnerId" IS NOT NULL
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    // CREATE OR REPLACE cannot drop columns: recreate the 20260810104119 definition.
    await queryInterface.sequelize.query(`
      DROP VIEW IF EXISTS "OCPIBillingCpo";
      CREATE VIEW "OCPIBillingCpo" AS
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
};
