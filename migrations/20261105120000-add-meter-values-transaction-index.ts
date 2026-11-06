// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

// The 1.6 StopTransaction dedup in storeStopMeterValues looks up MeterValues by
// transactionDatabaseId while holding the transaction row lock; without this
// index it seq-scans the whole table on every stop.
export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_meter_values_transaction_database_id"
      ON "MeterValues" ("transactionDatabaseId");
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "idx_meter_values_transaction_database_id";
    `);
  },
};
