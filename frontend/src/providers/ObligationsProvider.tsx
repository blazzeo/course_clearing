// providers/SimplePositionsProvider.tsx
import { createContext, useContext, useState, ReactNode } from "react";
import { Obligation } from "../interfaces";
import { getObligationsByParticipant } from "../api";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../clearing_solana";
import { PublicKey } from "@solana/web3.js";

interface ObligationsContextType {
    obligations: Obligation[];
    isLoading: boolean;
    fetchObligations: () => Promise<void>;
    refreshObligations: () => void;
}

// Создаем контекст
const ObligationsContext = createContext<ObligationsContextType | null>(null);

interface ObligationsProviderProps {
    children: ReactNode;
    program: Program<ClearingSolana> | null;
    publicKey: PublicKey | null;
}

// Провайдер
export function ObligationsProvider({ children, program, publicKey }: ObligationsProviderProps) {
    const [obligations, setObligations] = useState<Obligation[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Метод - получить данные
    const fetchObligations = async () => {
        if (!program || !publicKey) return

        setIsLoading(true);
        try {
            const data = await getObligationsByParticipant(program, publicKey)
            setObligations(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    // Метод - обновить данные
    const refreshObligations = async () => {
        await fetchObligations()
    };

    return (
        <ObligationsContext.Provider value={{
            obligations,
            isLoading,
            fetchObligations,
            refreshObligations,
        }}>
            {children}
        </ObligationsContext.Provider>
    );
}

// Хук для использования
export function useObligations() {
    const context = useContext(ObligationsContext);
    if (!context) {
        throw new Error("useObligations must be used inside ObligationsProvider");
    }
    return context;
}
