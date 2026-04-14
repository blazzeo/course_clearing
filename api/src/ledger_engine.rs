use crate::models::RawSettlement;
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeMap;

/// Неттинг по схеме **pure_expense_glade** (итеративный глейд с минимальной издержкой на шаге):
/// на каждой итерации выбирается пара (дебитор, кредитор) с минимальным `cost(from,to)`,
/// переносится `min(остаток_дебитора, остаток_кредитора)`, остатки уменьшаются до нуля.
///
/// Вход:
/// - `participants` и `amounts` одинаковой длины;
/// - `amounts[i] > 0` — участник **кредитор** (должен получить нетто);
/// - `amounts[i] < 0` — участник **дебитор** (должен заплатить нетто).
///
/// Рёбра итоговой матрицы погашения **сливаются** по паре `(from, to)` для компактного плана.
pub fn netting_clearing(
    participants: &[Pubkey],
    amounts: &[i64],
) -> Result<Vec<RawSettlement>, Box<dyn std::error::Error>> {
    netting_clearing_with_cost(participants, amounts, |_from, _to| 1i128)
}

/// То же, что [`netting_clearing`], но с произвольной матрицей издержек `C[from][to]`.
pub fn netting_clearing_with_cost(
    participants: &[Pubkey],
    amounts: &[i64],
    cost: impl Fn(Pubkey, Pubkey) -> i128,
) -> Result<Vec<RawSettlement>, Box<dyn std::error::Error>> {
    if participants.len() != amounts.len() {
        return Err("participants and amounts length mismatch".into());
    }

    let mut debit_remaining: BTreeMap<Pubkey, i64> = BTreeMap::new();
    let mut credit_remaining: BTreeMap<Pubkey, i64> = BTreeMap::new();

    for (p, &amt) in participants.iter().zip(amounts.iter()) {
        if amt > 0 {
            credit_remaining.insert(*p, amt);
        } else if amt < 0 {
            debit_remaining.insert(*p, -amt);
        }
    }

    let mut settlements: Vec<RawSettlement> = Vec::new();

    loop {
        let mut best: Option<(i128, [u8; 32], [u8; 32], Pubkey, Pubkey)> = None;

        for (&d, &rd) in &debit_remaining {
            if rd <= 0 {
                continue;
            }
            for (&c, &rc) in &credit_remaining {
                if rc <= 0 {
                    continue;
                }
                let unit_cost = cost(d, c);
                let cand = (unit_cost, d.to_bytes(), c.to_bytes(), d, c);
                match &best {
                    None => best = Some(cand),
                    Some(b) if cand < *b => best = Some(cand),
                    _ => {}
                }
            }
        }

        let Some((_cost, _db, _cb, d, c)) = best else {
            break;
        };

        let rd = *debit_remaining.get(&d).unwrap_or(&0);
        let rc = *credit_remaining.get(&c).unwrap_or(&0);
        if rd <= 0 || rc <= 0 {
            break;
        }

        let transfer = std::cmp::min(rd, rc);
        let transfer_u64: u64 = transfer.try_into().map_err(|_| "transfer overflow")?;

        settlements.push(RawSettlement {
            from_address: d,
            to_address: c,
            amount: transfer_u64,
        });

        debit_remaining.insert(d, rd - transfer);
        credit_remaining.insert(c, rc - transfer);
        if debit_remaining[&d] <= 0 {
            debit_remaining.remove(&d);
        }
        if credit_remaining[&c] <= 0 {
            credit_remaining.remove(&c);
        }
    }

    Ok(merge_settlements(settlements))
}

fn merge_settlements(items: Vec<RawSettlement>) -> Vec<RawSettlement> {
    let mut acc: BTreeMap<(Pubkey, Pubkey), u64> = BTreeMap::new();
    for s in items {
        *acc.entry((s.from_address, s.to_address)).or_insert(0) += s.amount;
    }
    acc.into_iter()
        .map(|((from_address, to_address), amount)| RawSettlement {
            from_address,
            to_address,
            amount,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::str::FromStr;

    fn pk(s: &str) -> Pubkey {
        Pubkey::from_str(s).expect("invalid pubkey")
    }

    fn assert_conservation(participants: &[Pubkey], amounts: &[i64], settlements: &[RawSettlement]) {
        let mut delta: HashMap<Pubkey, i128> = HashMap::new();
        for (p, a) in participants.iter().zip(amounts.iter()) {
            delta.insert(*p, *a as i128);
        }
        for s in settlements {
            *delta.entry(s.from_address).or_insert(0) += s.amount as i128;
            *delta.entry(s.to_address).or_insert(0) -= s.amount as i128;
        }
        assert!(delta.values().all(|v| *v == 0), "non-zero residuals: {delta:?}");
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

    #[test]
    fn netting_cycle_equal_amounts_results_in_no_transfers() {
        // user1 -> user2 5, user2 -> user3 5, user3 -> user1 5
        // net vector == [0,0,0], settlements must be empty
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");
        let participants = vec![user1, user2, user3];
        let amounts = vec![0, 0, 0];
        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert!(settlements.is_empty());
    }

    #[test]
    fn netting_is_deterministic_for_same_input() {
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");
        let user4 = pk("Stake11111111111111111111111111111111111111");
        let participants = vec![user1, user2, user3, user4];
        let amounts = vec![-12, 7, 3, 2];
        let s1 = netting_clearing(&participants, &amounts).expect("netting failed");
        let s2 = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(s1.len(), s2.len());
        for (a, b) in s1.iter().zip(s2.iter()) {
            assert_eq!(a.from_address, b.from_address);
            assert_eq!(a.to_address, b.to_address);
            assert_eq!(a.amount, b.amount);
        }
    }

    #[test]
    fn netting_preserves_global_balance_invariants() {
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");
        let user4 = pk("Stake11111111111111111111111111111111111111");
        let participants = vec![user1, user2, user3, user4];
        let amounts = vec![-11, -4, 8, 7];
        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_conservation(&participants, &amounts, &settlements);
    }

    /// Нетто после цепочки обязательств 6+1−2 (как в статье Новиковой/Смеловой): u1: −7, u2: +4, u3: +3.
    /// Оптимальный план погашения — два перевода от u1 суммарно 7 (4 к u2 и 3 к u3 или в обратном порядке).
    #[test]
    fn netting_novikova_style_three_party_net_vector() {
        let user1 = pk("11111111111111111111111111111111");
        let user2 = pk("So11111111111111111111111111111111111111112");
        let user3 = pk("Sysvar1111111111111111111111111111111111111");
        let participants = vec![user1, user2, user3];
        let amounts = vec![-7, 4, 3];

        let settlements = netting_clearing(&participants, &amounts).expect("netting failed");
        assert_eq!(settlements.len(), 2);
        assert_conservation(&participants, &amounts, &settlements);

        let mut to_u2 = 0u64;
        let mut to_u3 = 0u64;
        for s in &settlements {
            assert_eq!(s.from_address, user1);
            if s.to_address == user2 {
                to_u2 += s.amount;
            } else if s.to_address == user3 {
                to_u3 += s.amount;
            } else {
                panic!("unexpected edge {:?}", s);
            }
        }
        assert_eq!(to_u2 + to_u3, 7);
        assert_eq!(to_u2, 4);
        assert_eq!(to_u3, 3);
    }
}
