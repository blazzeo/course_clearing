import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div>
      <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
        <h1 style={{ fontSize: '48px', marginBottom: '24px', color: '#333' }}>
          Клиринговый сервис на блокчейне
        </h1>
        <p style={{ fontSize: '20px', color: '#666', marginBottom: '32px' }}>
          Децентрализованный сервис для клиринговых расчетов на Solana
        </p>
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
          <Link to="/positions/create" className="btn btn-primary">
            Создать позицию
          </Link>
          <Link to="/positions" className="btn btn-secondary">
            Просмотр позиций
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginTop: '32px' }}>
        <div className="card">
          <h2 style={{ marginBottom: '16px', color: '#333' }}>Двусторонний клиринг</h2>
          <p style={{ color: '#666', marginBottom: '16px' }}>
            Создавайте клиринговые позиции между двумя участниками. 
            Позиции требуют подтверждения от контрагента перед выполнением расчета.
          </p>
          <Link to="/positions/create" className="btn btn-primary" style={{ width: '100%' }}>
            Создать позицию
          </Link>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '16px', color: '#333' }}>Многосторонний клиринг</h2>
          <p style={{ color: '#666', marginBottom: '16px' }}>
            Выполняйте netting для нескольких участников одновременно. 
            Система автоматически рассчитывает чистые позиции.
          </p>
          <Link to="/clearing/multi-party" className="btn btn-primary" style={{ width: '100%' }}>
            Многосторонний клиринг
          </Link>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '16px', color: '#333' }}>Управление залогами</h2>
          <p style={{ color: '#666', marginBottom: '16px' }}>
            Вносите и выводите залоги (маржу) для обеспечения клиринговых операций. 
            Все операции записываются в блокчейн.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '32px' }}>
        <h2 style={{ marginBottom: '16px', color: '#333' }}>Как это работает</h2>
        <ol style={{ paddingLeft: '24px', color: '#666', lineHeight: '1.8' }}>
          <li style={{ marginBottom: '12px' }}>
            <strong>Подключите кошелек:</strong> Используйте Phantom или Solflare для подключения к сервису
          </li>
          <li style={{ marginBottom: '12px' }}>
            <strong>Создайте позицию:</strong> Укажите контрагента и сумму для клиринга
          </li>
          <li style={{ marginBottom: '12px' }}>
            <strong>Подтверждение:</strong> Контрагент подтверждает позицию
          </li>
          <li style={{ marginBottom: '12px' }}>
            <strong>Выполнение:</strong> Система автоматически выполняет расчет и обновляет балансы
          </li>
        </ol>
      </div>
    </div>
  )
}




