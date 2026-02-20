import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CliResult {
  stdout: string;
  stderr: string;
}

@Injectable()
export class IotaCliService {
  private readonly cliBin: string;
  private readonly packageId: string;
  private readonly registryId: string;
  private readonly gasBudget: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.cliBin = this.config.get<string>('IOTA_CLI_BIN', 'iota');
    this.packageId = this.config.get<string>('IOTA_PACKAGE_ID', '');
    this.registryId = this.config.get<string>('IOTA_REGISTRY_ID', '');
    this.gasBudget = this.config.get<string>('IOTA_GAS_BUDGET', '100000000');
  }

  getConfigSnapshot() {
    return {
      cliBin: this.cliBin,
      packageId: this.packageId,
      registryId: this.registryId,
      gasBudget: this.gasBudget,
    };
  }

  async publishMovePackage(packagePath: string): Promise<unknown> {
    return this.runJson(['client', 'publish', packagePath, '--json']);
  }

  async callMove(functionName: string, args: Array<string | number>): Promise<unknown> {
    if (!this.packageId) {
      throw new InternalServerErrorException('IOTA_PACKAGE_ID non impostato.');
    }

    const cliArgs = [
      'client',
      'call',
      '--package',
      this.packageId,
      '--module',
      'vehicle_passport',
      '--function',
      functionName,
      '--args',
      ...args.map((arg) => String(arg)),
      '--gas-budget',
      this.gasBudget,
      '--json',
    ];

    return this.runJson(cliArgs);
  }

  async getObject(objectId: string): Promise<unknown> {
    return this.runJson(['client', 'object', objectId, '--json']);
  }

  async registerWorkshop(input: {
    workshopAddress: string;
    did: string;
    publicKeyMultibase: string;
  }): Promise<unknown> {
    if (!this.registryId) {
      throw new InternalServerErrorException('IOTA_REGISTRY_ID non impostato.');
    }

    return this.callMove('register_workshop', [
      this.registryId,
      input.workshopAddress,
      input.did,
      input.publicKeyMultibase,
    ]);
  }

  async mintPassport(input: {
    vin: string;
    make: string;
    model: string;
    year: number;
    ownerAddress: string;
  }): Promise<unknown> {
    if (!this.registryId) {
      throw new InternalServerErrorException('IOTA_REGISTRY_ID non impostato.');
    }

    return this.callMove('mint_vehicle_passport', [
      this.registryId,
      input.vin,
      input.make,
      input.model,
      input.year,
      input.ownerAddress,
    ]);
  }

  async addIntervention(input: {
    passportId: string;
    odometerKm: number;
    workType: string;
    notesHash: string;
    evidenceUri: string;
    workshopSignature: string;
    recordedAtMs: number;
  }): Promise<unknown> {
    if (!this.registryId) {
      throw new InternalServerErrorException('IOTA_REGISTRY_ID non impostato.');
    }

    return this.callMove('record_intervention', [
      this.registryId,
      input.passportId,
      input.odometerKm,
      input.workType,
      input.notesHash,
      input.evidenceUri,
      input.workshopSignature,
      input.recordedAtMs,
    ]);
  }

  private async runJson(args: string[]): Promise<unknown> {
    const result = await this.runRaw(args);

    try {
      return JSON.parse(result.stdout);
    } catch {
      return {
        raw: result.stdout,
        stderr: result.stderr,
      };
    }
  }

  private async runRaw(args: string[]): Promise<CliResult> {
    try {
      const { stdout, stderr } = await execFileAsync(this.cliBin, args);
      return { stdout, stderr };
    } catch (error) {
      if (error && typeof error === 'object') {
        const err = error as { message?: string; stderr?: string; stdout?: string };
        throw new InternalServerErrorException({
          message: 'Comando IOTA fallito',
          detail: err.message ?? 'Errore sconosciuto',
          stderr: err.stderr ?? '',
          stdout: err.stdout ?? '',
        });
      }

      throw new InternalServerErrorException('Comando IOTA fallito: errore sconosciuto');
    }
  }
}
