import { createContext, useContext } from "react";

type PositionsContextType = {
    positions: any[];
    loading: boolean;
    reload: () => Promise<void>;
};

export const PositionsContext = createContext<PositionsContextType | null>(null);

export const usePositions = () => {
    const ctx = useContext(PositionsContext);
    if (!ctx) {
        throw new Error("usePositions must be used inside PositionsProvider");
    }
    return ctx;
};
