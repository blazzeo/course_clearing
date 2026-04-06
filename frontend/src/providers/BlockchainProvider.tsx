// providers/BlockchainProvider.tsx
import { ReactNode, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../clearing_solana";
import { BlockchainContext } from "../contexts/blockchain/BlockchainContext";
import { PositionsProvider } from "./PositionsProvider";
import { BillsProvider } from "./BillsProvider";
import { ParticipantsProvider } from "./ParticipantsProvider";

// Создаем QueryClient один раз вне компонента
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
			staleTime: 30 * 1000, // 30 секунд по умолчанию
		},
	},
});

interface BlockchainProviderProps {
	children: ReactNode;
	program: Program<ClearingSolana> | null;
	onError?: (error: Error) => void;
}

export const BlockchainProvider = ({
	children,
	program,
	onError
}: BlockchainProviderProps) => {
	const { publicKey } = useWallet();

	// Глобальная обработка ошибок
	useEffect(() => {
		if (onError) {
			// Можно добавить глобальный обработчик ошибок
			const handleError = (event: ErrorEvent) => {
				onError(event.error);
			};
			window.addEventListener('error', handleError);
			return () => window.removeEventListener('error', handleError);
		}
	}, [onError]);

	const value = {
		program,
		isReady: !!program,
		publicKey: publicKey || null,
		isConnected: !!publicKey && !!program,
	};

	return (
		<QueryClientProvider client={queryClient}>
			<BlockchainContext.Provider value={value}>
				<PositionsProvider>
					<BillsProvider>
						<ParticipantsProvider>
							{children}
						</ParticipantsProvider>
					</BillsProvider>
				</PositionsProvider>
			</BlockchainContext.Provider>
		</QueryClientProvider>
	);
};
