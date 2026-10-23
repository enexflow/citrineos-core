// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

const TABLE_NAME = 'OCPPMessages';
const PURGE_PROCEDURE = 'purge_old_ocpp_messages';

/**
 * Adds the OCPPMessages retention procedure, called daily by the purge-ocpp-messages CronJob.
 */
export default {
  async up(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE PROCEDURE public.${PURGE_PROCEDURE}(retention interval)
      LANGUAGE plpgsql
      AS $$
      DECLARE
        cutoff_id integer;
        deleted integer;
        total bigint := 0;
      BEGIN
        -- Cut by id: "createdAt" has no index, and ids grow with it.
        SELECT id INTO cutoff_id FROM "${TABLE_NAME}"
         WHERE "createdAt" >= now() - retention
         ORDER BY id LIMIT 1;
        IF cutoff_id IS NULL THEN
          RAISE NOTICE 'no OCPP message newer than %, nothing purged', retention;
          RETURN;
        END IF;

        LOOP
          DELETE FROM "${TABLE_NAME}" WHERE id IN (
            SELECT id FROM "${TABLE_NAME}" WHERE id < cutoff_id ORDER BY id LIMIT 10000);
          GET DIAGNOSTICS deleted = ROW_COUNT;
          EXIT WHEN deleted = 0;
          total := total + deleted;
          -- Per-batch commit: a backlog purge holds no long transaction and resumes if killed.
          COMMIT;
          IF total % 1000000 = 0 THEN
            RAISE NOTICE '% OCPP messages deleted', total;
          END IF;
        END LOOP;

        RAISE NOTICE 'done: % OCPP messages deleted below id %', total, cutoff_id;
      END;
      $$;
    `);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    await queryInterface.sequelize.query(`
      DROP PROCEDURE IF EXISTS public.${PURGE_PROCEDURE}(interval);
    `);
  },
};
