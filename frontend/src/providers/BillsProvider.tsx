// providers/BillsProvider.tsx
import { ReactNode, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BillsContext } from "../contexts/blockchain/BillsContext";
import { useBlockchain } from "../contexts/blockchain/BlockchainContext";
import { getBillsByParticipant } from "../api";
import { Bill } from "../interfaces";

interface Props {
	children: ReactNode;
}

const QUERY_KEY = 'bills';

export const BillsProvider = ({ children }: Props) => {
	const { publicKey } = useWallet();
	const { program } = useBlockchain();
	const queryClient = useQueryClient();

	const {
		data: bills = [],
		isLoading: loading,
		error,
		refetch,
	} = useQuery<Bill[]>({
		queryKey: [QUERY_KEY, publicKey?.toBase58()],
		queryFn: async () => {
			if (!publicKey || !program) return [];
			return getBillsByParticipant(program, publicKey);
		},
		enabled: !!publicKey && !!program,
		staleTime: 3 * 60 * 1000, // 3 минуты
		gcTime: 10 * 60 * 1000,
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

	useEffect(() => {
		if (!publicKey) {
			clearCache();
		}
	}, [publicKey, clearCache]);

	return (
		<BillsContext.Provider value={{
			bills,
			loading,
			error,
			reload,
			clearCache,
		}}>
			{children}
		</BillsContext.Provider>
	);
};
