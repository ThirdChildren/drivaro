import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
});

export interface WorkshopPayload {
  workshopAddress: string;
  did: string;
  publicKeyMultibase: string;
}

export interface VehiclePayload {
  vin: string;
  make: string;
  model: string;
  year: number;
  ownerAddress: string;
}

export interface InterventionPayload {
  odometerKm: number;
  workType: string;
  notesHash: string;
  evidenceUri: string;
  workshopAddress: string;
  workshopSignature: string;
  recordedAtMs: number;
}

export const fetchVehicles = async () => (await api.get('/vehicles')).data;
export const fetchVehicleByVin = async (vin: string) => (await api.get(`/vehicles/${vin}`)).data;
export const fetchWorkshops = async () => (await api.get('/workshops')).data;

export const registerWorkshop = async (payload: WorkshopPayload) =>
  (await api.post('/workshops', payload)).data;

export const createVehicle = async (payload: VehiclePayload) => (await api.post('/vehicles', payload)).data;

export const addIntervention = async (passportId: string, payload: InterventionPayload) =>
  (await api.post(`/vehicles/${passportId}/interventions`, payload)).data;
