import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { Buffer } from 'buffer'

window.Buffer = Buffer

import { BrowserRouter } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

import '@solana/wallet-adapter-react-ui/styles.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { UserRoleProvider } from './providers/UserTypeProvider.tsx'

export const RPC_URL: string = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ConnectionProvider endpoint={RPC_URL}>
            <WalletProvider wallets={[]} autoConnect>
                <WalletModalProvider>
                    <BrowserRouter>
                        <ErrorBoundary>
                            <UserRoleProvider>
                                <App />
                            </UserRoleProvider>
                        </ErrorBoundary>
                    </BrowserRouter>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    </React.StrictMode>,
)

