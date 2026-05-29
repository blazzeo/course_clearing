// providers/SimplePositionsProvider.tsx
import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { Bill } from "../interfaces";
import { getBillsAsCreditorByParticipant, getBillsByParticipant } from "../api";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../clearing_solana";
import { PublicKey } from "@solana/web3.js";

interface BillsContextType {
    /** Позиции, где текущий кошелёк — должник (сам должен оплатить). */
    billsOwedByMe: Bill[];
    /** Позиции, где текущий кошелёк — кредитор (ему должны). */
    billsOwedToMe: Bill[];
    isLoading: boolean;
    fetchBills: (opts?: { force?: boolean }) => Promise<void>;
    refreshBills: () => Promise<void>;
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
    const [billsOwedByMe, setBillsOwedByMe] = useState<Bill[]>([]);
    const [billsOwedToMe, setBillsOwedToMe] = useState<Bill[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const inFlightRef = useRef<Promise<void> | null>(null);
    const lastFetchAtRef = useRef<number>(0);
    const CACHE_TTL_MS = 5000;

    // Метод - получить данные
    const fetchBills = useCallback(async (opts?: { force?: boolean }) => {
        if (!program || !publicKey) return
        const now = Date.now();
        if (inFlightRef.current) {
            await inFlightRef.current;
            return;
        }
        const totalCount = billsOwedByMe.length + billsOwedToMe.length;
        if (!opts?.force && totalCount > 0 && now - lastFetchAtRef.current < CACHE_TTL_MS) {
            return;
        }

        const task = (async () => {
            setIsLoading(true);
            try {
                const [owedByMe, owedToMe] = await Promise.all([
                    getBillsByParticipant(program, publicKey),
                    getBillsAsCreditorByParticipant(program, publicKey),
                ]);
                setBillsOwedByMe(owedByMe);
                setBillsOwedToMe(owedToMe);
                lastFetchAtRef.current = Date.now();
            } catch (error) {
                console.error(error);
            } finally {
                setIsLoading(false);
            }
        })();
        inFlightRef.current = task;
        try {
            await task;
        } finally {
            inFlightRef.current = null;
        }
    }, [program, publicKey, billsOwedByMe.length, billsOwedToMe.length]);

    // Метод - обновить данные
    const refreshBills = fetchBills;

    return (
        <BillsContext.Provider value={{
            billsOwedByMe,
            billsOwedToMe,
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
