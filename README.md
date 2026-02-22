# Drivaro

Tamper-proof vehicle maintenance registry on IOTA.

## Goal

Prevent odometer rollback and fake maintenance history with:
- `notarization`: hash + digital signature for each intervention
- `digital identity`: authorized workshops via DID + public key
- `tokenization`: one on-chain passport object per vehicle

## Stack

- Smart contract: Move (`iota move`)
- Backend: NestJS + TypeScript
- Frontend: React + TypeScript + Tailwind + MUI

## Project Structure

```txt
drivaro/
  apps/
    backend/                 # NestJS API (on-chain read/index + utilities)
    frontend/                # Workshop + buyer dashboard
  contracts/
    vehicle_passport_move/   # Move smart contract
  scripts/
    iota-deploy.sh           # Publish package and extract package/registry IDs
```

## Smart Contract (Move)

Path: `contracts/vehicle_passport_move/sources/vehicle_passport.move`

Main entities:
- `Registry` (shared object): admin + authorized workshops
- `VehiclePassport` (tokenized object): vehicle identity + intervention history
- `ServiceIntervention`: append-only intervention record with odometer, hash, signature, timestamp

Anti-tampering rules:
- workshop onboarding requires `workshop == tx sender`
- passport mint requires `owner == tx sender`
- only active workshops can record interventions
- `odometer_km` must be non-decreasing (`no rollback`)
- interventions are append-only inside the passport object

### Build/Test Move

```bash
cd contracts/vehicle_passport_move
iota move build
iota move test
```

## Deploy Contract with CLI

### Prerequisites

```bash
iota --version
iota client active-address
```

### Publish package

From project root:

```bash
./scripts/iota-deploy.sh
```

The script stores output in `docs/publish-output.json` and prints:
- `IOTA_PACKAGE_ID`
- `IOTA_REGISTRY_ID`

## Backend (NestJS)

Path: `apps/backend`

### Main APIs
- `POST /api/contracts/publish`
- `POST /api/workshops`
- `GET /api/workshops`
- `POST /api/vehicles`
- `GET /api/vehicles`
- `GET /api/vehicles/:vin`
- `POST /api/vehicles/:passportId/interventions`
- `GET /api/utils/vin/:vin`
- `POST /api/utils/hash-from-uri`

The backend uses `@iota/iota-sdk` to:
- read workshops and passports directly from on-chain data (events + objects)
- serve VIN decode and evidence hashing utilities
- expose config for frontend transaction building

### Signer Configuration (Optional)

Core demo flow is wallet-signed from frontend, so backend private keys are not required.

Only if you want backend-signed write endpoints, set:
- `IOTA_ADMIN_PRIVATE_KEY`: admin signer for `register_workshop` and `mint_vehicle_passport`
- `IOTA_WORKSHOP_PRIVATE_KEYS_JSON`: optional map `{"0xworkshopAddress":"privateKeyOrMnemonic"}` for workshop-side `record_intervention`
- `IOTA_RPC_URL`: optional fullnode URL (defaults from `IOTA_NETWORK`)

## Frontend

Path: `apps/frontend`

Dashboard areas:
- workshop onboarding (identity)
- vehicle passport mint (tokenization)
- intervention notarization (hash + signature)
- buyer VIN verification (timeline)
- searchable registries (workshops and passports)

### Automated Onboarding

- IOTA wallet connect integrated (`@iota/dapp-kit`)
- workshop address + public key auto-filled from connected wallet
- DID auto-generated as `did:iota:<network>:<address>` (editable)
- workshop onboarding/mint/intervention transactions are signed from the connected wallet
- make/model auto-filled from VIN lookup
- intervention flow auto-computes timestamp, evidence hash, and wallet signature
- Google Drive shared links are supported for evidence hashing

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create env file

```bash
cp .env.example .env
```

3. Fill `.env`

```env
IOTA_NETWORK=testnet
IOTA_PACKAGE_ID=0x...
IOTA_REGISTRY_ID=0x...
VITE_API_URL=http://localhost:3000/api
VITE_IOTA_NETWORK=testnet
```

4. Run services

```bash
npm run dev:backend
npm run dev:frontend
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3000/api`

## Production Architecture Notes

### Wallet-Signed Transaction Model

The recommended mode for public demos/hackathons:
- each workshop signs and sends transactions with its own IOTA wallet
- backend does not need workshop private keys
- backend remains focused on utilities, indexing and verification APIs

## Operational Notes

- Backend uses short-lived cache for event/object reads to keep dashboard responsive.
- For production, add persistent storage (PostgreSQL) and on-chain event indexing.
- Hashes and signatures are stored as encoded strings (hex/base64/multibase).
