// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * OCPI auth method origin on Authorizations.
 * Values: AUTH_REQUEST | COMMAND | WHITELIST (nullable = legacy / normal token).
 * ocpiAuthReference: The reference of the authorization that was used to authorize the token.
 */
export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Authorizations"
        ADD COLUMN IF NOT EXISTS "ocpiAuthMethod" VARCHAR(50),
        ADD COLUMN IF NOT EXISTS "ocpiAuthReference" VARCHAR(50);
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Authorizations"
        DROP COLUMN IF EXISTS "ocpiAuthReference",
        DROP COLUMN IF EXISTS "ocpiAuthMethod";
    `);
  },
};
