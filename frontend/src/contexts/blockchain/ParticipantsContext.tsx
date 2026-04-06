// contexts/blockchain/UsersContext.tsx
import { createContext, useContext } from "react";
import { Participant } from "../../interfaces";

export interface ParticipantsContextType {
	user: Participant | null;
	loading: boolean;
	error: Error | null;
	reload: () => Promise<void>;
	clearCache: () => void;
}

export const ParticipantsContext = createContext<ParticipantsContextType | null>(null);

export const useParticipants = () => {
	const ctx = useContext(ParticipantsContext);
	if (!ctx) {
		throw new Error("useParticipants must be used inside ParticipantsProvider");
	}
	return ctx;
};
