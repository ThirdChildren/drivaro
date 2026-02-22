import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { IotaCliService } from '../iota/iota.service';
import { AddInterventionDto } from './dto/add-intervention.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { RegisterWorkshopDto } from './dto/register-workshop.dto';
import { InterventionRecord, VehicleRecord, WorkshopRecord } from './records.types';

interface EventItem {
  id?: {
    txDigest?: string;
  };
  parsedJson?: unknown;
  timestampMs?: string | null;
}

interface EventPage {
  data?: EventItem[];
  hasNextPage?: boolean;
  nextCursor?: unknown;
}

interface TxBlock {
  objectChanges?: Array<{
    type?: string;
    objectType?: string;
    objectId?: string;
  }>;
}

interface PassportEntry {
  passportId: string;
  mintedAt: string;
}

interface CachedPassports {
  expiresAt: number;
  value: VehicleRecord[];
}

const CACHE_TTL_MS = 15000;
const MAX_EVENT_SCAN = 300;

@Injectable()
export class RecordsService {
  private cachedPassports: CachedPassports | null = null;

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
      throw new NotFoundException('Move package not found. Pass packagePath explicitly to /contracts/publish.');
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

    return {
      workshopAddress: normalizedAddress,
      did,
      publicKeyMultibase: dto.publicKeyMultibase,
      createdAt: new Date().toISOString(),
      tx,
    };
  }

  async createVehicle(dto: CreateVehicleDto) {
    const tx = await this.iota.mintPassport(dto);
    const passportId = this.extractObjectId(tx) ?? `pending-${dto.vin}`;

    return {
      ...dto,
      passportId,
      mintedAt: new Date().toISOString(),
      interventions: [],
      tx,
    };
  }

  async addIntervention(passportId: string, dto: AddInterventionDto) {
    const normalizedWorkshopAddress = dto.workshopAddress.toLowerCase();

    const tx = await this.iota.addIntervention({
      workshopAddress: normalizedWorkshopAddress,
      passportId,
      odometerKm: dto.odometerKm,
      workType: dto.workType,
      notesHash: dto.notesHash,
      evidenceUri: dto.evidenceUri,
      workshopSignature: dto.workshopSignature,
      recordedAtMs: dto.recordedAtMs,
    });

    return {
      seq: 0,
      odometerKm: dto.odometerKm,
      workType: dto.workType,
      notesHash: dto.notesHash,
      evidenceUri: dto.evidenceUri,
      workshopAddress: normalizedWorkshopAddress,
      workshopSignature: dto.workshopSignature,
      recordedAtMs: dto.recordedAtMs,
      tx,
    };
  }

  async getVehicleByVin(vin: string) {
    const normalizedVin = vin.trim().toUpperCase();
    const vehicles = await this.loadOnChainPassports();
    const vehicle = vehicles.find((item) => item.vin.toUpperCase() === normalizedVin);

    if (!vehicle) {
      throw new NotFoundException('VIN not found.');
    }

    return {
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      ownerAddress: vehicle.ownerAddress,
      passportId: vehicle.passportId,
      interventions: vehicle.interventions,
      verified: this.verifyInterventions(vehicle.interventions),
    };
  }

  async listVehicles() {
    const vehicles = await this.loadOnChainPassports();

    return vehicles.map((vehicle) => ({
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      passportId: vehicle.passportId,
      interventions: vehicle.interventions.length,
    }));
  }

  async listWorkshops() {
    const registryId = this.iota.getRegistryId();
    if (!registryId) {
      return [];
    }

    const registryObject = await this.iota.getObject(registryId);
    const registryFields = this.extractMoveFields(registryObject);
    const workshopsRaw = Array.isArray(registryFields.workshops) ? registryFields.workshops : [];
    const createdByAddress = await this.getWorkshopTimestampsByAddress();

    const workshops: WorkshopRecord[] = workshopsRaw
      .map((entry) => {
        const fields = this.extractNestedFields(entry);
        const workshopAddress = this.toStringValue(fields.workshop).toLowerCase();
        if (!workshopAddress) {
          return null;
        }

        return {
          workshopAddress,
          did: this.toStringValue(fields.did),
          publicKeyMultibase: this.toStringValue(fields.public_key_multibase),
          createdAt: createdByAddress.get(workshopAddress) ?? new Date().toISOString(),
        };
      })
      .filter((item): item is WorkshopRecord => item !== null);

    return workshops;
  }

  async decodeVin(vin: string) {
    const normalizedVin = vin.trim().toUpperCase();
    if (normalizedVin.length < 11) {
      throw new BadRequestException('VIN is too short for automatic decode.');
    }

    const endpoint = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(normalizedVin)}?format=json`;
    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch {
      throw new BadRequestException('VIN lookup service is unreachable.');
    }

    if (!response.ok) {
      throw new BadRequestException('VIN lookup is currently unavailable.');
    }

    const payload = (await response.json()) as {
      Results?: Array<{ Make?: string; Model?: string; ModelYear?: string; ErrorCode?: string }>;
    };
    const first = payload.Results?.[0];

    const make = first?.Make?.trim() ?? '';
    const model = first?.Model?.trim() ?? '';
    const modelYear = Number(first?.ModelYear ?? 0) || undefined;

    return {
      vin: normalizedVin,
      found: Boolean(make || model),
      make,
      model,
      year: modelYear,
    };
  }

  async hashFromUri(uri: string) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) {
      throw new BadRequestException('Missing evidence URI.');
    }

    const resolvedUri = this.normalizeDocumentUri(normalizedUri);
    let response: Response;
    try {
      response = await fetch(resolvedUri, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'iota-auto-passport/1.0',
        },
      });
    } catch {
      throw new BadRequestException('Document is unreachable from the provided URI.');
    }

    if (!response.ok) {
      throw new BadRequestException(`Unable to download document (status ${response.status}).`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex');

    return {
      uri: normalizedUri,
      resolvedUri,
      notesHash: `0x${hash}`,
      sizeBytes: buffer.length,
    };
  }

  getConfig() {
    return this.iota.getConfigSnapshot();
  }

  private async loadOnChainPassports(): Promise<VehicleRecord[]> {
    if (this.cachedPassports && this.cachedPassports.expiresAt > Date.now()) {
      return this.cachedPassports.value;
    }

    const entries = await this.getPassportEntries();

    const passports = (
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const object = await this.iota.getObject(entry.passportId);
            const fields = this.extractMoveFields(object);
            const interventionsRaw = Array.isArray(fields.interventions) ? fields.interventions : [];

            const interventions: InterventionRecord[] = interventionsRaw.map((item) => {
              const itemFields = this.extractNestedFields(item);
              return {
                seq: this.toNumberValue(itemFields.seq),
                odometerKm: this.toNumberValue(itemFields.odometer_km),
                workType: this.toStringValue(itemFields.work_type),
                notesHash: this.toStringValue(itemFields.notes_hash),
                evidenceUri: this.toStringValue(itemFields.evidence_uri),
                workshopAddress: this.toStringValue(itemFields.workshop).toLowerCase(),
                workshopSignature: this.toStringValue(itemFields.workshop_signature),
                recordedAtMs: this.toNumberValue(itemFields.recorded_at_ms),
              };
            });

            const vin = this.toStringValue(fields.vin).toUpperCase();
            if (!vin) {
              return null;
            }

            const vehicle: VehicleRecord = {
              vin,
              make: this.toStringValue(fields.make),
              model: this.toStringValue(fields.model),
              year: this.toNumberValue(fields.year),
              ownerAddress: this.toStringValue(fields.owner).toLowerCase(),
              passportId: entry.passportId,
              mintedAt: entry.mintedAt,
              interventions,
            };

            return vehicle;
          } catch {
            return null;
          }
        }),
      )
    ).filter((item): item is VehicleRecord => item !== null);

    this.cachedPassports = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: passports,
    };

    return passports;
  }

  private async getPassportEntries(): Promise<PassportEntry[]> {
    const packageId = this.iota.getPackageId();
    if (!packageId) {
      return [];
    }

    const events = await this.queryAllEvents({
      MoveEventType: `${packageId}::vehicle_passport::PassportMinted`,
    });

    const txDigests = [...new Set(events.map((item) => item.id?.txDigest).filter((item): item is string => Boolean(item)))];

    const createdByObjectId = new Map<string, string>();

    await Promise.all(
      txDigests.map(async (digest) => {
        try {
          const tx = (await this.iota.getTransactionBlock(digest)) as TxBlock;
          const objectChanges = Array.isArray(tx.objectChanges) ? tx.objectChanges : [];
          const created = objectChanges.filter(
            (change) =>
              change.type === 'created' &&
              typeof change.objectType === 'string' &&
              change.objectType.includes('::vehicle_passport::VehiclePassport') &&
              typeof change.objectId === 'string',
          );

          const event = events.find((item) => item.id?.txDigest === digest);
          const mintedAt = this.timestampToIso(event?.timestampMs) ?? new Date().toISOString();

          for (const change of created) {
            createdByObjectId.set(change.objectId!, mintedAt);
          }
        } catch {
          // ignore failed tx fetch
        }
      }),
    );

    return [...createdByObjectId.entries()]
      .map(([passportId, mintedAt]) => ({ passportId, mintedAt }))
      .sort((a, b) => b.mintedAt.localeCompare(a.mintedAt));
  }

  private async getWorkshopTimestampsByAddress(): Promise<Map<string, string>> {
    const packageId = this.iota.getPackageId();
    if (!packageId) {
      return new Map();
    }

    const events = await this.queryAllEvents({
      MoveEventType: `${packageId}::vehicle_passport::WorkshopRegistered`,
    });

    const map = new Map<string, string>();
    for (const event of events) {
      const parsed = this.extractNestedFields(event.parsedJson);
      const workshopAddress = this.toStringValue(parsed.workshop).toLowerCase();
      if (!workshopAddress) {
        continue;
      }

      const createdAt = this.timestampToIso(event.timestampMs) ?? new Date().toISOString();
      if (!map.has(workshopAddress)) {
        map.set(workshopAddress, createdAt);
      }
    }

    return map;
  }

  private async queryAllEvents(query: unknown): Promise<EventItem[]> {
    const output: EventItem[] = [];
    let cursor: unknown = undefined;

    while (output.length < MAX_EVENT_SCAN) {
      const response = (await this.iota.queryEvents({
        query,
        cursor,
        limit: 50,
        order: 'descending',
      })) as EventPage;

      const data = Array.isArray(response.data) ? response.data : [];
      if (data.length === 0) {
        break;
      }

      output.push(...data);
      if (!response.hasNextPage || !response.nextCursor) {
        break;
      }

      const nextCursor = response.nextCursor;
      if (JSON.stringify(nextCursor) === JSON.stringify(cursor)) {
        break;
      }

      cursor = nextCursor;
    }

    return output.slice(0, MAX_EVENT_SCAN);
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

  private extractMoveFields(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      return {};
    }

    const data = (input as { data?: unknown }).data;
    if (!data || typeof data !== 'object') {
      return {};
    }

    const content = (data as { content?: unknown }).content;
    if (!content || typeof content !== 'object') {
      return {};
    }

    const fields = (content as { fields?: unknown }).fields;
    if (!fields || typeof fields !== 'object') {
      return {};
    }

    return fields as Record<string, unknown>;
  }

  private extractNestedFields(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      return {};
    }

    const fields = (input as { fields?: unknown }).fields;
    if (fields && typeof fields === 'object') {
      return fields as Record<string, unknown>;
    }

    return input as Record<string, unknown>;
  }

  private toStringValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value);
    }

    return '';
  }

  private toNumberValue(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private timestampToIso(timestampMs: string | null | undefined): string | null {
    if (!timestampMs) {
      return null;
    }

    const parsed = Number(timestampMs);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return new Date(parsed).toISOString();
  }

  private normalizeDocumentUri(uri: string): string {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new BadRequestException('Invalid evidence URI.');
    }

    const isGoogleDrive = parsed.hostname.includes('drive.google.com');
    if (!isGoogleDrive) {
      return uri;
    }

    const fromQuery = parsed.searchParams.get('id');
    const fromPath = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1];
    const fileId = fromQuery || fromPath;

    if (!fileId) {
      return uri;
    }

    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
}
