import { PublicKey } from "@solana/web3.js";

export enum ObligationStatus {
	Created,
	Confirmed,
	Declined,
	Netted,
	Cancelled,
}

export interface Obligation {
	publicKey: string;
	status: ObligationStatus;
	from: PublicKey;
	to: PublicKey;
	amount: number;
	timestamp: number;
	sessionId: any;
	fromCancel: boolean;
	toCancel: boolean;
	poolId: number;
	bump: number;
}

export enum UserType {
	Guest = 'guest',
	Administator = 'admin',
	Counterparty = 'counterparty'
}

export interface Participant {
	pda: PublicKey,
	authority: PublicKey,
	userType: UserType,
	registrationTimestamp: number,
	updateTimestamp: number,
	lastSessionId: number,
	name: String,
	bump: number,
}

export interface SystemInfo {
	total_participants: number
	total_sessions: number
	total_obligations: number
	fee_rate_bps: string
}

export enum NetPositionStatus {
	None, // start: no fee payment
	FeePaid,
	Done, // means fee paid + creditor transfered net amount
}

export interface Bill {
	pda: PublicKey,
	status: NetPositionStatus,
	session_id: number,
	creditor: PublicKey,
	debitor: PublicKey,
	net_amount: number,
	fee_amount: number,
}

export function UserTypeToString(userType: UserType): String {
	switch (userType) {
		case UserType.Counterparty: return 'Контрагент';
		case UserType.Administator: return 'Администратор';
		case UserType.Guest: return 'Гость';
		default: return 'Неизвестно'
	}
}
