import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

export default function MultiPartyClearing() {
  const navigate = useNavigate()
  const [participants, setParticipants] = useState<string[]>(['', ''])
  const [amounts, setAmounts] = useState<string[]>(['0', '0'])
  const [loading, setLoading] = useState(false)

  const addParticipant = () => {
    setParticipants([...participants, ''])
    setAmounts([...amounts, '0'])
  }

  const removeParticipant = (index: number) => {
    if (participants.length > 2) {
      setParticipants(participants.filter((_, i) => i !== index))
      setAmounts(amounts.filter((_, i) => i !== index))
    }
  }

  const updateParticipant = (index: number, value: string) => {
    const newParticipants = [...participants]
    newParticipants[index] = value
    setParticipants(newParticipants)
  }

  const updateAmount = (index: number, value: string) => {
    const newAmounts = [...amounts]
    newAmounts[index] = value
    setAmounts(newAmounts)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (participants.length < 2) {
      alert('Необходимо минимум 2 участника')
      return
    }

    if (participants.some(p => !p.trim())) {
      alert('Заполните все адреса участников')
      return
    }

    try {
      setLoading(true)
      const amountsLamports = amounts.map(a => parseFloat(a) * 1e9)

      const response = await axios.post(`${API_URL}/clearing/multi-party`, {
        participants: participants.filter(p => p.trim()),
        amounts: amountsLamports,
      })

      if (response.data.success) {
        alert('Многосторонний клиринг создан успешно!')
        navigate('/positions')
      }
    } catch (error: any) {
      console.error('Error creating multi-party clearing:', error)
      alert(error.response?.data?.error || 'Ошибка при создании многостороннего клиринга')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="card">
        <h1 style={{ marginBottom: '24px', color: '#333' }}>Многосторонний клиринг</h1>
        
        <p style={{ color: '#666', marginBottom: '24px' }}>
          Создайте клиринговую операцию для нескольких участников. 
          Система автоматически рассчитает чистые позиции (netting).
        </p>

        <form onSubmit={handleSubmit}>
          {participants.map((participant, index) => (
            <div key={index} style={{ 
              marginBottom: '24px', 
              padding: '16px', 
              background: '#f8f9fa', 
              borderRadius: '8px' 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ color: '#333' }}>Участник {index + 1}</h3>
                {participants.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeParticipant(index)}
                    style={{
                      padding: '6px 12px',
                      background: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    Удалить
                  </button>
                )}
              </div>
              
              <label className="label">Адрес участника</label>
              <input
                type="text"
                className="input"
                value={participant}
                onChange={(e) => updateParticipant(index, e.target.value)}
                placeholder="Введите адрес Solana кошелька"
                required
              />

              <label className="label">Сумма (SOL)</label>
              <input
                type="number"
                step="0.000000001"
                className="input"
                value={amounts[index]}
                onChange={(e) => updateAmount(index, e.target.value)}
                placeholder="0.0"
                required
                min="0"
              />
            </div>
          ))}

          <button
            type="button"
            onClick={addParticipant}
            className="btn btn-secondary"
            style={{ marginBottom: '16px' }}
          >
            Добавить участника
          </button>

          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Создание...' : 'Создать многосторонний клиринг'}
          </button>
        </form>
      </div>
    </div>
  )
}




