// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type {
  BootstrapConfig,
  ChargingLimitSourceEnumType,
  ChargingProfilePurposeEnumType,
} from '@citrineos/base';
import { ChargingLimitSourceEnum, CrudRepository, OCPP2_0_1 } from '@citrineos/base';
import { SequelizeRepository } from './Base.js';
import type { IChargingProfileRepository } from '../../../interfaces/index.js';
import type {
  ChargingProfileInput,
  CompositeScheduleInput,
} from '../mapper/2.0.1/ChargingProfileMapper.js';
import {
  ChargingNeeds,
  ChargingProfile,
  ChargingSchedule,
  CompositeSchedule,
  Evse,
  EvseType,
  SalesTariff,
  Transaction,
} from '../model/index.js';
import { Sequelize } from 'sequelize-typescript';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';

export class SequelizeChargingProfileRepository
  extends SequelizeRepository<ChargingProfile>
  implements IChargingProfileRepository
{
  chargingNeeds: CrudRepository<ChargingNeeds>;
  chargingSchedule: CrudRepository<ChargingSchedule>;
  salesTariff: CrudRepository<SalesTariff>;
  transaction: CrudRepository<Transaction>;
  evse: CrudRepository<EvseType>;
  compositeSchedule: CrudRepository<CompositeSchedule>;

  private readonly _upsertQueues = new Map<string, Promise<ChargingProfile>>();

  constructor(
    config: BootstrapConfig,
    logger?: Logger<ILogObj>,
    sequelizeInstance?: Sequelize,
    chargingNeeds?: CrudRepository<ChargingNeeds>,
    chargingSchedule?: CrudRepository<ChargingSchedule>,
    salesTariff?: CrudRepository<SalesTariff>,
    transaction?: CrudRepository<Transaction>,
    evse?: CrudRepository<EvseType>,
    compositeSchedule?: CrudRepository<CompositeSchedule>,
  ) {
    super(config, ChargingProfile.MODEL_NAME, logger, sequelizeInstance);
    this.chargingNeeds = chargingNeeds
      ? chargingNeeds
      : new SequelizeRepository<ChargingNeeds>(
          config,
          ChargingNeeds.MODEL_NAME,
          logger,
          sequelizeInstance,
        );
    this.chargingSchedule = chargingSchedule
      ? chargingSchedule
      : new SequelizeRepository<ChargingSchedule>(
          config,
          ChargingSchedule.MODEL_NAME,
          logger,
          sequelizeInstance,
        );
    this.evse = evse
      ? evse
      : new SequelizeRepository<EvseType>(config, EvseType.MODEL_NAME, logger, sequelizeInstance);
    this.salesTariff = salesTariff
      ? salesTariff
      : new SequelizeRepository<SalesTariff>(
          config,
          SalesTariff.MODEL_NAME,
          logger,
          sequelizeInstance,
        );
    this.transaction = transaction
      ? transaction
      : new SequelizeRepository<Transaction>(
          config,
          Transaction.MODEL_NAME,
          logger,
          sequelizeInstance,
        );
    this.compositeSchedule = compositeSchedule
      ? compositeSchedule
      : new SequelizeRepository<CompositeSchedule>(
          config,
          CompositeSchedule.MODEL_NAME,
          logger,
          sequelizeInstance,
        );
  }

  async createOrUpdateChargingProfile(
    tenantId: number,
    chargingProfile: ChargingProfileInput,
    stationId: string,
    evseId?: number | null,
    chargingLimitSource?: ChargingLimitSourceEnumType,
    isActive?: boolean,
  ): Promise<ChargingProfile> {
    // Queue same-profile upserts in-process so that waiters do not each hold a pooled connection.
    const key = `${tenantId}:${stationId}:${chargingProfile.id}`;
    const upsert = () =>
      this._createOrUpdateChargingProfile(
        tenantId,
        chargingProfile,
        stationId,
        evseId,
        chargingLimitSource,
        isActive,
      );
    const current = (this._upsertQueues.get(key) ?? Promise.resolve()).then(upsert, upsert);
    this._upsertQueues.set(key, current);
    try {
      return await current;
    } finally {
      if (this._upsertQueues.get(key) === current) {
        this._upsertQueues.delete(key);
      }
    }
  }

  private async _createOrUpdateChargingProfile(
    tenantId: number,
    chargingProfile: ChargingProfileInput,
    stationId: string,
    evseId?: number | null,
    chargingLimitSource?: ChargingLimitSourceEnumType,
    isActive?: boolean,
  ): Promise<ChargingProfile> {
    // One transaction with the profile row locked: stations such as Kempower send several
    // ReportChargingProfiles in parallel for the same profile, and interleaved schedule
    // replacements used to fail with "Deleted 0 entries, expected 1" (TECH-2550).
    return await this.s.transaction(async (transaction) => {
      // Fail fast rather than pin a connection behind a stuck holder on another instance.
      await this.s.query(`SET LOCAL lock_timeout = '5s'`, { transaction });

      let transactionDBId;
      if (chargingProfile.transactionId) {
        const activeTransaction = await Transaction.findOne({
          where: {
            stationId,
            transactionId: chargingProfile.transactionId,
          },
          transaction,
        });
        transactionDBId = activeTransaction?.id;
      }

      const { chargingSchedule: chargingSchedules, ...profileFields } = chargingProfile;
      const values = {
        ...profileFields,
        stationId: stationId,
        evseId: evseId,
        transactionDatabaseId: transactionDBId,
        chargingLimitSource: chargingLimitSource ?? ChargingLimitSourceEnum.CSO,
        isActive: isActive === undefined ? false : isActive,
      };

      const [savedChargingProfile, profileCreated] = await ChargingProfile.findOrCreate({
        where: {
          tenantId: tenantId,
          stationId: stationId,
          id: chargingProfile.id,
        },
        defaults: values,
        transaction,
      });
      if (!profileCreated) {
        await savedChargingProfile.reload({ lock: transaction.LOCK.UPDATE, transaction });
        await savedChargingProfile.update(values, { transaction });

        const staleSchedules = await ChargingSchedule.findAll({
          where: { chargingProfileDatabaseId: savedChargingProfile.databaseId },
          attributes: ['databaseId'],
          transaction,
        });
        await SalesTariff.destroy({
          where: { chargingScheduleDatabaseId: staleSchedules.map((s) => s.databaseId) },
          transaction,
        });
        await ChargingSchedule.destroy({
          where: { chargingProfileDatabaseId: savedChargingProfile.databaseId },
          transaction,
        });
      }

      for (const chargingSchedule of chargingSchedules) {
        const savedChargingSchedule = await ChargingSchedule.create(
          {
            tenantId,
            stationId,
            chargingProfileDatabaseId: savedChargingProfile.databaseId,
            ...chargingSchedule,
          },
          { transaction },
        );
        if (chargingSchedule.salesTariff) {
          await SalesTariff.create(
            {
              tenantId,
              chargingScheduleDatabaseId: savedChargingSchedule.databaseId,
              ...chargingSchedule.salesTariff,
            },
            { transaction },
          );
        }
      }

      return savedChargingProfile;
    });
  }

  async createChargingNeeds(
    tenantId: number,
    chargingNeedsReq: OCPP2_0_1.NotifyEVChargingNeedsRequest,
    stationId: string,
  ): Promise<ChargingNeeds> {
    const activeTransaction = await Transaction.findOne({
      where: {
        stationId,
        isActive: true,
      },
      include: [{ model: Evse, where: { evseTypeId: chargingNeedsReq.evseId }, required: true }],
    });
    if (!activeTransaction) {
      throw new Error(
        `No active transaction found on station ${stationId} evse ${chargingNeedsReq.evseId}`,
      );
    }

    return await this.chargingNeeds.create(
      tenantId,
      ChargingNeeds.build({
        tenantId,
        ...chargingNeedsReq.chargingNeeds,
        evseId: activeTransaction.evseId,
        transactionDatabaseId: activeTransaction.id,
        maxScheduleTuples: chargingNeedsReq.maxScheduleTuples,
      }),
    );
  }

  async findChargingNeedsByEvseDBIdAndTransactionDBId(
    tenantId: number,
    evseDBId: number,
    transactionDataBaseId: number | null,
  ): Promise<ChargingNeeds | undefined> {
    const chargingNeedsArray = await this.chargingNeeds.readAllByQuery(tenantId, {
      where: {
        evseId: evseDBId,
        transactionDatabaseId: transactionDataBaseId,
      },
      order: [['createdAt', 'DESC']],
    });

    return chargingNeedsArray.length > 0 ? chargingNeedsArray[0] : undefined;
  }

  async createCompositeSchedule(
    tenantId: number,
    compositeSchedule: CompositeScheduleInput,
    stationId: string,
  ): Promise<CompositeSchedule> {
    return await this.compositeSchedule.create(
      tenantId,
      CompositeSchedule.build({
        tenantId,
        ...compositeSchedule,
        stationId,
      }),
    );
  }

  async getNextChargingScheduleId(tenantId: number, stationId: string): Promise<number> {
    return await this.chargingSchedule.readNextValue(tenantId, 'id', { where: { stationId } });
  }

  async getNextChargingProfileId(tenantId: number, stationId: string): Promise<number> {
    return await this.readNextValue(tenantId, 'id', { where: { stationId } });
  }

  async getNextStackLevel(
    tenantId: number,
    stationId: string,
    transactionDatabaseId: number | null,
    profilePurpose: ChargingProfilePurposeEnumType,
  ): Promise<number> {
    return await this.readNextValue(
      tenantId,
      'stackLevel',
      {
        where: {
          stationId,
          transactionDatabaseId: transactionDatabaseId,
          chargingProfilePurpose: profilePurpose,
        },
      },
      0,
    );
  }
}
