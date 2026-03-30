import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Participant } from '../interfaces'
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
                        {participant.authority.toBase58()}
                    </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label className="label">Зарегистрирован с:</label>
                    <p style={{
                        padding: '12px',
                        background: '#f8f9fa',
                        borderRadius: '8px',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        color: '#667eea'
                    }}>
                        {participant.registrationTimestamp}
                    </p>
                </div>

            </div>
        </div>
    )
}
