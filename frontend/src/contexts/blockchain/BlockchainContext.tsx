// contexts/blockchain/BlockchainContext.tsx
import { createContext, useContext } from "react";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../../clearing_solana";

export interface BlockchainContextType {
	program: Program<ClearingSolana> | null;
	isReady: boolean;
}

export const BlockchainContext = createContext<BlockchainContextType | null>(null);

export const useBlockchain = () => {
	const ctx = useContext(BlockchainContext);
	if (!ctx) {
		throw new Error("useBlockchain must be used inside BlockchainProvider");
	}
	return ctx;
};
