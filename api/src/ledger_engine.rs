use anchor_lang::prelude::Pubkey;

use crate::models::{ApiResponse, RawSettlement};

/// Основная функция неттинга.
///
/// - `participants` и `amounts` должны иметь одинаковую длину.
/// - Положительные amounts => участник должен получить деньги (creditor).
/// - Отрицательные amounts => участник должен заплатить (debtor).
///
/// Возвращает список переводов (from -> to : amount).
pub fn netting_clearing(
    participants: &[Pubkey],
    amounts: &[i64],
) -> ApiResponse<Vec<RawSettlement>> {
    // валидация входа
    if participants.len() != amounts.len() {
        return ApiResponse::error("participants and amounts length mismatch".into());
    }

    // соберём пары адрес/amount
    let mut entries: Vec<(Pubkey, i64)> = participants
        .iter()
        .cloned()
        .zip(amounts.iter().cloned())
        .collect();

    // фильтруем нулевые позиции (уже уравновешены)
    entries.retain(|(_, amt)| *amt != 0);

    // проверим, что суммарно всё уравновешено (в идеале да).
    let total: i128 = entries.iter().map(|(_, a)| *a as i128).sum();
    if total != 0 {
        // если сумма != 0 — пока возвращаем ошибку, можно изменить поведение (например масштабировать или оставить остаток)
        return ApiResponse::error(format!("positions not balanced, total sum = {}", total));
    }

    // создадим списки кредиторов и должников
    // кредитор: amt > 0 (получает), должник: amt < 0 (платит)
    let mut creditors: Vec<(Pubkey, i64)> = entries
        .iter()
        .filter(|(_, amt)| *amt > 0)
        .map(|(a, amt)| (a.clone(), *amt))
        .collect();

    let mut debtors: Vec<(Pubkey, i64)> = entries
        .iter()
        .filter(|(_, amt)| *amt < 0)
        .map(|(a, amt)| (a.clone(), -*amt)) // хранить положительную величину долга
        .collect();

    // сортируем кредиторов по убыванию (большие сначала), должников — по убыванию (большие должники сначала)
    creditors.sort_by(|a, b| b.1.cmp(&a.1));
    debtors.sort_by(|a, b| b.1.cmp(&a.1));

    let mut settlements: Vec<RawSettlement> = Vec::new();

    // индексные итераторы для обоих списков
    let mut ci = 0usize;
    let mut di = 0usize;

    while ci < creditors.len() && di < debtors.len() {
        let (cred_addr, cred_amt) = &creditors[ci];
        let (deb_addr, deb_amt) = &debtors[di];

        let transfer = std::cmp::min(*cred_amt, *deb_amt);

        // добавляем транзакцию: debtor -> creditor
        settlements.push(RawSettlement {
            from_address: deb_addr.to_string(),
            to_address: cred_addr.to_string(),
            amount: transfer,
        });

        // уменьшаем остатки
        creditors[ci].1 -= transfer;
        debtors[di].1 -= transfer;

        // если один из них обнуляется — продвигаем индекс
        if creditors[ci].1 == 0 {
            ci += 1;
        }
        if debtors[di].1 == 0 {
            di += 1;
        }
    }

    ApiResponse::success(settlements)
}
