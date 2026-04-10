use crate::models::RawSettlement;
use solana_sdk::pubkey::Pubkey;

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
) -> Result<Vec<RawSettlement>, Box<dyn std::error::Error>> {
    // валидация входа
    if participants.len() != amounts.len() {
        return Err("participants and amounts length mismatch".into());
    }

    // соберём пары адрес/amount
    let mut entries: Vec<(Pubkey, i64)> = participants
        .iter()
        .cloned()
        .zip(amounts.iter().cloned())
        .collect();

    // фильтруем нулевые позиции (уже уравновешены)
    entries.retain(|(_, amt)| *amt != 0);

    // // проверим, что суммарно всё уравновешено (в идеале да).
    // let total: i128 = entries.iter().map(|(_, a)| *a as i128).sum();
    // if total != 0 {
    //     // если сумма != 0 — пока возвращаем ошибку, можно изменить поведение (например масштабировать или оставить остаток)
    //     return Err(format!("positions not balanced, total sum = {}", total).into());
    // }

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
        let transfer_u64: u64 = transfer.try_into().expect("transfer must be >= 0");

        // добавляем транзакцию: debtor -> creditor
        settlements.push(RawSettlement {
            from_address: *deb_addr,
            to_address: *cred_addr,
            amount: transfer_u64,
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

    creditors.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    debtors.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    Ok(settlements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn pk(s: &str) -> Pubkey {
        Pubkey::from_str(s).expect("invalid pubkey")
    }

    #[test]
    fn netting_returns_two_transfers_for_chain_case_5_3_2() {
        // user1 -> user2: 5
        // user2 -> user3: 3
        // user3 -> user1: 2
        // net:
        // user1 = -3, user2 = +2, user3 = +1
        // expected settlements:
        // user1 -> user2 : 2
        // user1 -> user3 : 1
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");

        let participants = vec![user1, user2, user3];
        let amounts = vec![-3, 2, 1];

        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(settlements.len(), 2);

        let mut u1_to_u2 = false;
        let mut u1_to_u3 = false;
        for s in settlements {
            if s.from_address == user1 && s.to_address == user2 && s.amount == 2 {
                u1_to_u2 = true;
            }
            if s.from_address == user1 && s.to_address == user3 && s.amount == 1 {
                u1_to_u3 = true;
            }
        }
        assert!(u1_to_u2 && u1_to_u3);
    }

    #[test]
    fn netting_rejects_participants_amounts_len_mismatch() {
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let participants = vec![user1, user2];
        let amounts = vec![10];
        assert!(netting_clearing(&participants, &amounts).is_err());
    }

    #[test]
    fn netting_ignores_zero_positions() {
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");

        let participants = vec![user1, user2, user3];
        let amounts = vec![-10, 10, 0];

        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(settlements.len(), 1);
        assert_eq!(settlements[0].from_address, user1);
        assert_eq!(settlements[0].to_address, user2);
        assert_eq!(settlements[0].amount, 10);
    }

    #[test]
    fn netting_full_netted_two_parties_single_transfer() {
        // full_netted:
        // user1 должен 5, user2 должен получить 5 => один полный перевод
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");

        let participants = vec![user1, user2];
        let amounts = vec![-5, 5];

        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(settlements.len(), 1);
        assert_eq!(settlements[0].from_address, user1);
        assert_eq!(settlements[0].to_address, user2);
        assert_eq!(settlements[0].amount, 5);
    }

    #[test]
    fn netting_partial_netted_one_debtor_to_two_creditors() {
        // partial_netted:
        // user1 должен 10, user2 получает 6, user3 получает 4
        // user1 должен отправить двумя транзакциями.
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");

        let participants = vec![user1, user2, user3];
        let amounts = vec![-10, 6, 4];

        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(settlements.len(), 2);

        let total_from_user1: u64 = settlements
            .iter()
            .filter(|s| s.from_address == user1)
            .map(|s| s.amount)
            .sum();
        assert_eq!(total_from_user1, 10);

        let paid_to_user2: u64 = settlements
            .iter()
            .filter(|s| s.to_address == user2)
            .map(|s| s.amount)
            .sum();
        let paid_to_user3: u64 = settlements
            .iter()
            .filter(|s| s.to_address == user3)
            .map(|s| s.amount)
            .sum();
        assert_eq!(paid_to_user2, 6);
        assert_eq!(paid_to_user3, 4);
    }

    #[test]
    fn netting_partial_netted_two_debtors_to_one_creditor() {
        // partial_netted:
        // user1 должен 7, user2 должен 3, user3 получает 10
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");

        let participants = vec![user1, user2, user3];
        let amounts = vec![-7, -3, 10];

        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(settlements.len(), 2);

        let total_to_user3: u64 = settlements
            .iter()
            .filter(|s| s.to_address == user3)
            .map(|s| s.amount)
            .sum();
        assert_eq!(total_to_user3, 10);

        let total_from_user1: u64 = settlements
            .iter()
            .filter(|s| s.from_address == user1)
            .map(|s| s.amount)
            .sum();
        let total_from_user2: u64 = settlements
            .iter()
            .filter(|s| s.from_address == user2)
            .map(|s| s.amount)
            .sum();
        assert_eq!(total_from_user1, 7);
        assert_eq!(total_from_user2, 3);
    }

    #[test]
    fn netting_all_zero_produces_no_settlements() {
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let participants = vec![user1, user2];
        let amounts = vec![0, 0];
        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert!(settlements.is_empty());
    }
}
