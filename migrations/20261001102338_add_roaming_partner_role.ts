// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Adds RoamingPartners.roles: the OCPI roles a roaming partner plays behind its hub,
 * e.g. ["CPO"], ["EMSP"] or ["CPO","EMSP"]. A single party can hold both roles, so this
 * is a jsonb array (filterable in Hasura with _contains) rather than a scalar.
 *
 * Existing rows are all backfilled as ["EMSP"]; adjust any CPO or dual-role partner by hand.
 */
export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        ADD COLUMN IF NOT EXISTS "roles" JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        DROP CONSTRAINT IF EXISTS "RoamingPartners_roles_check";
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        ADD CONSTRAINT "RoamingPartners_roles_check"
        CHECK (
          jsonb_typeof("roles") = 'array'
          AND "roles" <@ '["CPO","EMSP"]'::jsonb
        );
    `);

    await queryInterface.sequelize.query(`
      UPDATE "RoamingPartners"
      SET "roles" = '["EMSP"]'::jsonb;
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        DROP CONSTRAINT IF EXISTS "RoamingPartners_roles_check";
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        DROP COLUMN IF EXISTS "roles";
    `);
  },
};
