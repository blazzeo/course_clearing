import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

export default function CreatePosition() {
  const { publicKey } = useWallet()
  const navigate = useNavigate()
  const [counterparty, setCounterparty] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!publicKey) {
      alert('Пожалуйста, подключите кошелек')
      return
    }

    if (!counterparty || !amount) {
      alert('Заполните все поля')
      return
    }

    try {
      setLoading(true)
      const amountLamports = parseFloat(amount) * 1e9
      
      await axios.post(`${API_URL}/positions`, {
        counterparty_address: counterparty,
        amount: amountLamports,
      })

      alert('Позиция создана успешно!')
      navigate('/positions')
    } catch (error: any) {
      console.error('Error creating position:', error)
      alert(error.response?.data?.error || 'Ошибка при создании позиции')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="card">
        <h1 style={{ marginBottom: '24px', color: '#333' }}>Создать клиринговую позицию</h1>
        
        {!publicKey && (
          <div style={{ 
            padding: '16px', 
            background: '#fff3cd', 
            borderRadius: '8px', 
            marginBottom: '24px',
            color: '#856404'
          }}>
            Пожалуйста, подключите кошелек для создания позиции
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="label">
            Адрес контрагента (Pubkey)
          </label>
          <input
            type="text"
            className="input"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="Введите адрес Solana кошелька контрагента"
            required
          />

          <label className="label">
            Сумма (SOL)
          </label>
          <input
            type="number"
            step="0.000000001"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            required
            min="0"
          />

          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={loading || !publicKey}
            style={{ width: '100%' }}
          >
            {loading ? 'Создание...' : 'Создать позицию'}
          </button>
        </form>
      </div>
    </div>
  )
}




