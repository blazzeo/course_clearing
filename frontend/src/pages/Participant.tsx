import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

interface ParticipantData {
  address: string
  balance: number
  margin: number
}

export default function Participant() {
  const { address } = useParams<{ address: string }>()
  const [participant, setParticipant] = useState<ParticipantData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (address) {
      loadParticipant()
    }
  }, [address])

  const loadParticipant = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`${API_URL}/participants/${address}/balance`)
      if (response.data.success) {
        setParticipant(response.data.data)
      }
    } catch (error) {
      console.error('Error loading participant:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="card">Загрузка...</div>
  }

  if (!participant) {
    return <div className="card">Участник не найден</div>
  }

  return (
    <div>
      <div className="card">
        <h1 style={{ marginBottom: '24px', color: '#333' }}>Информация об участнике</h1>
        
        <div style={{ marginBottom: '16px' }}>
          <label className="label">Адрес:</label>
          <p style={{ 
            padding: '12px', 
            background: '#f8f9fa', 
            borderRadius: '8px',
            fontFamily: 'monospace',
            wordBreak: 'break-all'
          }}>
            {participant.address}
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="label">Баланс:</label>
          <p style={{ 
            padding: '12px', 
            background: '#f8f9fa', 
            borderRadius: '8px',
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#667eea'
          }}>
            {participant.balance / 1e9} SOL
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="label">Залог (маржа):</label>
          <p style={{ 
            padding: '12px', 
            background: '#f8f9fa', 
            borderRadius: '8px',
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#764ba2'
          }}>
            {participant.margin / 1e9} SOL
          </p>
        </div>
      </div>
    </div>
  )
}




