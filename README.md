# IOTA Auto Passport

Registro riparazioni auto anti-manomissione chilometri su IOTA.

## Obiettivo

Bloccare le frodi di scalatura km e storico manutenzione falso con:
- `notarization`: hash e firma digitale di ogni intervento
- `digital identity`: officine autorizzate via DID + public key
- `tokenization`: un passport on-chain (oggetto Move) per ogni auto

## Stack

- Smart contract: Move (`iota move`)
- Backend: NestJS + TypeScript
- Frontend: React + TypeScript + Tailwind + MUI

## Struttura

```txt
iota-auto-passport/
  apps/
    backend/                 # API NestJS e bridge verso iota CLI
    frontend/                # Dashboard UX officina + buyer verification
  contracts/
    vehicle_passport_move/   # Smart contract Move
  scripts/
    iota-deploy.sh           # Publish package e extraction package/registry ID
```

## Smart Contract (Move)

Path: `contracts/vehicle_passport_move/sources/vehicle_passport.move`

Entità principali:
- `Registry` (shared object): admin + elenco officine autorizzate
- `VehiclePassport` (tokenized object): identità veicolo + storico interventi
- `ServiceIntervention`: intervento append-only con km, hash, firma e timestamp

Regole anti-manomissione:
- solo officine attive possono registrare interventi
- `odometer_km` deve essere sempre crescente (`no rollback`)
- storico interventi append-only dentro il passport

### Build/Test Move

```bash
cd contracts/vehicle_passport_move
iota move build
iota move test
```

## Deploy su IOTA con CLI

### Prerequisiti wallet/CLI

```bash
iota --version
iota client active-address
```

### Publish package

Da root progetto:

```bash
./scripts/iota-deploy.sh
```

Lo script salva output in `docs/publish-output.json` e stampa:
- `IOTA_PACKAGE_ID`
- `IOTA_REGISTRY_ID`

## Backend NestJS

Path: `apps/backend`

### API principali
- `POST /api/contracts/publish`
- `POST /api/workshops`
- `GET /api/workshops`
- `POST /api/vehicles`
- `GET /api/vehicles`
- `GET /api/vehicles/:vin`
- `POST /api/vehicles/:passportId/interventions`

Il backend usa `iota client call` per invocare:
- `register_workshop`
- `mint_vehicle_passport`
- `record_intervention`

## Frontend

Path: `apps/frontend`

Dashboard con 4 aree:
- onboarding officina (identity)
- mint passport veicolo (tokenization)
- notarizzazione intervento (hash + signature)
- verifica buyer su VIN con timeline cronologica

### Onboarding automatizzato

- Wallet connect IOTA integrato (`@iota/dapp-kit`)
- `Address Officina` e `Public Key` vengono auto-compilati dal wallet connesso
- `DID` viene auto-generato con convenzione `did:iota:<network>:<address>` (modificabile da UI)

## Setup locale

1. Installa dipendenze

```bash
npm install
```

2. Crea env da template

```bash
cp .env.example .env
```

3. Inserisci in `.env` i valori dal deploy

```env
IOTA_PACKAGE_ID=0x...
IOTA_REGISTRY_ID=0x...
VITE_IOTA_NETWORK=testnet
```

4. Avvio servizi

```bash
npm run dev:backend
npm run dev:frontend
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3000/api`

## Note operative

- In questo scaffold il backend conserva anche uno stato off-chain in memoria per UX veloce.
- Per produzione conviene aggiungere DB persistente (PostgreSQL) e indicizzazione eventi on-chain.
- Le firme e gli hash sono accettati come stringhe codificate (hex/base64/multibase).
