import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

interface Position {
  id: number
  creator_address: string
  counterparty_address: string
  amount: number
  status: string
  created_at: string
  confirmed_at: string | null
  cleared_at: string | null
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api'

export default function Positions() {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    loadPositions()
  }, [filter])

  const loadPositions = async () => {
    try {
      setLoading(true)
      const url = filter !== 'all' 
        ? `${API_URL}/positions?status=${filter}`
        : `${API_URL}/positions`
      const response = await axios.get(url)
      if (response.data.success) {
        setPositions(response.data.data || [])
      }
    } catch (error) {
      console.error('Error loading positions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async (id: number) => {
    try {
      await axios.post(`${API_URL}/positions/${id}/confirm`)
      loadPositions()
    } catch (error) {
      console.error('Error confirming position:', error)
      alert('Ошибка при подтверждении позиции')
    }
  }

  const handleClear = async (id: number) => {
    try {
      await axios.post(`${API_URL}/positions/${id}/clear`)
      loadPositions()
    } catch (error) {
      console.error('Error clearing position:', error)
      alert('Ошибка при выполнении клиринга')
    }
  }

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'status-badge status-pending'
      case 'confirmed':
        return 'status-badge status-confirmed'
      case 'cleared':
        return 'status-badge status-cleared'
      default:
        return 'status-badge'
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('ru-RU')
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ color: '#333' }}>Клиринговые позиции</h1>
          <Link to="/positions/create" className="btn btn-primary">
            Создать позицию
          </Link>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="label">Фильтр по статусу:</label>
          <select 
            className="input" 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 'auto', display: 'inline-block', marginLeft: '8px' }}
          >
            <option value="all">Все</option>
            <option value="pending">Ожидают подтверждения</option>
            <option value="confirmed">Подтверждены</option>
            <option value="cleared">Выполнены</option>
          </select>
        </div>

        {loading ? (
          <p>Загрузка...</p>
        ) : positions.length === 0 ? (
          <p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
            Позиции не найдены
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Создатель</th>
                <th>Контрагент</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Создано</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id}>
                  <td>{position.id}</td>
                  <td>
                    <Link to={`/participant/${position.creator_address}`} style={{ color: '#667eea' }}>
                      {position.creator_address.slice(0, 8)}...
                    </Link>
                  </td>
                  <td>
                    <Link to={`/participant/${position.counterparty_address}`} style={{ color: '#667eea' }}>
                      {position.counterparty_address.slice(0, 8)}...
                    </Link>
                  </td>
                  <td>{position.amount / 1e9} SOL</td>
                  <td>
                    <span className={getStatusClass(position.status)}>
                      {position.status === 'pending' && 'Ожидает'}
                      {position.status === 'confirmed' && 'Подтверждена'}
                      {position.status === 'cleared' && 'Выполнена'}
                    </span>
                  </td>
                  <td>{formatDate(position.created_at)}</td>
                  <td>
                    {position.status === 'pending' && (
                      <button 
                        className="btn btn-primary" 
                        style={{ padding: '6px 12px', fontSize: '14px' }}
                        onClick={() => handleConfirm(position.id)}
                      >
                        Подтвердить
                      </button>
                    )}
                    {position.status === 'confirmed' && (
                      <button 
                        className="btn btn-primary" 
                        style={{ padding: '6px 12px', fontSize: '14px' }}
                        onClick={() => handleClear(position.id)}
                      >
                        Выполнить
                      </button>
                    )}
                    {position.status === 'cleared' && (
                      <span style={{ color: '#666' }}>Завершено</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}




