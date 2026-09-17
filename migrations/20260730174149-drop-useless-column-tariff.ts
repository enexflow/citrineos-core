// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Drop legacy Tariffs columns unused by OCPI:
 * - stationId (1:1 station link; association is via ConnectorTariffs)
 * - pricePerKwh / pricePerMin / pricePerSession (denormalized; source of truth is TariffElements)
 */
export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Tariffs"
        DROP CONSTRAINT IF EXISTS "Tariffs_stationId_key";

      ALTER TABLE "Tariffs"
        DROP COLUMN IF EXISTS "stationId",
        DROP COLUMN IF EXISTS "pricePerKwh",
        DROP COLUMN IF EXISTS "pricePerMin",
        DROP COLUMN IF EXISTS "pricePerSession";
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Tariffs"
        ADD COLUMN IF NOT EXISTS "stationId" VARCHAR(255),
        ADD COLUMN IF NOT EXISTS "pricePerKwh" NUMERIC,
        ADD COLUMN IF NOT EXISTS "pricePerMin" NUMERIC,
        ADD COLUMN IF NOT EXISTS "pricePerSession" NUMERIC;

      -- restore NOT NULL only if every row has a value; otherwise leave nullable
      UPDATE "Tariffs" SET "pricePerKwh" = 0 WHERE "pricePerKwh" IS NULL;

      ALTER TABLE "Tariffs"
        ALTER COLUMN "pricePerKwh" SET NOT NULL;

      ALTER TABLE "Tariffs"
        ADD CONSTRAINT "Tariffs_stationId_key" UNIQUE ("stationId");
    `);
  },
};
