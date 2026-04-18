// providers/AppProviders.tsx
import { ReactNode } from 'react';
import { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { ParticipantProvider } from './ParticipantProvider';
import { ObligationsProvider } from './ObligationsProvider';
import { BillsProvider } from './BillsProvider';
import { ClearingSolana } from '../clearing_solana';

interface AppProvidersProps {
    children: ReactNode;
    program: Program<ClearingSolana>;
    publicKey: PublicKey | null;
}

export function AppProviders({ children, program, publicKey }: AppProvidersProps) {
    return (
        <ParticipantProvider program={program} publicKey={publicKey}>
            <ObligationsProvider program={program} publicKey={publicKey}>
                <BillsProvider program={program} publicKey={publicKey}>
                    {children}
                </BillsProvider>
            </ObligationsProvider>
        </ParticipantProvider>
    );
}
