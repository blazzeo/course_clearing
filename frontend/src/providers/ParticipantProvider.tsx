// providers/SimplePositionsProvider.tsx
import { createContext, useContext, useState, ReactNode } from "react";
import { Participant } from "../interfaces";
import { getParticipant } from "../api";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../clearing_solana";
import { PublicKey } from "@solana/web3.js";

interface ParticipantContextType {
    participant: Participant | null;
    isLoading: boolean;
    fetchParticipant: () => Promise<void>;
    refreshParticipant: () => void;
}

// Создаем контекст
const ParticipantsContext = createContext<ParticipantContextType | null>(null);

interface ParticipantProviderProps {
    children: ReactNode;
    program: Program<ClearingSolana> | null;
    publicKey: PublicKey | null;
}

// Провайдер
export function ParticipantProvider({ children, program, publicKey }: ParticipantProviderProps) {
    const [participant, setParticipant] = useState<Participant | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Метод - получить данные
    const fetchParticipant = async () => {
        if (!program || !publicKey) return

        setIsLoading(true);
        try {
            const data = await getParticipant(program, publicKey)
            setParticipant(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    // Метод - обновить данные
    const refreshParticipant = async () => {
        await fetchParticipant()
    };

    return (
        <ParticipantsContext.Provider value={{
            participant,
            isLoading,
            fetchParticipant,
            refreshParticipant,
        }}>
            {children}
        </ParticipantsContext.Provider>
    );
}

// Хук для использования
export function useParticipants() {
    const context = useContext(ParticipantsContext);
    if (!context) {
        throw new Error("useParticipants must be used inside ParticipantsProvider");
    }
    return context;
}
