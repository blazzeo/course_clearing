import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { publicKey } = useWallet()
  const location = useLocation()

  return (
    <div style={{ minHeight: '100vh' }}>
      <nav style={{
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '16px 0',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '32px'
      }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <Link to="/" style={{ fontSize: '24px', fontWeight: 'bold', textDecoration: 'none', color: '#667eea' }}>
              Clearing Service
            </Link>
            <Link 
              to="/positions" 
              style={{ 
                textDecoration: 'none', 
                color: location.pathname === '/positions' ? '#667eea' : '#666',
                fontWeight: location.pathname === '/positions' ? '600' : '400'
              }}
            >
              Позиции
            </Link>
            <Link 
              to="/positions/create" 
              style={{ 
                textDecoration: 'none', 
                color: location.pathname === '/positions/create' ? '#667eea' : '#666',
                fontWeight: location.pathname === '/positions/create' ? '600' : '400'
              }}
            >
              Создать позицию
            </Link>
            <Link 
              to="/clearing/multi-party" 
              style={{ 
                textDecoration: 'none', 
                color: location.pathname === '/clearing/multi-party' ? '#667eea' : '#666',
                fontWeight: location.pathname === '/clearing/multi-party' ? '600' : '400'
              }}
            >
              Многосторонний клиринг
            </Link>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {publicKey && (
              <Link 
                to={`/participant/${publicKey.toBase58()}`}
                style={{ 
                  textDecoration: 'none', 
                  color: '#666',
                  fontSize: '14px'
                }}
              >
                {publicKey.toBase58().slice(0, 8)}...
              </Link>
            )}
            <WalletMultiButton />
          </div>
        </div>
      </nav>
      <div className="container">
        {children}
      </div>
    </div>
  )
}




