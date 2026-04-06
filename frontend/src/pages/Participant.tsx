import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Participant, UserTypeToString } from '../interfaces'
import { getParticipant, getParticipantPda, useProgram } from '../api'
import { PublicKey } from '@solana/web3.js'

export default function ParticipantPage() {
    const { address } = useParams<{ address: string }>()
    const [participant, setParticipant] = useState<Participant | null>(null)
    const [loading, setLoading] = useState(true)

    const program = useProgram()

    useEffect(() => {
        if (address) {
            loadParticipant()
        }
    }, [address])

    const loadParticipant = async () => {
        if (!program || !address)
            return

        try {
            setLoading(true)

            const participantPubkey = new PublicKey(address)

            const pda = getParticipantPda(program.programId, participantPubkey)
            const participant = await getParticipant(program, pda)

            setParticipant(participant)

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
                <div style={{ marginBottom: '24px', color: '#333', display: 'flex', justifyContent: 'space-between' }}>
                    <h1>Информация об участнике</h1>
                    <p style={{
                        borderRadius: '8px',
                        fontSize: '30px',
                        color: '#667eea',
                        fontWeight: 'bold'
                    }}>
                        {UserTypeToString(participant.userType)}
                    </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label className="label">Адрес: </label>
                    <p style={{
                        padding: '12px',
                        background: '#f8f9fa',
                        fontSize: '20px',
                        fontWeight: 'bold',
                        borderRadius: '8px',
                        color: '#667eea',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all'
                    }}>
                        {participant.authority.toBase58()}
                    </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label className="label">Дата регистрации: </label>
                    <p style={{
                        padding: '12px',
                        background: '#f8f9fa',
                        borderRadius: '8px',
                        color: '#667eea',
                        fontWeight: 'bold'
                    }}>
                        {new Date(Number(participant.registrationTimestamp) * 1000).toLocaleString()}
                    </p>
                </div>


                <div style={{ marginBottom: '16px' }}>
                    <label className="label">Создано обязательств: </label>
                    <p style={{
                        padding: '12px',
                        background: '#f8f9fa',
                        borderRadius: '8px',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        color: '#667eea'
                    }}>
                        {participant.totalObligations | 0}
                    </p>
                </div>

            </div>
        </div>
    )
}
