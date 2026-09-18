// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        ADD COLUMN IF NOT EXISTS "name" VARCHAR(255),
        ADD COLUMN IF NOT EXISTS "signatureDate" DATE,
        ADD COLUMN IF NOT EXISTS "contractStartDate" DATE;
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "RoamingPartners"
        DROP COLUMN IF EXISTS "contractStartDate",
        DROP COLUMN IF EXISTS "signatureDate",
        DROP COLUMN IF EXISTS "name";
    `);
  },
};
