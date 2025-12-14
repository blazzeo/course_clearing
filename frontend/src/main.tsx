import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { BrowserRouter } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

import '@solana/wallet-adapter-react-ui/styles.css';

const endpoint = clusterApiUrl('devnet');

const wallets = [
	new SolflareWalletAdapter(),
];

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ConnectionProvider endpoint={endpoint}>
			<WalletProvider wallets={wallets} autoConnect>
				<WalletModalProvider>
					<BrowserRouter>
						<App />
					</BrowserRouter>
				</WalletModalProvider>
			</WalletProvider>
		</ConnectionProvider>
	</React.StrictMode>,
)






