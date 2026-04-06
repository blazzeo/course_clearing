// providers/PositionsProvider.tsx
import { ReactNode, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PositionsContext } from "../contexts/blockchain/PositionsContext";
import { useBlockchain } from "../contexts/blockchain/BlockchainContext";
import { getObligationsByParticipant } from "../api";
import { Obligation } from "../interfaces";

interface Props {
	children: ReactNode;
}

const QUERY_KEY = 'positions';

export const PositionsProvider = ({ children }: Props) => {
	const { publicKey } = useWallet();
	const { program } = useBlockchain();
	const queryClient = useQueryClient();

	const {
		data: positions = [],
		isLoading: loading,
		error,
		refetch,
	} = useQuery<Obligation[]>({
		queryKey: [QUERY_KEY, publicKey?.toBase58()],
		queryFn: async () => {
			if (!publicKey || !program) return [];
			const obligations = await getObligationsByParticipant(program, publicKey);
			// Преобразуем в нужный формат с publicKey
			return obligations.map(obs => ({
				...obs,
				publicKey: obs.publicKey?.toString(),
			}));
		},
		enabled: !!publicKey && !!program,
		staleTime: 5 * 60 * 1000, // 5 минут
		gcTime: 10 * 60 * 1000,
		retry: 1,
	});

	const reload = useCallback(async () => {
		await queryClient.invalidateQueries({
			queryKey: [QUERY_KEY, publicKey?.toBase58()]
		});
		await refetch();
	}, [queryClient, publicKey, refetch]);

	const clearCache = useCallback(() => {
		queryClient.removeQueries({
			queryKey: [QUERY_KEY, publicKey?.toBase58()]
		});
	}, [queryClient, publicKey]);

	// Очищаем при отключении кошелька
	useEffect(() => {
		if (!publicKey) {
			clearCache();
		}
	}, [publicKey, clearCache]);

	return (
		<PositionsContext.Provider value={{
			positions,
			loading,
			error,
			reload,
			clearCache,
		}}>
			{children}
		</PositionsContext.Provider>
	);
};
