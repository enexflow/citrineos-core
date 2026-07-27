// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import type { QueryInterface } from 'sequelize';

const TABLE_NAME = 'GireveBroadcastRetryQueues';
const CLAIM_FUNCTION = 'claim_gireve_broadcast_retries';

/**
 * Adds lockedAt + atomic claim function for the Gireve retry CronJob runner.
 */
export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "${TABLE_NAME}"
        ADD COLUMN IF NOT EXISTS "lockedAt" timestamptz;
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION public.${CLAIM_FUNCTION}(batch_limit integer)
      RETURNS SETOF "${TABLE_NAME}"
      LANGUAGE sql
      AS $$
        UPDATE "${TABLE_NAME}" q
        SET
          status = 'processing',
          "lockedAt" = now(),
          "updatedAt" = now()
        FROM (
          SELECT id
          FROM "${TABLE_NAME}"
          WHERE status = 'pending'
            AND "nextRetryAt" <= now()
          ORDER BY "nextRetryAt" ASC
          LIMIT batch_limit
          FOR UPDATE SKIP LOCKED
        ) picked
        WHERE q.id = picked.id
        RETURNING q.*;
      $$;
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS public.${CLAIM_FUNCTION}(integer);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "${TABLE_NAME}"
        DROP COLUMN IF EXISTS "lockedAt";
    `);
  },
};
