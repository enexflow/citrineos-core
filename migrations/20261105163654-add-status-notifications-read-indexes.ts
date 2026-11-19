// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

// Both readers bound on "createdAt" (insertion time), not on the station-reported "timestamp" (TECH-2647).
export default {
  up: async (queryInterface: QueryInterface) => {
    // Per-station history read by the Patterm timeseries_api.
    await queryInterface.sequelize.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_status_notifications_station_id_created_at"
      ON "StatusNotifications" ("stationId", "createdAt");
    `);

    // Cross-station sync.
    await queryInterface.sequelize.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_status_notifications_created_at_id"
      ON "StatusNotifications" ("createdAt", id);
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "idx_status_notifications_station_id_created_at";
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "idx_status_notifications_created_at_id";
    `);
  },
};
