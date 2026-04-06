import { ReactNode, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ParticipantsContext } from "../contexts/blockchain/ParticipantsContext";
import { useBlockchain } from "../contexts/blockchain/BlockchainContext";
import { getParticipant } from "../api";
import { Participant } from "../interfaces";

interface Props {
	children: ReactNode;
}

const QUERY_KEY = 'users';

export const ParticipantsProvider = ({ children }: Props) => {
	const { publicKey } = useWallet();
	const { program } = useBlockchain();
	const queryClient = useQueryClient();

	const {
		data: user = null,
		isLoading: loading,
		error,
		refetch,
	} = useQuery<Participant | null>({
		queryKey: [QUERY_KEY, publicKey?.toBase58()],
		queryFn: async () => {
			if (!publicKey || !program) return null;
			return getParticipant(program, publicKey);
		},
		enabled: !!publicKey && !!program,
		staleTime: 20 * 60 * 1000, // 20 минут
		gcTime: 30 * 60 * 1000,
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
		<ParticipantsContext.Provider value={{
			user,
			loading,
			error,
			reload,
			clearCache,
		}}>
			{children}
		</ParticipantsContext.Provider>
	);
};
