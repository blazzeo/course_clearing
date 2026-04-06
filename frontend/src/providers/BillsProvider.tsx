// providers/SimplePositionsProvider.tsx
import { createContext, useContext, useState, ReactNode } from "react";
import { Bill } from "../interfaces";
import { getBillsByParticipant } from "../api";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../clearing_solana";
import { PublicKey } from "@solana/web3.js";

interface BillsContextType {
    bills: Bill[];
    isLoading: boolean;
    fetchBills: () => Promise<void>;
    refreshBills: () => void;
}

// Создаем контекст
const BillsContext = createContext<BillsContextType | null>(null);

interface BillsProviderProps {
    children: ReactNode;
    program: Program<ClearingSolana> | null;
    publicKey: PublicKey | null;
}

// Провайдер
export function BillsProvider({ children, program, publicKey }: BillsProviderProps) {
    const [bills, setBills] = useState<Bill[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Метод - получить данные
    const fetchBills = async () => {
        if (!program || !publicKey) return

        setIsLoading(true);
        try {
            const data = await getBillsByParticipant(program, publicKey)
            setBills(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    // Метод - обновить данные
    const refreshBills = async () => {
        await fetchBills()
    };

    return (
        <BillsContext.Provider value={{
            bills,
            isLoading,
            fetchBills,
            refreshBills,
        }}>
            {children}
        </BillsContext.Provider>
    );
}

// Хук для использования
export function useBills() {
    const context = useContext(BillsContext);
    if (!context) {
        throw new Error("useBills must be used inside BillsProvider");
    }
    return context;
}
