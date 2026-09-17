// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Tariffs"
        DROP CONSTRAINT IF EXISTS "Tariffs_connectorId_fkey";

      ALTER TABLE "Tariffs"
        DROP COLUMN IF EXISTS "connectorId";
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Tariffs"
        ADD COLUMN IF NOT EXISTS "connectorId" INTEGER
          REFERENCES "Connectors"("id") ON UPDATE CASCADE ON DELETE SET NULL;
    `);
  },
};
