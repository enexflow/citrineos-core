// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

// 20250821103100-schema-fix created Tariffs.tariffAltText as varchar(255) while
// the model declares JSONB, so any partner tariff whose serialized
// tariff_alt_text exceeds 255 chars was rejected on insert.
export default {
  up: async (queryInterface: QueryInterface) => {
    // Existing values are JSON.stringify output; anything that is not valid
    // JSON is kept as a JSON string rather than failing the migration.
    await queryInterface.sequelize.query(`
      ALTER TABLE "Tariffs"
      ALTER COLUMN "tariffAltText" TYPE JSONB
      USING CASE
        WHEN "tariffAltText" IS NULL THEN NULL
        WHEN "tariffAltText" IS JSON THEN "tariffAltText"::jsonb
        ELSE to_jsonb("tariffAltText")
      END;
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    // Fails if a row's serialized tariffAltText now exceeds 255 chars.
    await queryInterface.sequelize.query(`
      ALTER TABLE "Tariffs"
      ALTER COLUMN "tariffAltText" TYPE VARCHAR(255)
      USING "tariffAltText"::text;
    `);
  },
};
