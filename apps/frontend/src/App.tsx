import {
  ConnectButton,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
} from "@iota/dapp-kit";
import { Transaction } from "@iota/iota-sdk/transactions";
import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import DirectionsCarRounded from "@mui/icons-material/DirectionsCarRounded";
import EngineeringRounded from "@mui/icons-material/EngineeringRounded";
import FactCheckRounded from "@mui/icons-material/FactCheckRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import TimelineRounded from "@mui/icons-material/TimelineRounded";
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
} from "@mui/material";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  decodeVin,
  fetchConfig,
  fetchVehicleByVin,
  fetchVehicles,
  fetchWorkshops,
  hashFromUri,
} from "./api";

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

interface ChainConfig {
  packageId: string;
  registryId: string;
}

type AppSection =
  | "onboarding"
  | "mint"
  | "intervention"
  | "verify"
  | "workshops"
  | "passports";

const initialWorkshop = {
  workshopAddress: "",
  did: "",
  publicKeyMultibase: "",
};

const initialVehicle = {
  vin: "",
  make: "",
  model: "",
  year: new Date().getFullYear(),
  ownerAddress: "",
};

const initialIntervention = {
  passportId: "",
  odometerKm: 0,
  workType: "",
  evidenceUri: "",
  workshopAddress: "",
};

const iotaNetwork = (
  import.meta.env.VITE_IOTA_NETWORK ?? "testnet"
).toLowerCase();

function bytesToMultibaseBase64(bytes: ArrayLike<number>): string {
  let binary = "";
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

  return date.toLocaleString("en-US");
}

export default function App() {
  const currentAccount = useCurrentAccount();
  const currentWallet = useCurrentWallet();
  const disconnectWallet = useDisconnectWallet();
  const signAndExecuteTransaction = useSignAndExecuteTransaction();
  const signPersonalMessage = useSignPersonalMessage();

  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [history, setHistory] = useState<VehicleHistory | null>(null);
  const [searchVin, setSearchVin] = useState("");

  const [workshopForm, setWorkshopForm] = useState(initialWorkshop);
  const [vehicleForm, setVehicleForm] = useState(initialVehicle);
  const [interventionForm, setInterventionForm] = useState(initialIntervention);
  const [activeSection, setActiveSection] = useState<AppSection>("onboarding");
  const [workshopQuery, setWorkshopQuery] = useState("");
  const [passportQuery, setPassportQuery] = useState("");
  const [vinLookupState, setVinLookupState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [lastDecodedVin, setLastDecodedVin] = useState("");
  const [processingIntervention, setProcessingIntervention] = useState(false);
  const [autoInterventionInfo, setAutoInterventionInfo] = useState<{
    notesHash: string;
    recordedAtMs: number;
    signature: string;
  } | null>(null);
  const [chainConfig, setChainConfig] = useState<ChainConfig | null>(null);

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
        .join(" ")
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
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [passportQuery, vehicles]);

  const loadDashboard = async () => {
    try {
      const [vehicleList, workshopList, config] = await Promise.all([
        fetchVehicles(),
        fetchWorkshops(),
        fetchConfig(),
      ]);
      setVehicles(vehicleList);
      setWorkshops(workshopList);
      setChainConfig({
        packageId: config.packageId,
        registryId: config.registryId,
      });
    } catch {
      setError("Unable to load dashboard data from backend.");
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
      did:
        prev.did.trim() && !prev.did.startsWith("did:iota:")
          ? prev.did
          : autoDid,
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
    if (!normalizedAddress.startsWith("0x") || normalizedAddress.length < 4) {
      return;
    }

    setWorkshopForm((prev) => {
      if (prev.did.trim() && !prev.did.startsWith("did:iota:")) {
        return prev;
      }

      return {
        ...prev,
        did: buildDid(normalizedAddress),
      };
    });
  }, [workshopForm.workshopAddress]);

  useEffect(() => {
    if (vehicleForm.vin.trim().length >= 17) {
      return;
    }

    setVinLookupState("idle");
  }, [vehicleForm.vin]);

  useEffect(() => {
    const normalizedVin = vehicleForm.vin.trim().toUpperCase();
    if (normalizedVin.length < 17 || normalizedVin === lastDecodedVin) {
      return;
    }

    const timeout = setTimeout(async () => {
      setVinLookupState("loading");
      try {
        const result = await decodeVin(normalizedVin);
        if (result.found) {
          setVehicleForm((prev) => ({
            ...prev,
            make: result.make || prev.make,
            model: result.model || prev.model,
            year: result.year ?? prev.year,
          }));
          setVinLookupState("done");
        } else {
          setVinLookupState("error");
        }
        setLastDecodedVin(normalizedVin);
      } catch {
        setVinLookupState("error");
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [vehicleForm.vin, lastDecodedVin]);

  const onWorkshopSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!currentAccount || !currentWallet.isConnected) {
      setError("Connect your IOTA wallet before registering a workshop.");
      return;
    }

    if (!chainConfig?.packageId || !chainConfig.registryId) {
      setError("Missing on-chain configuration (package/registry IDs).");
      return;
    }

    const normalizedAddress = workshopForm.workshopAddress.trim().toLowerCase();
    const did = workshopForm.did.trim() || buildDid(normalizedAddress);

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${chainConfig.packageId}::vehicle_passport::register_workshop`,
        arguments: [
          tx.object(chainConfig.registryId),
          tx.pure.address(normalizedAddress),
          tx.pure.string(did),
          tx.pure.string(workshopForm.publicKeyMultibase),
        ],
      });

      await signAndExecuteTransaction.mutateAsync({
        transaction: tx,
        account: currentAccount,
        waitForTransaction: true,
      });

      setMessage(
        "Workshop registration submitted on-chain from your connected wallet.",
      );
      setActiveSection("workshops");
      setWorkshopForm({
        workshopAddress: currentAccount.address.toLowerCase(),
        did: buildDid(currentAccount.address.toLowerCase()),
        publicKeyMultibase: bytesToMultibaseBase64(currentAccount.publicKey),
      });
      await loadDashboard();
    } catch {
      setError(
        "Workshop registration failed on-chain. If this registry is admin-gated, use the admin wallet or deploy your own package/registry.",
      );
    }
  };

  const onVehicleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!currentAccount || !currentWallet.isConnected) {
      setError("Connect your IOTA wallet before minting a passport.");
      return;
    }

    if (!chainConfig?.packageId || !chainConfig.registryId) {
      setError("Missing on-chain configuration (package/registry IDs).");
      return;
    }

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${chainConfig.packageId}::vehicle_passport::mint_vehicle_passport`,
        arguments: [
          tx.object(chainConfig.registryId),
          tx.pure.string(vehicleForm.vin.trim().toUpperCase()),
          tx.pure.string(vehicleForm.make.trim()),
          tx.pure.string(vehicleForm.model.trim()),
          tx.pure.u64(Number(vehicleForm.year)),
          tx.pure.address(vehicleForm.ownerAddress.trim().toLowerCase()),
        ],
      });

      await signAndExecuteTransaction.mutateAsync({
        transaction: tx,
        account: currentAccount,
        waitForTransaction: true,
      });

      setMessage("Vehicle passport minted and tokenized on IOTA.");
      setActiveSection("passports");
      setVehicleForm({
        ...initialVehicle,
        ownerAddress: currentAccount.address.toLowerCase(),
      });
      await loadDashboard();
    } catch {
      setError(
        "Passport mint failed on-chain. If this registry is admin-gated, use the admin wallet or deploy your own package/registry.",
      );
    }
  };

  const onInterventionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setAutoInterventionInfo(null);

    if (!currentAccount || !currentWallet.isConnected) {
      setError("Connect your IOTA wallet before notarizing an intervention.");
      return;
    }

    if (!chainConfig?.packageId || !chainConfig.registryId) {
      setError("Missing on-chain configuration (package/registry IDs).");
      return;
    }

    const normalizedWorkshopAddress = interventionForm.workshopAddress
      .trim()
      .toLowerCase();
    if (normalizedWorkshopAddress !== currentAccount.address.toLowerCase()) {
      setError(
        "Workshop address must match the connected wallet account used for signing.",
      );
      return;
    }

    setProcessingIntervention(true);
    try {
      const recordedAtMs = Date.now();
      const hashResult = await hashFromUri(interventionForm.evidenceUri);

      const payloadToSign = JSON.stringify({
        passportId: interventionForm.passportId,
        odometerKm: Number(interventionForm.odometerKm),
        workType: interventionForm.workType,
        notesHash: hashResult.notesHash,
        evidenceUri: interventionForm.evidenceUri,
        workshopAddress: normalizedWorkshopAddress,
        recordedAtMs,
      });

      const signatureResult = await signPersonalMessage.mutateAsync({
        account: currentAccount,
        message: new TextEncoder().encode(payloadToSign),
      });

      const tx = new Transaction();
      tx.moveCall({
        target: `${chainConfig.packageId}::vehicle_passport::record_intervention`,
        arguments: [
          tx.object(chainConfig.registryId),
          tx.object(interventionForm.passportId.trim()),
          tx.pure.u64(Number(interventionForm.odometerKm)),
          tx.pure.string(interventionForm.workType.trim()),
          tx.pure.string(hashResult.notesHash),
          tx.pure.string(interventionForm.evidenceUri.trim()),
          tx.pure.string(`base64:${signatureResult.signature}`),
          tx.pure.u64(recordedAtMs),
        ],
      });

      await signAndExecuteTransaction.mutateAsync({
        transaction: tx,
        account: currentAccount,
        waitForTransaction: true,
      });

      setAutoInterventionInfo({
        notesHash: hashResult.notesHash,
        recordedAtMs,
        signature: `base64:${signatureResult.signature}`,
      });
      setMessage(
        "Intervention notarized: odometer locked in a non-decreasing sequence.",
      );
      setInterventionForm({
        ...initialIntervention,
        workshopAddress: currentAccount.address.toLowerCase(),
      });
      await loadDashboard();
    } catch {
      setError(
        "Intervention registration failed. Verify workshop authorization and odometer value.",
      );
    } finally {
      setProcessingIntervention(false);
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
      setError("VIN not found or history unavailable.");
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
                OPERATIONS
              </Typography>
              <Button
                fullWidth
                startIcon={<EngineeringRounded />}
                variant={activeSection === "onboarding" ? "contained" : "text"}
                onClick={() => setActiveSection("onboarding")}
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Workshop Onboarding
              </Button>
              <Button
                fullWidth
                startIcon={<TimelineRounded />}
                variant={activeSection === "mint" ? "contained" : "text"}
                color={activeSection === "mint" ? "secondary" : "inherit"}
                onClick={() => setActiveSection("mint")}
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Mint Passport
              </Button>
              <Button
                fullWidth
                startIcon={<FactCheckRounded />}
                variant={
                  activeSection === "intervention" ? "contained" : "text"
                }
                onClick={() => setActiveSection("intervention")}
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Notarize Intervention
              </Button>
              <Button
                fullWidth
                variant={activeSection === "verify" ? "contained" : "text"}
                onClick={() => setActiveSection("verify")}
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Verify VIN
              </Button>

              <Divider />

              <Typography variant="caption" color="text.secondary">
                REGISTRIES
              </Typography>
              <Button
                fullWidth
                variant={activeSection === "workshops" ? "contained" : "text"}
                onClick={() => setActiveSection("workshops")}
                sx={{ justifyContent: "space-between", textTransform: "none" }}
              >
                Workshops
                <Chip size="small" label={workshops.length} />
              </Button>
              <Button
                fullWidth
                variant={activeSection === "passports" ? "contained" : "text"}
                color={activeSection === "passports" ? "secondary" : "inherit"}
                onClick={() => setActiveSection("passports")}
                sx={{ justifyContent: "space-between", textTransform: "none" }}
              >
                Passports
                <Chip size="small" label={vehicles.length} />
              </Button>
            </Stack>
          </Box>

          <Stack spacing={3}>
            <Card className="glass shadow-card">
              <CardContent>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={3}
                  alignItems="center"
                >
                  <Box className="rounded-2xl bg-gradient-to-br from-accent to-teal-900 p-3 text-white">
                    <DirectionsCarRounded fontSize="large" />
                  </Box>
                  <Box flex={1}>
                    <Typography variant="h3">IOTA Auto Passport</Typography>
                    <Typography variant="body1" className="mt-2">
                      Tamper-proof maintenance log: the workshop signs each
                      intervention, the evidence is hashed, and buyers can
                      verify full history before purchase.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Chip
                      label={`${workshopCount} workshops`}
                      variant="outlined"
                    />
                    <Chip label={`${vehicleCount} vehicles`} color="primary" />
                    <Chip
                      label={`${interventionCount} interventions`}
                      color="secondary"
                    />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {(message || error) && (
              <Alert severity={error ? "error" : "success"}>
                {error ?? message}
              </Alert>
            )}

            {activeSection === "onboarding" && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <EngineeringRounded color="primary" />
                      <Typography variant="h6">
                        Workshop Onboarding (Identity)
                      </Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Wallet connect auto-fills address, DID and public key.
                      DID remains editable if you want a custom convention.
                    </Typography>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      alignItems={{ xs: "stretch", sm: "center" }}
                    >
                      <ConnectButton connectText="Connect IOTA Wallet" />
                      {currentWallet.isConnected && (
                        <Button
                          variant="outlined"
                          color="inherit"
                          startIcon={<LogoutRounded />}
                          onClick={() => disconnectWallet.mutate()}
                        >
                          Disconnect
                        </Button>
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip
                        icon={<AccountBalanceWalletRounded />}
                        label={`Network: ${iotaNetwork}`}
                      />
                      <Chip
                        color={
                          currentWallet.isConnected ? "success" : "default"
                        }
                        label={
                          currentWallet.isConnected
                            ? "Wallet connected"
                            : "Wallet disconnected"
                        }
                      />
                    </Stack>
                    <form className="space-y-3" onSubmit={onWorkshopSubmit}>
                      <TextField
                        fullWidth
                        label="Workshop Address"
                        value={workshopForm.workshopAddress}
                        onChange={(event) =>
                          setWorkshopForm((prev) => ({
                            ...prev,
                            workshopAddress: event.target.value,
                          }))
                        }
                      />
                      <TextField
                        fullWidth
                        label="DID"
                        value={workshopForm.did}
                        helperText={
                          currentAccount
                            ? "Generated from wallet, you can customize it."
                            : ""
                        }
                        onChange={(event) =>
                          setWorkshopForm((prev) => ({
                            ...prev,
                            did: event.target.value,
                          }))
                        }
                      />
                      <TextField
                        fullWidth
                        label="Public Key (multibase)"
                        value={workshopForm.publicKeyMultibase}
                        helperText={
                          currentAccount
                            ? "Derived from wallet public key."
                            : ""
                        }
                        onChange={(event) =>
                          setWorkshopForm((prev) => ({
                            ...prev,
                            publicKeyMultibase: event.target.value,
                          }))
                        }
                      />
                      <Button type="submit" fullWidth variant="contained">
                        Register Workshop
                      </Button>
                    </form>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === "mint" && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TimelineRounded color="secondary" />
                      <Typography variant="h6">
                        Mint Vehicle Passport
                      </Typography>
                    </Stack>
                    <form className="space-y-3" onSubmit={onVehicleSubmit}>
                      <TextField
                        fullWidth
                        label="VIN"
                        value={vehicleForm.vin}
                        helperText={
                          vinLookupState === "loading"
                            ? "Looking up make/model..."
                            : vinLookupState === "done"
                              ? "Make and model auto-filled from VIN."
                              : vinLookupState === "error"
                                ? "VIN lookup unavailable or VIN not recognized."
                                : "Enter a full VIN (17 chars) for auto-fill."
                        }
                        onChange={(event) =>
                          setVehicleForm((prev) => ({
                            ...prev,
                            vin: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={2}
                      >
                        <TextField
                          fullWidth
                          label="Make"
                          value={vehicleForm.make}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({
                              ...prev,
                              make: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Model"
                          value={vehicleForm.model}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({
                              ...prev,
                              model: event.target.value,
                            }))
                          }
                        />
                      </Stack>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={2}
                      >
                        <TextField
                          fullWidth
                          type="number"
                          label="Year"
                          value={vehicleForm.year}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({
                              ...prev,
                              year: Number(event.target.value),
                            }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Owner Address"
                          value={vehicleForm.ownerAddress}
                          onChange={(event) =>
                            setVehicleForm((prev) => ({
                              ...prev,
                              ownerAddress: event.target.value,
                            }))
                          }
                        />
                      </Stack>
                      <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        color="secondary"
                      >
                        Create Passport
                      </Button>
                    </form>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === "intervention" && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FactCheckRounded color="primary" />
                      <Typography variant="h6">Notarize Intervention</Typography>
                    </Stack>
                    <form className="space-y-3" onSubmit={onInterventionSubmit}>
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={2}
                      >
                        <TextField
                          fullWidth
                          label="Passport ID"
                          value={interventionForm.passportId}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({
                              ...prev,
                              passportId: event.target.value,
                            }))
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
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={2}
                      >
                        <TextField
                          fullWidth
                          label="Intervention Type"
                          value={interventionForm.workType}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({
                              ...prev,
                              workType: event.target.value,
                            }))
                          }
                        />
                      </Stack>
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={2}
                      >
                        <TextField
                          fullWidth
                          label="Evidence URI (IPFS/S3)"
                          helperText="Also supports shared Google Drive links (publicly accessible file)."
                          value={interventionForm.evidenceUri}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({
                              ...prev,
                              evidenceUri: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          fullWidth
                          label="Workshop Address"
                          value={interventionForm.workshopAddress}
                          onChange={(event) =>
                            setInterventionForm((prev) => ({
                              ...prev,
                              workshopAddress: event.target.value,
                            }))
                          }
                        />
                      </Stack>
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={processingIntervention}
                      >
                        {processingIntervention
                          ? "Notarizing..."
                          : "Record Intervention"}
                      </Button>
                    </form>
                    {autoInterventionInfo && (
                      <Card variant="outlined">
                        <CardContent>
                          <Stack spacing={0.7}>
                            <Typography variant="subtitle2">
                              Auto-generated data for latest intervention
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Hash:{" "}
                              {compactText(
                                autoInterventionInfo.notesHash,
                                20,
                                14,
                              )}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Firma:{" "}
                              {compactText(
                                autoInterventionInfo.signature,
                                20,
                                14,
                              )}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Timestamp: {autoInterventionInfo.recordedAtMs}
                            </Typography>
                          </Stack>
                        </CardContent>
                      </Card>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === "verify" && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">
                      Verify History (Buyer Check)
                    </Typography>
                    <form
                      onSubmit={onVerifySubmit}
                      className="flex flex-col gap-3 md:flex-row"
                    >
                      <TextField
                        fullWidth
                        label="Enter VIN"
                        value={searchVin}
                        onChange={(event) =>
                          setSearchVin(event.target.value.toUpperCase())
                        }
                      />
                      <Button type="submit" variant="outlined">
                        Verify
                      </Button>
                    </form>

                    {history && (
                      <Stack spacing={2}>
                        <Divider />
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          spacing={2}
                          alignItems="center"
                        >
                          <Typography variant="subtitle1">
                            {history.make} {history.model} ({history.year})
                          </Typography>
                          <Chip
                            label={
                              history.verified
                                ? "History consistent"
                                : "Anomaly detected"
                            }
                            color={history.verified ? "success" : "error"}
                          />
                          <Chip
                            label={`Passport: ${history.passportId}`}
                            variant="outlined"
                          />
                        </Stack>

                        <Stack spacing={1}>
                          {history.interventions.map((item) => (
                            <Card
                              key={`${item.seq}-${item.recordedAtMs}`}
                              variant="outlined"
                            >
                              <CardContent>
                                <Stack spacing={1}>
                                  <Typography variant="subtitle2">
                                    #{item.seq} - {item.workType}
                                  </Typography>
                                  <Typography variant="body2">
                                    Odometer: <strong>{item.odometerKm}</strong>{" "}
                                    | Workshop: {item.workshopAddress}
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                  >
                                    Hash: {item.notesHash}
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                  >
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

            {activeSection === "workshops" && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">Onboarded Workshops</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Full list of registered workshops. Search by address, DID
                      or public key.
                    </Typography>
                    <TextField
                      size="small"
                      fullWidth
                      label="Search workshop (address, DID, public key)"
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
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  No workshops found.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredWorkshops.map((workshop) => (
                            <TableRow
                              key={`${workshop.workshopAddress}-${workshop.createdAt}`}
                            >
                              <TableCell>
                                {compactText(workshop.workshopAddress, 12, 10)}
                              </TableCell>
                              <TableCell>
                                {compactText(workshop.did, 22, 10)}
                              </TableCell>
                              <TableCell>
                                {compactText(
                                  workshop.publicKeyMultibase,
                                  18,
                                  10,
                                )}
                              </TableCell>
                              <TableCell>
                                {formatDate(workshop.createdAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {activeSection === "passports" && (
              <Card className="shadow-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">Vehicle Passports</Typography>
                    <Typography variant="body2" color="text.secondary">
                      View of registered passports with intervention status.
                      Search by VIN or passport ID.
                    </Typography>
                    <TextField
                      size="small"
                      fullWidth
                      label="Search passport (VIN, make, model, passport ID)"
                      value={passportQuery}
                      onChange={(event) => setPassportQuery(event.target.value)}
                    />
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>VIN</TableCell>
                            <TableCell>Vehicle</TableCell>
                            <TableCell>Year</TableCell>
                            <TableCell>Passport ID</TableCell>
                            <TableCell align="right">Interventions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredPassports.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5}>
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  No passports found.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredPassports.map((vehicle) => (
                            <TableRow
                              key={`${vehicle.vin}-${vehicle.passportId}`}
                            >
                              <TableCell>{vehicle.vin}</TableCell>
                              <TableCell>
                                {vehicle.make} {vehicle.model}
                              </TableCell>
                              <TableCell>{vehicle.year}</TableCell>
                              <TableCell>
                                {compactText(vehicle.passportId, 12, 10)}
                              </TableCell>
                              <TableCell align="right">
                                {vehicle.interventions}
                              </TableCell>
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
