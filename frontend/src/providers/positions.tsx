import { useState, useCallback, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getObligationsByParticipant } from "../api";
import { PositionsContext } from "../contexts/positions";

type Props = {
    children: ReactNode;
    program: any; // типизируешь позже
};

export const PositionsProvider = ({ children, program }: Props) => {
    const { publicKey } = useWallet();

    const [positions, setPositions] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const loadPositions = useCallback(async () => {
        if (!publicKey || !program) return;

        try {
            setLoading(true);

            const obligations = await getObligationsByParticipant(
                program,
                publicKey
            );

            setPositions(obligations);
        } catch (error) {
            console.error("Error loading positions:", error);
        } finally {
            setLoading(false);
        }
    }, [publicKey, program]);

    return (
        <PositionsContext.Provider
            value={{
                positions,
                loading,
                reload: loadPositions,
            }}
        >
            {children}
        </PositionsContext.Provider>
    );
};
