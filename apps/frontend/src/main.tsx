import { IotaClientProvider, WalletProvider } from '@iota/dapp-kit';
import '@iota/dapp-kit/dist/index.css';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Network, getFullnodeUrl } from '@iota/iota-sdk/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './styles.css';

const queryClient = new QueryClient();
const iotaNetwork = (import.meta.env.VITE_IOTA_NETWORK ?? 'testnet').toLowerCase();

const networks = {
  testnet: { url: getFullnodeUrl(Network.Testnet) },
  mainnet: { url: getFullnodeUrl(Network.Mainnet) },
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0f766e',
    },
    secondary: {
      main: '#b45309',
    },
    background: {
      default: '#f8f7f4',
      paper: '#ffffff',
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
    h3: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <IotaClientProvider networks={networks} defaultNetwork={iotaNetwork in networks ? iotaNetwork : 'testnet'}>
        <WalletProvider autoConnect>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
          </ThemeProvider>
        </WalletProvider>
      </IotaClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
