import { BadRequestException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getFullnodeUrl, IotaClient, Network } from '@iota/iota-sdk/client';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Transaction } from '@iota/iota-sdk/transactions';

type IotaNetwork = 'mainnet' | 'testnet';

@Injectable()
export class IotaCliService {
  private readonly client: IotaClient;
  private readonly network: IotaNetwork;
  private readonly rpcUrl: string;
  private readonly packageId: string;
  private readonly registryId: string;
  private readonly gasBudget: number;
  private readonly adminPrivateKey: string;
  private readonly workshopKeypairs = new Map<string, Ed25519Keypair>();

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.network = this.resolveNetwork(this.config.get<string>('IOTA_NETWORK', 'testnet'));
    this.rpcUrl = this.config.get<string>('IOTA_RPC_URL') ?? getFullnodeUrl(this.toSdkNetwork(this.network));
    this.client = new IotaClient({ url: this.rpcUrl });
    this.packageId = this.config.get<string>('IOTA_PACKAGE_ID', '');
    this.registryId = this.config.get<string>('IOTA_REGISTRY_ID', '');
    this.gasBudget = Number(this.config.get<string>('IOTA_GAS_BUDGET', '100000000'));
    this.adminPrivateKey =
      this.config.get<string>('IOTA_ADMIN_PRIVATE_KEY', '') ||
      this.config.get<string>('IOTA_PRIVATE_KEY', '');
    this.loadWorkshopSignersFromEnv();
  }

  getConfigSnapshot() {
    return {
      mode: 'sdk',
      network: this.network,
      rpcUrl: this.rpcUrl,
      packageId: this.packageId,
      registryId: this.registryId,
      gasBudget: this.gasBudget,
      adminAddress: this.safeGetAdminAddress(),
      workshopSignerAddresses: [...this.workshopKeypairs.keys()],
    };
  }

  getPackageId(): string {
    return this.packageId;
  }

  getRegistryId(): string {
    return this.registryId;
  }

  async publishMovePackage(packagePath: string): Promise<unknown> {
    throw new BadRequestException(
      `Publish non supportato in runtime serverless. Usa CI/CD o CLI locale. Path ricevuto: ${packagePath}`,
    );
  }

  async getObject(objectId: string): Promise<unknown> {
    return this.client.getObject({
      id: objectId,
      options: {
        showContent: true,
        showType: true,
        showOwner: true,
      },
    });
  }

  async queryEvents(input: {
    query: unknown;
    cursor?: unknown;
    limit?: number;
    order?: 'ascending' | 'descending';
  }): Promise<unknown> {
    return this.client.queryEvents({
      query: input.query as never,
      cursor: input.cursor as never,
      limit: input.limit,
      order: input.order,
    });
  }

  async getTransactionBlock(digest: string): Promise<unknown> {
    return this.client.getTransactionBlock({
      digest,
      options: {
        showObjectChanges: true,
      },
    });
  }

  async registerWorkshop(input: {
    workshopAddress: string;
    did: string;
    publicKeyMultibase: string;
  }): Promise<unknown> {
    if (!this.registryId) {
      throw new InternalServerErrorException('IOTA_REGISTRY_ID non impostato.');
    }

    return this.executeMoveCall('register_workshop', (tx) => [
      tx.object(this.registryId),
      tx.pure.address(input.workshopAddress),
      tx.pure.string(input.did),
      tx.pure.string(input.publicKeyMultibase),
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

    return this.executeMoveCall('mint_vehicle_passport', (tx) => [
      tx.object(this.registryId),
      tx.pure.string(input.vin),
      tx.pure.string(input.make),
      tx.pure.string(input.model),
      tx.pure.u64(input.year),
      tx.pure.address(input.ownerAddress),
    ]);
  }

  async addIntervention(input: {
    workshopAddress: string;
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

    const signer = this.resolveSignerForWorkshop(input.workshopAddress);
    const signerAddress = signer.toIotaAddress().toLowerCase();
    const normalizedWorkshopAddress = input.workshopAddress.toLowerCase();
    if (normalizedWorkshopAddress !== signerAddress) {
      throw new BadRequestException(
        `Il signer configurato (${signerAddress}) non corrisponde a workshopAddress (${normalizedWorkshopAddress}).`,
      );
    }

    return this.executeMoveCall(
      'record_intervention',
      (tx) => [
        tx.object(this.registryId),
        tx.object(input.passportId),
        tx.pure.u64(input.odometerKm),
        tx.pure.string(input.workType),
        tx.pure.string(input.notesHash),
        tx.pure.string(input.evidenceUri),
        tx.pure.string(input.workshopSignature),
        tx.pure.u64(input.recordedAtMs),
      ],
      signer,
    );
  }

  private async executeMoveCall(
    functionName: string,
    buildArgs: (tx: Transaction) => Array<ReturnType<Transaction['pure']> | ReturnType<Transaction['object']>>,
    signer: Ed25519Keypair = this.getAdminSigner(),
  ): Promise<unknown> {
    if (!this.packageId) {
      throw new InternalServerErrorException('IOTA_PACKAGE_ID non impostato.');
    }

    const tx = new Transaction();
    if (Number.isFinite(this.gasBudget) && this.gasBudget > 0) {
      tx.setGasBudget(this.gasBudget);
    }
    tx.moveCall({
      target: `${this.packageId}::vehicle_passport::${functionName}`,
      arguments: buildArgs(tx),
    });

    try {
      const response = await this.client.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
          showInput: true,
        },
      });

      if (response.digest) {
        await this.client.waitForTransaction({
          digest: response.digest,
        });
      }

      return response;
    } catch (error) {
      if (error && typeof error === 'object') {
        const err = error as { message?: string };
        throw new InternalServerErrorException({
          message: 'Transazione IOTA fallita',
          detail: err.message ?? 'Errore sconosciuto',
          functionName,
          signer: signer.toIotaAddress(),
          network: this.network,
        });
      }

      throw new InternalServerErrorException('Transazione IOTA fallita: errore sconosciuto');
    }
  }

  private getAdminSigner(): Ed25519Keypair {
    if (!this.adminPrivateKey) {
      throw new InternalServerErrorException(
        'Signer admin non configurato. Imposta IOTA_ADMIN_PRIVATE_KEY in .env.',
      );
    }

    return this.parseKeypair(this.adminPrivateKey);
  }

  private safeGetAdminAddress(): string | null {
    if (!this.adminPrivateKey) {
      return null;
    }

    try {
      return this.parseKeypair(this.adminPrivateKey).toIotaAddress();
    } catch {
      return null;
    }
  }

  private resolveSignerForWorkshop(workshopAddress: string): Ed25519Keypair {
    const normalized = workshopAddress.toLowerCase();
    return this.workshopKeypairs.get(normalized) ?? this.getAdminSigner();
  }

  private loadWorkshopSignersFromEnv() {
    const raw = this.config.get<string>('IOTA_WORKSHOP_PRIVATE_KEYS_JSON', '').trim();
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [address, privateKey] of Object.entries(parsed)) {
        this.workshopKeypairs.set(address.toLowerCase(), this.parseKeypair(privateKey));
      }
    } catch {
      throw new InternalServerErrorException(
        'IOTA_WORKSHOP_PRIVATE_KEYS_JSON non valido. Usa JSON {"0xaddress":"iota..."}',
      );
    }
  }

  private parseKeypair(secret: string): Ed25519Keypair {
    const value = secret.trim();
    if (!value) {
      throw new InternalServerErrorException('Chiave privata signer vuota.');
    }

    if (value.includes(' ')) {
      return Ed25519Keypair.deriveKeypair(value);
    }

    try {
      return Ed25519Keypair.fromSecretKey(value);
    } catch {
      const normalizedHex = value.startsWith('0x') ? value.slice(2) : value;
      if (!/^[0-9a-fA-F]+$/.test(normalizedHex) || normalizedHex.length % 2 !== 0) {
        throw new InternalServerErrorException('Formato chiave privata non supportato.');
      }

      const bytes = Uint8Array.from(normalizedHex.match(/.{1,2}/g)!.map((part) => Number.parseInt(part, 16)));
      return Ed25519Keypair.fromSecretKey(bytes);
    }
  }

  private resolveNetwork(value: string): IotaNetwork {
    return value.toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
  }

  private toSdkNetwork(network: IotaNetwork): Network {
    return network === 'mainnet' ? Network.Mainnet : Network.Testnet;
  }
}
