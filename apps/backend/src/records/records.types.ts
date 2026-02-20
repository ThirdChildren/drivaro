export interface WorkshopRecord {
  workshopAddress: string;
  did: string;
  publicKeyMultibase: string;
  createdAt: string;
  tx?: unknown;
}

export interface InterventionRecord {
  seq: number;
  odometerKm: number;
  workType: string;
  notesHash: string;
  evidenceUri: string;
  workshopAddress: string;
  workshopSignature: string;
  recordedAtMs: number;
  tx?: unknown;
}

export interface VehicleRecord {
  vin: string;
  make: string;
  model: string;
  year: number;
  ownerAddress: string;
  passportId: string;
  mintedAt: string;
  interventions: InterventionRecord[];
  tx?: unknown;
}
