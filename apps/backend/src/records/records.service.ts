import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { IotaCliService } from '../iota/iota.service';
import { AddInterventionDto } from './dto/add-intervention.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { RegisterWorkshopDto } from './dto/register-workshop.dto';
import { InterventionRecord, VehicleRecord, WorkshopRecord } from './records.types';

@Injectable()
export class RecordsService {
  private readonly workshops = new Map<string, WorkshopRecord>();
  private readonly vehiclesByVin = new Map<string, VehicleRecord>();
  private readonly vinByPassport = new Map<string, string>();

  constructor(
    @Inject(IotaCliService) private readonly iota: IotaCliService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async publishContract(packagePath?: string) {
    if (packagePath) {
      return this.iota.publishMovePackage(resolve(process.cwd(), packagePath));
    }

    const candidates = [
      resolve(process.cwd(), 'contracts/vehicle_passport_move'),
      resolve(process.cwd(), '../../contracts/vehicle_passport_move'),
    ];

    const detectedPath = candidates.find((candidate) => existsSync(candidate));
    if (!detectedPath) {
      throw new NotFoundException(
        'Package Move non trovato. Passa packagePath esplicito in /contracts/publish.',
      );
    }

    return this.iota.publishMovePackage(detectedPath);
  }

  async registerWorkshop(dto: RegisterWorkshopDto) {
    const normalizedAddress = dto.workshopAddress.toLowerCase();
    const did = dto.did?.trim() || this.buildWorkshopDid(normalizedAddress);

    const tx = await this.iota.registerWorkshop({
      ...dto,
      workshopAddress: normalizedAddress,
      did,
    });

    const workshop: WorkshopRecord = {
      ...dto,
      workshopAddress: normalizedAddress,
      did,
      createdAt: new Date().toISOString(),
      tx,
    };

    this.workshops.set(normalizedAddress, workshop);
    return workshop;
  }

  async createVehicle(dto: CreateVehicleDto) {
    if (this.vehiclesByVin.has(dto.vin)) {
      throw new BadRequestException('VIN già presente nel registro off-chain.');
    }

    const tx = await this.iota.mintPassport(dto);
    const passportId = this.extractObjectId(tx) ?? `pending-${dto.vin}`;

    const vehicle: VehicleRecord = {
      ...dto,
      passportId,
      mintedAt: new Date().toISOString(),
      interventions: [],
      tx,
    };

    this.vehiclesByVin.set(dto.vin, vehicle);
    this.vinByPassport.set(passportId, dto.vin);
    return vehicle;
  }

  async addIntervention(passportId: string, dto: AddInterventionDto) {
    const vin = this.vinByPassport.get(passportId);
    if (!vin) {
      throw new NotFoundException('Passport non trovato.');
    }

    const vehicle = this.vehiclesByVin.get(vin);
    if (!vehicle) {
      throw new NotFoundException('Veicolo non trovato.');
    }

    const lastKm = vehicle.interventions.at(-1)?.odometerKm ?? 0;
    if (dto.odometerKm < lastKm) {
      throw new BadRequestException('Chilometraggio inferiore all’ultimo valore registrato.');
    }

    if (!this.workshops.has(dto.workshopAddress)) {
      throw new BadRequestException('Officina non registrata localmente.');
    }

    const tx = await this.iota.addIntervention({
      passportId,
      odometerKm: dto.odometerKm,
      workType: dto.workType,
      notesHash: dto.notesHash,
      evidenceUri: dto.evidenceUri,
      workshopSignature: dto.workshopSignature,
      recordedAtMs: dto.recordedAtMs,
    });

    const intervention: InterventionRecord = {
      seq: vehicle.interventions.length + 1,
      odometerKm: dto.odometerKm,
      workType: dto.workType,
      notesHash: dto.notesHash,
      evidenceUri: dto.evidenceUri,
      workshopAddress: dto.workshopAddress,
      workshopSignature: dto.workshopSignature,
      recordedAtMs: dto.recordedAtMs,
      tx,
    };

    vehicle.interventions.push(intervention);
    return intervention;
  }

  getVehicleByVin(vin: string) {
    const vehicle = this.vehiclesByVin.get(vin);
    if (!vehicle) {
      throw new NotFoundException('VIN non trovato.');
    }

    return {
      ...vehicle,
      verified: this.verifyInterventions(vehicle.interventions),
    };
  }

  listVehicles() {
    return [...this.vehiclesByVin.values()].map((vehicle) => ({
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      passportId: vehicle.passportId,
      interventions: vehicle.interventions.length,
    }));
  }

  listWorkshops() {
    return [...this.workshops.values()];
  }

  getConfig() {
    return this.iota.getConfigSnapshot();
  }

  private verifyInterventions(interventions: InterventionRecord[]): boolean {
    let previous = 0;

    for (const intervention of interventions) {
      if (intervention.odometerKm < previous) {
        return false;
      }

      previous = intervention.odometerKm;
    }

    return true;
  }

  private extractObjectId(tx: unknown): string | undefined {
    if (!tx || typeof tx !== 'object') {
      return undefined;
    }

    const obj = tx as {
      objectChanges?: Array<{ objectType?: string; objectId?: string; type?: string }>;
      object_changes?: Array<{ object_type?: string; object_id?: string; type?: string }>;
    };

    const snake = obj.object_changes?.find(
      (item) => item.type === 'created' && item.object_type?.includes('VehiclePassport'),
    );
    if (snake?.object_id) {
      return snake.object_id;
    }

    const camel = obj.objectChanges?.find(
      (item) => item.type === 'created' && item.objectType?.includes('VehiclePassport'),
    );

    return camel?.objectId;
  }

  private buildWorkshopDid(workshopAddress: string): string {
    const network = this.config.get<string>('IOTA_NETWORK', 'testnet').toLowerCase();
    return `did:iota:${network}:${workshopAddress}`;
  }
}
