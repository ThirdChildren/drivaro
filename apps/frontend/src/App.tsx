import { ConnectButton, useCurrentAccount, useCurrentWallet, useDisconnectWallet } from '@iota/dapp-kit';
import AccountBalanceWalletRounded from '@mui/icons-material/AccountBalanceWalletRounded';
import DirectionsCarRounded from '@mui/icons-material/DirectionsCarRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import TimelineRounded from '@mui/icons-material/TimelineRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  addIntervention,
  createVehicle,
  fetchVehicleByVin,
  fetchVehicles,
  fetchWorkshops,
  registerWorkshop,
} from './api';

interface VehicleSummary {
  vin: string;
  make: string;
  model: string;
  year: number;
  passportId: string;
  interventions: number;
}

interface WorkshopSummary {
  workshopAddress: string;
  did: string;
  publicKeyMultibase: string;
  createdAt: string;
}

interface HistoryIntervention {
  seq: number;
  odometerKm: number;
  workType: string;
  notesHash: string;
  evidenceUri: string;
  workshopAddress: string;
  workshopSignature: string;
  recordedAtMs: number;
}

interface VehicleHistory {
  vin: string;
  make: string;
  model: string;
  year: number;
  ownerAddress: string;
  passportId: string;
  interventions: HistoryIntervention[];
  verified: boolean;
}

type AppSection =
  | 'onboarding'
  | 'mint'
  | 'intervention'
  | 'verify'
  | 'workshops'
  | 'passports';

const initialWorkshop = {
  workshopAddress: '',
  did: '',
  publicKeyMultibase: '',
};

const initialVehicle = {
  vin: '',
  make: '',
  model: '',
  year: new Date().getFullYear(),
  ownerAddress: '',
};

const initialIntervention = {
  passportId: '',
  odometerKm: 0,
  workType: '',
  notesHash: '',
  evidenceUri: '',
  workshopAddress: '',
  workshopSignature: '',
  recordedAtMs: Date.now(),
};

const iotaNetwork = (import.meta.env.VITE_IOTA_NETWORK ?? 'testnet').toLowerCase();

function bytesToMultibaseBase64(bytes: ArrayLike<number>): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `m${btoa(binary)}`;
}

function buildDid(address: string): string {
  return `did:iota:${iotaNetwork}:${address.toLowerCase()}`;
}

function compactText(text: string, start = 10, end = 8): string {
  if (text.length <= start + end + 3) {
    return text;
  }

  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return date.toLocaleString('it-IT');
}

export default function App() {
  const currentAccount = useCurrentAccount();
  const currentWallet = useCurrentWallet();
  const disconnectWallet = useDisconnectWallet();

  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [history, setHistory] = useState<VehicleHistory | null>(null);
  const [searchVin, setSearchVin] = useState('');

  const [workshopForm, setWorkshopForm] = useState(initialWorkshop);
  const [vehicleForm, setVehicleForm] = useState(initialVehicle);
  const [interventionForm, setInterventionForm] = useState(initialIntervention);
  const [activeSection, setActiveSection] = useState<AppSection>('onboarding');
  const [workshopQuery, setWorkshopQuery] = useState('');
  const [passportQuery, setPassportQuery] = useState('');

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vehicleCount = vehicles.length;
  const workshopCount = workshops.length;
  const interventionCount = useMemo(
    () => vehicles.reduce((acc, item) => acc + item.interventions, 0),
    [vehicles],
  );
  const filteredWorkshops = useMemo(() => {
    const query = workshopQuery.trim().toLowerCase();
    if (!query) {
      return workshops;
    }

    return workshops.filter((workshop) =>
      [workshop.workshopAddress, workshop.did, workshop.publicKeyMultibase]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [workshopQuery, workshops]);

  const filteredPassports = useMemo(() => {
    const query = passportQuery.trim().toLowerCase();
    if (!query) {
      return vehicles;
    }

    return vehicles.filter((vehicle) =>
      [vehicle.vin, vehicle.make, vehicle.model, vehicle.passportId]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [passportQuery, vehicles]);

  const loadDashboard = async () => {
    try {
      const [vehicleList, workshopList] = await Promise.all([fetchVehicles(), fetchWorkshops()]);
      setVehicles(vehicleList);
      setWorkshops(workshopList);
    } catch {
      setError('Impossibile caricare la dashboard dal backend.');
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!currentAccount) {
      return;
    }

    const autoAddress = currentAccount.address.toLowerCase();
    const autoDid = buildDid(autoAddress);
    const autoPublicKey = bytesToMultibaseBase64(currentAccount.publicKey);

    setWorkshopForm((prev) => ({
      ...prev,
      workshopAddress: autoAddress,
      publicKeyMultibase: autoPublicKey,
      did: prev.did.trim() && !prev.did.startsWith('did:iota:') ? prev.did : autoDid,
    }));

    setVehicleForm((prev) => ({
      ...prev,
      ownerAddress: prev.ownerAddress || autoAddress,
    }));

    setInterventionForm((prev) => ({
      ...prev,
      workshopAddress: prev.workshopAddress || autoAddress,
    }));
  }, [currentAccount]);

  useEffect(() => {
    const normalizedAddress = workshopForm.workshopAddress.trim().toLowerCase();
    if (!normalizedAddress.startsWith('0x') || normalizedAddress.length < 4) {
      return;
    }

    setWorkshopForm((prev) => {
      if (prev.did.trim() && !prev.did.startsWith('did:iota:')) {
        return prev;
      }

      return {
        ...prev,
        did: buildDid(normalizedAddress),
      };
    });
  }, [workshopForm.workshopAddress]);

  const onWorkshopSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const onboardedWorkshop = await registerWorkshop(workshopForm);
      setMessage('Officina registrata on-chain e pronta alla firma interventi.');
      setWorkshops((prev) => {
        const withoutDuplicate = prev.filter(
          (workshop) =>
            workshop.workshopAddress.toLowerCase() !==
            onboardedWorkshop.workshopAddress.toLowerCase(),
        );
        return [...withoutDuplicate, onboardedWorkshop];
      });
      setActiveSection('workshops');
      setWorkshopForm(initialWorkshop);
    } catch {
      setError('Registrazione officina fallita. Controlla package/registry ID e wallet CLI.');
    }
  };

  const onVehicleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await createVehicle(vehicleForm);
      setMessage('Passport veicolo creato e tokenizzato su IOTA.');
      setActiveSection('passports');
      setVehicleForm(initialVehicle);
      await loadDashboard();
    } catch {
      setError('Creazione passport fallita.');
    }
  };

  const onInterventionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      await addIntervention(interventionForm.passportId, {
        odometerKm: Number(interventionForm.odometerKm),
        workType: interventionForm.workType,
        notesHash: interventionForm.notesHash,
        evidenceUri: interventionForm.evidenceUri,
        workshopAddress: interventionForm.workshopAddress,
        workshopSignature: interventionForm.workshopSignature,
        recordedAtMs: Number(interventionForm.recordedAtMs),
      });

      setMessage('Intervento notarizzato: chilometraggio bloccato in sequenza crescente.');
      setInterventionForm({ ...initialIntervention, recordedAtMs: Date.now() });
      await loadDashboard();
    } catch {
      setError('Registrazione intervento fallita. Verifica autorizzazione officina e km.');
    }
  };

  const onVerifySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const data = await fetchVehicleByVin(searchVin.trim().toUpperCase());
      setHistory(data);
      setMessage(null);
    } catch {
      setHistory(null);
      setError('VIN non trovato o cronologia non disponibile.');
    }
  };

  return (
    <Container maxWidth={false} className="py-6">
      <Box className="mx-auto max-w-[1400px]">
        <Box className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <Box className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card md:sticky md:top-4 md:h-[calc(100vh-2rem)] md:overflow-auto">
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box className="rounded-xl bg-gradient-to-br from-accent to-teal-900 p-2 text-white">
                  <DirectionsCarRounded />
                </Box>
                <Box>
                  <Typography variant="subtitle1" className="font-semibold">
                    Auto Passport
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    IOTA Registry
                  </Typography>
                </Box>
              </Stack>

              <Divider />

              <Typography variant="caption" color="text.secondary">
                OPERAZIONI
              </Typography>
              <Button
                fullWidth
                startIcon={<EngineeringRounded />}
                variant={activeSection === 'onboarding' ? 'contained' : 'text'}
                onClick={() => setActiveSection('onboarding')}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                Onboarding Officina
              </Button>
              <Button
                fullWidth
                startIcon={<TimelineRounded />}
                variant={activeSection === 'mint' ? 'contained' : 'text'}
                color={activeSection === 'mint' ? 'secondary' : 'inherit'}
                onClick={() => setActiveSection('mint')}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                Mint Passport
              </Button>
              <Button
                fullWidth
                startIcon={<FactCheckRounded />}
                variant={activeSection === 'intervention' ? 'contained' : 'text'}
                onClick={() => setActiveSection('intervention')}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                Notarizza Intervento
              </Button>
              <Button
                fullWidth
                variant={activeSection === 'verify' ? 'contained' : 'text'}
                onClick={() => setActiveSection('verify')}
                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              >
                Verifica VIN
              </Button>

              <Divider />

              <Typography variant="caption" color="text.secondary">
                REGISTRI
              </Typography>
              <Button
                fullWidth
                variant={activeSection === 'workshops' ? 'contained' : 'text'}
                onClick={() => setActiveSection('workshops')}
                sx={{ justifyContent: 'space-between', textTransform: 'none' }}
              >
                Officine
                <Chip size="small" label={workshops.length} />
              </Button>
              <Button
                fullWidth
                variant={activeSection === 'passports' ? 'contained' : 'text'}
                color={activeSection === 'passports' ? 'secondary' : 'inherit'}
                onClick={() => setActiveSection('passports')}
                sx={{ justifyContent: 'space-between', textTransform: 'none' }}
              >
                Passport
                <Chip size="small" label={vehicles.length} />
              </Button>
            </Stack>
          </Box>

          <Stack spacing={3}>
            <Card className="glass shadow-card">
              <CardContent>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="center">
                  <Box className="rounded-2xl bg-gradient-to-br from-accent to-teal-900 p-3 text-white">
                    <DirectionsCarRounded fontSize="large" />
                  </Box>
                  <Box flex={1}>
                    <Typography variant="h3">IOTA Auto Passport</Typography>
                    <Typography variant="body1" className="mt-2">
                      Diario manutenzione non cancellabile: officina firma, hash intervento,
                      cronologia verificabile prima dell’acquisto.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Chip label={`${workshopCount} officine`} variant="outlined" />
                    <Chip label={`${vehicleCount} veicoli`} color="primary" />
                    <Chip label={`${interventionCount} interventi`} color="secondary" />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {(message || error) && (
              <Alert severity={error ? 'error' : 'success'}>{error ?? message}</Alert>
            )}

            {activeSection === 'onboarding' && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <EngineeringRounded color="primary" />
                      <Typography variant="h6">Onboarding Officina (Identity)</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Wallet connect auto-compila address, DID e public key. Il DID resta editabile
                      se vuoi una convenzione diversa.
                    </Typography>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                    >
                      <ConnectButton connectText="Connetti Wallet IOTA" />
                      {currentWallet.isConnected && (
                        <Button
                          variant="outlined"
                          color="inherit"
                          startIcon={<LogoutRounded />}
                          onClick={() => disconnectWallet.mutate()}
                        >
                          Disconnetti
                        </Button>
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip icon={<AccountBalanceWalletRounded />} label={`Rete: ${iotaNetwork}`} />
                      <Chip
                        color={currentWallet.isConnected ? 'success' : 'default'}
                        label={currentWallet.isConnected ? 'Wallet connesso' : 'Wallet non connesso'}
                      />
                    </Stack>
                    <form className="space-y-3" onSubmit={onWorkshopSubmit}>
                      <TextField
                        fullWidth
                        label="Address Officina"
                        value={workshopForm.workshopAddress}
                        onChange={(event) =>
                          setWorkshopForm((prev) => ({ ...prev, workshopAddress: event.target.value }))
                        }
                      />
                      <TextField
                        fullWidth
                        label="DID"
                        value={workshopForm.did}
                        helperText={currentAccount ? 'Generato dal wallet, puoi personalizzarlo.' : ''}
                        onChange={(event) =>
                          setWorkshopForm((prev) => ({ ...prev, did: event.target.value }))
                        }
                      />
                      <TextField
                        fullWidth
                        label="Public Key (multibase)"
                        value={workshopForm.publicKeyMultibase}
                        helperText={currentAccount ? 'Derivata dalla public key del wallet.' : ''}
                        onChange={(event) =>
                          setWorkshopForm((prev) => ({ ...prev, publicKeyMultibase: event.target.value }))
                        }
                      />
                      <Button type="submit" fullWidth variant="contained">
                        Registra Officina
                      </Button>
                    </form>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === 'mint' && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TimelineRounded color="secondary" />
                      <Typography variant="h6">Mint Passport Veicolo</Typography>
                    </Stack>
                    <form className="space-y-3" onSubmit={onVehicleSubmit}>
                      <TextField
                        fullWidth
                        label="VIN"
                        value={vehicleForm.vin}
                        onChange={(event) =>
                          setVehicleForm((prev) => ({ ...prev, vin: event.target.value.toUpperCase() }))
                        }
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          fullWidth
                          label="Marca"
                          value={vehicleForm.make}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({ ...prev, make: event.target.value }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Modello"
                          value={vehicleForm.model}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({ ...prev, model: event.target.value }))
                          }
                        />
                      </Stack>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          fullWidth
                          type="number"
                          label="Anno"
                          value={vehicleForm.year}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({ ...prev, year: Number(event.target.value) }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Owner Address"
                          value={vehicleForm.ownerAddress}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({ ...prev, ownerAddress: event.target.value }))
                          }
                        />
                      </Stack>
                      <Button type="submit" fullWidth variant="contained" color="secondary">
                        Crea Passport
                      </Button>
                    </form>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === 'intervention' && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FactCheckRounded color="primary" />
                      <Typography variant="h6">Notarizza Intervento</Typography>
                    </Stack>
                    <form className="space-y-3" onSubmit={onInterventionSubmit}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                        <TextField
                          fullWidth
                          label="Passport ID"
                          value={interventionForm.passportId}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({ ...prev, passportId: event.target.value }))
                          }
                        />
                        <TextField
                          fullWidth
                          type="number"
                          label="Km Odometer"
                          value={interventionForm.odometerKm}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({
                              ...prev,
                              odometerKm: Number(event.target.value),
                            }))
                          }
                        />
                      </Stack>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                        <TextField
                          fullWidth
                          label="Tipo Intervento"
                          value={interventionForm.workType}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({ ...prev, workType: event.target.value }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Hash Report"
                          value={interventionForm.notesHash}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({ ...prev, notesHash: event.target.value }))
                          }
                        />
                      </Stack>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                        <TextField
                          fullWidth
                          label="Evidence URI (IPFS/S3)"
                          value={interventionForm.evidenceUri}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({ ...prev, evidenceUri: event.target.value }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Address Officina"
                          value={interventionForm.workshopAddress}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({
                              ...prev,
                              workshopAddress: event.target.value,
                            }))
                          }
                        />
                      </Stack>
                      <TextField
                        fullWidth
                        label="Firma Digitale Officina"
                        value={interventionForm.workshopSignature}
                        onChange={(event) =>
                          setInterventionForm((prev) => ({
                            ...prev,
                            workshopSignature: event.target.value,
                          }))
                        }
                      />
                      <TextField
                        fullWidth
                        type="number"
                        label="Timestamp ms"
                        value={interventionForm.recordedAtMs}
                        onChange={(event) =>
                          setInterventionForm((prev) => ({
                            ...prev,
                            recordedAtMs: Number(event.target.value),
                          }))
                        }
                      />
                      <Button type="submit" variant="contained">
                        Registra Intervento
                      </Button>
                    </form>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === 'verify' && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">Verifica Cronologia (Buyer Check)</Typography>
                    <form onSubmit={onVerifySubmit} className="flex flex-col gap-3 md:flex-row">
                      <TextField
                        fullWidth
                        label="Inserisci VIN"
                        value={searchVin}
                        onChange={(event) => setSearchVin(event.target.value.toUpperCase())}
                      />
                      <Button type="submit" variant="outlined">
                        Verifica
                      </Button>
                    </form>

                    {history && (
                      <Stack spacing={2}>
                        <Divider />
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                          <Typography variant="subtitle1">
                            {history.make} {history.model} ({history.year})
                          </Typography>
                          <Chip
                            label={history.verified ? 'Cronologia coerente' : 'Anomalia rilevata'}
                            color={history.verified ? 'success' : 'error'}
                          />
                          <Chip label={`Passport: ${history.passportId}`} variant="outlined" />
                        </Stack>

                        <Stack spacing={1}>
                          {history.interventions.map((item) => (
                            <Card key={`${item.seq}-${item.recordedAtMs}`} variant="outlined">
                              <CardContent>
                                <Stack spacing={1}>
                                  <Typography variant="subtitle2">
                                    #{item.seq} - {item.workType}
                                  </Typography>
                                  <Typography variant="body2">
                                    Km: <strong>{item.odometerKm}</strong> | Officina:{' '}
                                    {item.workshopAddress}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary">
                                    Hash: {item.notesHash}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary">
                                    URI: {item.evidenceUri}
                                  </Typography>
                                </Stack>
                              </CardContent>
                            </Card>
                          ))}
                        </Stack>
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === 'workshops' && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">Officine Onboardate</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Elenco completo officine registrate. Cerca per address, DID o public key.
                    </Typography>
                    <TextField
                      size="small"
                      fullWidth
                      label="Cerca officina (address, DID, public key)"
                      value={workshopQuery}
                      onChange={(event) => setWorkshopQuery(event.target.value)}
                    />
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Address</TableCell>
                            <TableCell>DID</TableCell>
                            <TableCell>Public key</TableCell>
                            <TableCell>Onboarded</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredWorkshops.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={4}>
                                <Typography variant="body2" color="text.secondary">
                                  Nessuna officina trovata.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredWorkshops.map((workshop) => (
                            <TableRow key={`${workshop.workshopAddress}-${workshop.createdAt}`}>
                              <TableCell>{compactText(workshop.workshopAddress, 12, 10)}</TableCell>
                              <TableCell>{compactText(workshop.did, 22, 10)}</TableCell>
                              <TableCell>{compactText(workshop.publicKeyMultibase, 18, 10)}</TableCell>
                              <TableCell>{formatDate(workshop.createdAt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === 'passports' && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">Passport Veicoli</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Vista dei passport registrati con stato interventi. Cerca per VIN o ID.
                    </Typography>
                    <TextField
                      size="small"
                      fullWidth
                      label="Cerca passport (VIN, marca, modello, passport ID)"
                      value={passportQuery}
                      onChange={(event) => setPassportQuery(event.target.value)}
                    />
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>VIN</TableCell>
                            <TableCell>Veicolo</TableCell>
                            <TableCell>Anno</TableCell>
                            <TableCell>Passport ID</TableCell>
                            <TableCell align="right">Interventi</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredPassports.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5}>
                                <Typography variant="body2" color="text.secondary">
                                  Nessun passport trovato.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredPassports.map((vehicle) => (
                            <TableRow key={`${vehicle.vin}-${vehicle.passportId}`}>
                              <TableCell>{vehicle.vin}</TableCell>
                              <TableCell>
                                {vehicle.make} {vehicle.model}
                              </TableCell>
                              <TableCell>{vehicle.year}</TableCell>
                              <TableCell>{compactText(vehicle.passportId, 12, 10)}</TableCell>
                              <TableCell align="right">{vehicle.interventions}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Box>
      </Box>
    </Container>
  );
}
