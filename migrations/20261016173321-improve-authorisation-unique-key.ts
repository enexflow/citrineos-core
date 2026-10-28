// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Authorizations"
      DROP CONSTRAINT IF EXISTS "authorizations_idtoken_idtokentype_key";
    `);
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "idToken_type";
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "authorizations_idtoken_type_partner_roaming_key"
      ON "Authorizations" ("idToken", "idTokenType", "tenantPartnerId", "roamingPartnerId")
      NULLS NOT DISTINCT;
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    // Fails if the same (idToken, idTokenType) now exists for several partners.
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "authorizations_idtoken_type_partner_roaming_key";
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "Authorizations"
      ADD CONSTRAINT "authorizations_idtoken_idtokentype_key"
      UNIQUE ("idToken", "idTokenType");
    `);
  },
};
