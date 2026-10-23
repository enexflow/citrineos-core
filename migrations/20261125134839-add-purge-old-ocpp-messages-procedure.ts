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
        last_id integer := 0;
        deleted integer;
        total bigint := 0;
      BEGIN
        -- A typo such as '1 m' parses as one minute and would empty the table.
        IF retention IS NULL OR retention < interval '7 days' THEN
          RAISE EXCEPTION 'retention % is below the 7-day floor', retention;
        END IF;

        -- Cut by id: "createdAt" has no index, and ids grow with it.
        SELECT id INTO cutoff_id FROM public."${TABLE_NAME}"
         WHERE "createdAt" >= now() - retention
         ORDER BY id LIMIT 1;
        IF cutoff_id IS NULL THEN
          RAISE NOTICE 'no OCPP message newer than %, nothing purged', retention;
          RETURN;
        END IF;

        LOOP
          -- Resume after last_id: rescanning from the lowest id walks every row already deleted.
          WITH purged AS (
            DELETE FROM public."${TABLE_NAME}" WHERE id IN (
              SELECT id FROM public."${TABLE_NAME}"
               WHERE id > last_id AND id < cutoff_id ORDER BY id LIMIT 10000)
            RETURNING id)
          SELECT count(*), coalesce(max(id), last_id) INTO deleted, last_id FROM purged;
          EXIT WHEN deleted = 0;
          total := total + deleted;
          -- Per-batch commit: a backlog purge holds no long transaction and resumes if killed.
          COMMIT;
          -- bigint literal: an exact pg_catalog match, so no operator on the search_path can win.
          IF total % 1000000::bigint = 0 THEN
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
