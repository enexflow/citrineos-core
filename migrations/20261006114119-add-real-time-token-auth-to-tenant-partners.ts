// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
      ADD COLUMN IF NOT EXISTS "realTimeTokenAuth" BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    // Gireve was the only partner asked in real time so far.
    await queryInterface.sequelize.query(`
      UPDATE "TenantPartners"
      SET "realTimeTokenAuth" = TRUE
      WHERE "countryCode" = 'FR' AND "partyId" IN ('007', '107');
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
      DROP COLUMN IF EXISTS "realTimeTokenAuth";
    `);
  },
};
