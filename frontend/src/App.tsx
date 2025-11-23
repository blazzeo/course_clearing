import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { useMemo } from 'react'
import Layout from './components/Layout'
import Home from './pages/Home'
import Positions from './pages/Positions'
import CreatePosition from './pages/CreatePosition'
import Participant from './pages/Participant'
import MultiPartyClearing from './pages/MultiPartyClearing'
import '@solana/wallet-adapter-react-ui/styles.css'

function App() {
  // Используем локальную ноду для разработки
  const endpoint = useMemo(() => {
    return import.meta.env.VITE_SOLANA_RPC_URL || 'http://localhost:8899'
  }, [])
  
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <BrowserRouter>
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/positions/create" element={<CreatePosition />} />
                <Route path="/participant/:address" element={<Participant />} />
                <Route path="/clearing/multi-party" element={<MultiPartyClearing />} />
              </Routes>
            </Layout>
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default App

