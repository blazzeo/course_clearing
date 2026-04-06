// contexts/blockchain/BillsContext.tsx
import { createContext, useContext } from "react";
import { Bill } from "../../interfaces";

export interface BillsContextType {
	bills: Bill[];
	loading: boolean;
	error: Error | null;
	reload: () => Promise<void>;
	clearCache: () => void;
}

export const BillsContext = createContext<BillsContextType | null>(null);

export const useBills = () => {
	const ctx = useContext(BillsContext);
	if (!ctx) {
		throw new Error("useBills must be used inside BillsProvider");
	}
	return ctx;
};
