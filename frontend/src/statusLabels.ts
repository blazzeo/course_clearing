import { NetPositionStatus, ObligationStatus } from "./interfaces";

/** Статус обязательства (enum приложения) → русский ярлык для UI. */
export function obligationStatusToRu(status: ObligationStatus): string {
    switch (status) {
        case ObligationStatus.All:
            return "Все";
        case ObligationStatus.Created:
            return "Ожидает подтверждения";
        case ObligationStatus.Confirmed:
            return "Подтверждено";
        case ObligationStatus.PartiallyNetted:
            return "Частично погашено";
        case ObligationStatus.Declined:
            return "Отклонено";
        case ObligationStatus.Netted:
            return "Выполнено";
        case ObligationStatus.Cancelled:
            return "Отменено";
        default:
            return String(status);
    }
}

/**
 * Статус обязательства как строка (БД / API / audit): snake_case, camelCase, PascalCase → русский.
 */
export function obligationStatusFromApiToRu(raw: string | undefined | null): string {
    if (raw == null || raw.trim() === "") return "—";
    const normalized = raw
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/-/g, "_")
        .toLowerCase();

    const map: Record<string, ObligationStatus> = {
        created: ObligationStatus.Created,
        obligation_created: ObligationStatus.Created,
        confirmed: ObligationStatus.Confirmed,
        obligation_confirmed: ObligationStatus.Confirmed,
        partially_netted: ObligationStatus.PartiallyNetted,
        partiallynetted: ObligationStatus.PartiallyNetted,
        netted: ObligationStatus.Netted,
        declined: ObligationStatus.Declined,
        cancelled: ObligationStatus.Cancelled,
        canceled: ObligationStatus.Cancelled,
    };

    const asEnum = map[normalized];
    if (asEnum !== undefined) {
        return obligationStatusToRu(asEnum);
    }
    return raw.trim();
}

/** Статус сеттовой позиции / «счёта» (NetPosition на цепочке). */
export function billNetPositionStatusToRu(status: NetPositionStatus | number): string {
    const code = typeof status === "number" ? status : (status as number);
    switch (code) {
        case NetPositionStatus.None:
        case 0:
            return "Ожидает оплаты";
        case NetPositionStatus.FeePaid:
        case 1:
            return "Комиссия оплачена";
        case NetPositionStatus.Done:
        case 2:
            return "Погашено";
        default:
            return String(status);
    }
}
