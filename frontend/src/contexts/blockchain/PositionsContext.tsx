// contexts/blockchain/PositionsContext.tsx
import { createContext, useContext } from "react";
import { Obligation } from "../../interfaces";

export interface PositionsContextType {
	positions: Obligation[];
	loading: boolean;
	error: Error | null;
	reload: () => Promise<void>;
	clearCache: () => void;
}

export const PositionsContext = createContext<PositionsContextType | null>(null);

export const usePositions = () => {
	const ctx = useContext(PositionsContext);
	if (!ctx) {
		throw new Error("usePositions must be used inside PositionsProvider");
	}
	return ctx;
};
