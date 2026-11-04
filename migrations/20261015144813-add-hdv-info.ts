// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Adds HDV (heavy-duty vehicle) info:
 *  - RoamingPartners.isHdv
 *  - TenantPartners.isHdv
 *  - TenantPartners.name
 *
 * Existing rows are backfilled with isHdv = false via the column default.
 */
export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        ADD COLUMN IF NOT EXISTS "isHdv" BOOLEAN NOT NULL DEFAULT false;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
        ADD COLUMN IF NOT EXISTS "isHdv" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "name" VARCHAR(255);
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "TenantPartners"
        DROP COLUMN IF EXISTS "name",
        DROP COLUMN IF EXISTS "isHdv";
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        DROP COLUMN IF EXISTS "isHdv";
    `);
  },
};
