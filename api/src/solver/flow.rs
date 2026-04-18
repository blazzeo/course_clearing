//! Min-cost flow и неттинг обязательств.

use clearing_solana::Obligation;
use solana_sdk::pubkey::Pubkey;
use std::collections::{BTreeMap, BinaryHeap, HashMap};

use super::models::{
    ExternalSettlement, FlowGraph, FlowSolveResult, InternalNetting, ObligationEdge, F, Q, W,
};

const FINF: F = i128::MAX / 4;
const WINF: W = i128::MAX / 4;
const ZERO: W = 0;

struct Mcmf<'g> {
    g: &'g mut FlowGraph,
    n: usize,
    s: usize,
    t: usize,
    pot: Vec<W>,
}

impl<'g> Mcmf<'g> {
    fn new(g: &'g mut FlowGraph, s: usize, t: usize) -> Self {
        let n = g.edges.len();
        Self {
            g,
            n,
            s,
            t,
            pot: vec![WINF; n],
        }
    }

    fn run(&mut self) -> (F, W) {
        let Self { g, n, s, t, pot } = self;
        let n = *n;
        let s = *s;
        let t = *t;

        let mut maxflow: F = 0;
        let mut cost: W = ZERO;
        pot[s] = ZERO;

        // Bellman-Ford initial potentials.
        for _ in 0..n.saturating_sub(1) {
            let mut relax = false;
            for u in 0..n {
                if pot[u] == WINF {
                    continue;
                }
                for e in &g.edges[u] {
                    if e.cap > e.f && pot[u].saturating_add(e.cost) < pot[e.v] {
                        pot[e.v] = pot[u].saturating_add(e.cost);
                        relax = true;
                    }
                }
            }
            if !relax {
                break;
            }
        }
        for p in pot.iter_mut() {
            if *p == WINF {
                *p = ZERO;
            }
        }

        let mut q = BinaryHeap::new();
        let mut parent: Vec<Option<(usize, usize)>> = vec![None; n];
        let mut dist = vec![WINF; n];

        loop {
            q.clear();
            parent.fill(None);
            dist.fill(WINF);

            q.push(Q {
                u: s,
                c: FINF,
                w: ZERO,
            });
            dist[s] = ZERO;

            let mut tf: F = -1;

            while let Some(Q { u, c, w }) = q.pop() {
                if w != dist[u] {
                    continue;
                }
                if u == t && tf < 0 {
                    tf = c;
                }

                for (nbi, e) in g.edges[u].iter().enumerate() {
                    if e.cap <= e.f {
                        continue;
                    }
                    let reduced = w
                        .saturating_add(e.cost)
                        .saturating_add(pot[u])
                        .saturating_sub(pot[e.v]);
                    if reduced < dist[e.v] {
                        dist[e.v] = reduced;
                        q.push(Q {
                            u: e.v,
                            c: c.min(e.cap - e.f),
                            w: reduced,
                        });
                        parent[e.v] = Some((u, nbi));
                    }
                }
            }

            if parent[t].is_none() {
                return (maxflow, cost);
            }

            let f = tf;
            maxflow = maxflow.saturating_add(f);

            let mut it = parent[t];
            while let Some((u, nbi)) = it {
                let e = &mut g.edges[u][nbi];
                e.f = e.f.saturating_add(f);
                let ev = e.v;
                let er = e.r;
                let ecost = e.cost;
                let r = &mut g.edges[ev][er];
                cost = cost.saturating_add(f.saturating_mul(ecost));
                r.f = r.f.saturating_sub(f);
                it = parent[r.v];
            }

            for u in 0..n {
                if dist[u] != WINF {
                    pot[u] = pot[u].saturating_add(dist[u]);
                }
            }
            if f <= 0 {
                return (maxflow, cost);
            }
        }
    }
}

/// Взаимное погашение встречных рёбер A→B и B→A до построения MCMF.
/// Возвращает сумму по каждому PDA обязательства, которую нужно применить как internal
/// (учитывается в `flow_used` вместе с потоком MCMF по остаточному графу).
fn bilateral_offset_by_pda(obligations: &[(Pubkey, Obligation)]) -> HashMap<Pubkey, u64> {
    type Directed = (Pubkey, Pubkey);
    let mut by_dir: BTreeMap<Directed, Vec<(Pubkey, u64)>> = BTreeMap::new();
    for (pda, o) in obligations {
        let from = Pubkey::new_from_array(o.from.to_bytes());
        let to = Pubkey::new_from_array(o.to.to_bytes());
        by_dir.entry((from, to)).or_default().push((*pda, o.amount));
    }
    for v in by_dir.values_mut() {
        v.sort_by(|a, b| a.0.to_bytes().cmp(&b.0.to_bytes()));
    }

    let mut out: HashMap<Pubkey, u64> = HashMap::new();
    for (&(from, to), list_ab) in &by_dir {
        if from.to_bytes() >= to.to_bytes() {
            continue;
        }
        let Some(list_ba) = by_dir.get(&(to, from)) else {
            continue;
        };
        let mut ab: Vec<(Pubkey, u64)> = list_ab.clone();
        let mut ba: Vec<(Pubkey, u64)> = list_ba.clone();
        let mut i = 0usize;
        let mut j = 0usize;
        while i < ab.len() && j < ba.len() {
            let take = ab[i].1.min(ba[j].1);
            if take > 0 {
                *out.entry(ab[i].0).or_insert(0) += take;
                *out.entry(ba[j].0).or_insert(0) += take;
                ab[i].1 -= take;
                ba[j].1 -= take;
            }
            if ab[i].1 == 0 {
                i += 1;
            }
            if ba[j].1 == 0 {
                j += 1;
            }
        }
    }
    out
}

fn obligation_with_amount(o: &Obligation, amount: u64) -> Obligation {
    Obligation {
        status: o.status,
        from: o.from,
        to: o.to,
        amount,
        timestamp: o.timestamp,
        expecting_operational_day: o.expecting_operational_day,
        session_id: o.session_id,
        from_cancel: o.from_cancel,
        to_cancel: o.to_cancel,
        pool_id: o.pool_id,
        bump: o.bump,
    }
}

fn apply_pda_offsets(
    obligations: &[(Pubkey, Obligation)],
    offsets: &HashMap<Pubkey, u64>,
) -> Option<Vec<(Pubkey, Obligation)>> {
    let mut reduced = Vec::with_capacity(obligations.len());
    for (pda, o) in obligations {
        let off = offsets.get(pda).copied().unwrap_or(0);
        let amount = o.amount.checked_sub(off)?;
        if amount == 0 {
            continue;
        }
        reduced.push((*pda, obligation_with_amount(o, amount)));
    }
    Some(reduced)
}

fn sorted_edges(obligations: &[(Pubkey, Obligation)]) -> Vec<ObligationEdge> {
    let mut edges: Vec<ObligationEdge> = obligations
        .iter()
        .map(|(pda, o)| ObligationEdge {
            pda: *pda,
            from: Pubkey::new_from_array(o.from.to_bytes()),
            to: Pubkey::new_from_array(o.to.to_bytes()),
            amount: o.amount,
        })
        .collect();
    edges.sort_by(|a, b| {
        a.from
            .to_bytes()
            .cmp(&b.from.to_bytes())
            .then_with(|| a.to.to_bytes().cmp(&b.to.to_bytes()))
            .then_with(|| a.pda.to_bytes().cmp(&b.pda.to_bytes()))
    });
    edges
}

fn allocate_pair_reduction_by_pda(
    edges: &[ObligationEdge],
    participant_index: &BTreeMap<Pubkey, usize>,
    reduced_on_pair: &BTreeMap<(usize, usize), u64>,
) -> Option<HashMap<Pubkey, u64>> {
    let mut left_by_pair = reduced_on_pair.clone();
    let mut per_pda = HashMap::<Pubkey, u64>::new();
    for edge in edges {
        let from_idx = *participant_index.get(&edge.from)?;
        let to_idx = *participant_index.get(&edge.to)?;
        let key = (from_idx, to_idx);
        let left = left_by_pair.get(&key).copied().unwrap_or(0);
        if left == 0 {
            continue;
        }
        let take = left.min(edge.amount);
        if take > 0 {
            *per_pda.entry(edge.pda).or_insert(0) += take;
            if take == left {
                left_by_pair.remove(&key);
            } else {
                left_by_pair.insert(key, left - take);
            }
        }
    }
    if left_by_pair.values().any(|v| *v > 0) {
        return None;
    }
    Some(per_pda)
}

fn eliminate_cycles(
    pairs: &mut BTreeMap<(usize, usize), u64>,
    participant_count: usize,
) -> BTreeMap<(usize, usize), u64> {
    let mut reduced_on_pair: BTreeMap<(usize, usize), u64> = BTreeMap::new();
    let mut guard = 0usize;
    loop {
        guard += 1;
        if guard
            > participant_count
                .saturating_mul(participant_count)
                .saturating_add(1)
        {
            break;
        }
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); participant_count];
        for ((u, v), amount) in pairs.iter() {
            if *amount > 0 {
                adj[*u].push(*v);
            }
        }
        for neighbors in &mut adj {
            neighbors.sort_unstable();
        }

        let mut state = vec![0u8; participant_count];
        let mut parent: Vec<Option<usize>> = vec![None; participant_count];
        let mut cycle: Vec<(usize, usize)> = Vec::new();

        fn dfs(
            u: usize,
            adj: &[Vec<usize>],
            state: &mut [u8],
            parent: &mut [Option<usize>],
            cycle: &mut Vec<(usize, usize)>,
        ) -> bool {
            state[u] = 1;
            for &v in &adj[u] {
                if state[v] == 0 {
                    parent[v] = Some(u);
                    if dfs(v, adj, state, parent, cycle) {
                        return true;
                    }
                } else if state[v] == 1 {
                    cycle.push((u, v));
                    let mut cur = u;
                    while cur != v {
                        let p = parent[cur].expect("parent for cycle vertex");
                        cycle.push((p, cur));
                        cur = p;
                    }
                    cycle.reverse();
                    return true;
                }
            }
            state[u] = 2;
            false
        }

        let mut found = false;
        for start in 0..participant_count {
            if state[start] == 0 && dfs(start, &adj, &mut state, &mut parent, &mut cycle) {
                found = true;
                break;
            }
        }
        if !found {
            break;
        }
        let min_in_cycle = cycle
            .iter()
            .filter_map(|e| pairs.get(e))
            .copied()
            .min()
            .unwrap_or(0);
        if min_in_cycle == 0 {
            break;
        }
        for edge in cycle {
            if let Some(v) = pairs.get_mut(&edge) {
                *v -= min_in_cycle;
            }
            *reduced_on_pair.entry(edge).or_insert(0) += min_in_cycle;
        }
        pairs.retain(|_, v| *v > 0);
    }
    reduced_on_pair
}

fn build_external_settlements_from_net(
    net: &[i128],
    participants: &[Pubkey],
) -> Option<Vec<ExternalSettlement>> {
    let mut debtors: Vec<(usize, u64)> = net
        .iter()
        .enumerate()
        .filter_map(|(idx, value)| {
            if *value < 0 {
                let amount: u64 = (-*value).try_into().ok()?;
                Some((idx, amount))
            } else {
                None
            }
        })
        .collect();
    let mut creditors: Vec<(usize, u64)> = net
        .iter()
        .enumerate()
        .filter_map(|(idx, value)| {
            if *value > 0 {
                let amount: u64 = (*value).try_into().ok()?;
                Some((idx, amount))
            } else {
                None
            }
        })
        .collect();

    debtors.sort_by_key(|(idx, _)| participants[*idx].to_bytes());
    creditors.sort_by_key(|(idx, _)| participants[*idx].to_bytes());

    let mut i = 0usize;
    let mut j = 0usize;
    let mut settlements = Vec::<ExternalSettlement>::new();

    while i < debtors.len() && j < creditors.len() {
        let (d_idx, d_left) = debtors[i];
        let (c_idx, c_left) = creditors[j];
        let amount = d_left.min(c_left);
        if amount > 0 {
            settlements.push(ExternalSettlement {
                from: participants[d_idx],
                to: participants[c_idx],
                amount,
            });
        }

        debtors[i].1 -= amount;
        creditors[j].1 -= amount;

        if debtors[i].1 == 0 {
            i += 1;
        }
        if creditors[j].1 == 0 {
            j += 1;
        }
    }

    if i != debtors.len() || j != creditors.len() {
        return None;
    }

    settlements.sort_by(|a, b| {
        a.from
            .to_bytes()
            .cmp(&b.from.to_bytes())
            .then_with(|| a.to.to_bytes().cmp(&b.to.to_bytes()))
            .then_with(|| a.amount.cmp(&b.amount))
    });
    Some(settlements)
}

pub fn solve_min_cost_flow(obligations: &[(Pubkey, Obligation)]) -> Option<FlowSolveResult> {
    let edges_orig = sorted_edges(obligations);
    if edges_orig.is_empty() {
        return Some(FlowSolveResult {
            external_settlements: vec![],
            internal_nettings: vec![],
            total_cost: 0,
            unmet_demand: 0,
            total_flow: 0,
            total_positive_net: 0,
            objective: "lexicographic",
        });
    }

    let bilateral = bilateral_offset_by_pda(obligations);

    let mut participants: Vec<Pubkey> = edges_orig.iter().flat_map(|e| [e.from, e.to]).collect();
    participants.sort_by_key(|p| p.to_bytes());
    participants.dedup();
    let participant_index: BTreeMap<Pubkey, usize> = participants
        .iter()
        .enumerate()
        .map(|(idx, p)| (*p, idx))
        .collect();

    let mut net = vec![0i128; participants.len()];
    for e in &edges_orig {
        let from_idx = *participant_index.get(&e.from)?;
        let to_idx = *participant_index.get(&e.to)?;
        let amount_i = i128::from(e.amount);
        net[from_idx] -= amount_i;
        net[to_idx] += amount_i;
    }

    let node_count = participants.len() + 2;
    let source = participants.len();
    let sink = participants.len() + 1;
    let mut total_positive_net: u64 = 0;
    for value in &net {
        if *value > 0 {
            total_positive_net = total_positive_net.checked_add((*value).try_into().ok()?)?;
        }
    }

    let reduced_after_bilateral = apply_pda_offsets(obligations, &bilateral)?;
    let edges_after_bilateral = sorted_edges(&reduced_after_bilateral);
    let mut pair_caps = BTreeMap::<(usize, usize), u64>::new();
    for edge in &edges_after_bilateral {
        let from_idx = *participant_index.get(&edge.from)?;
        let to_idx = *participant_index.get(&edge.to)?;
        *pair_caps.entry((from_idx, to_idx)).or_insert(0) += edge.amount;
    }
    let reduced_by_cycle_pairs = eliminate_cycles(&mut pair_caps, participants.len());
    let cycle_by_pda = allocate_pair_reduction_by_pda(
        &edges_after_bilateral,
        &participant_index,
        &reduced_by_cycle_pairs,
    )?;
    let reduced_after_cycle = apply_pda_offsets(&reduced_after_bilateral, &cycle_by_pda)?;
    let edges_for_mcmf = sorted_edges(&reduced_after_cycle);

    let (total_flow, total_cost, unmet_demand, mcmf_by_pda): (
        u64,
        i128,
        u64,
        HashMap<Pubkey, u64>,
    ) = if edges_for_mcmf.is_empty() {
        (0, 0, total_positive_net, HashMap::new())
    } else {
        let mut graph = FlowGraph::new(node_count);
        for (idx, value) in net.iter().enumerate() {
            if *value < 0 {
                graph.add_arc(source, idx, -*value, 0);
            } else if *value > 0 {
                graph.add_arc(idx, sink, *value, 0);
            }
        }

        let e_count = edges_for_mcmf.len() as i128;
        let v_count = participants.len() as i128;
        let base_cost = e_count
            .checked_mul(v_count + 1)
            .and_then(|v| v.checked_add(1))
            .unwrap_or(1);

        let mut obligation_arc_positions: Vec<(Pubkey, usize, usize)> =
            Vec::with_capacity(edges_for_mcmf.len());
        for e in &edges_for_mcmf {
            let from_idx = *participant_index.get(&e.from)?;
            let to_idx = *participant_index.get(&e.to)?;
            let epsilon = obligation_arc_positions.len() as W;
            let cost = base_cost + epsilon;
            let pos = graph.edges[from_idx].len();
            graph.add_arc(from_idx, to_idx, F::from(e.amount), cost);
            obligation_arc_positions.push((e.pda, from_idx, pos));
        }
        let (total_flow_raw, total_cost_raw) = Mcmf::new(&mut graph, source, sink).run();
        let total_flow: u64 = total_flow_raw.try_into().ok()?;
        let total_cost: i128 = total_cost_raw;

        let mut mcmf_by_pda: HashMap<Pubkey, u64> = HashMap::new();
        for (pda, from_idx, pos) in obligation_arc_positions {
            let e = graph.edges[from_idx][pos];
            let used: u64 = e.f.try_into().ok()?;
            if used == 0 {
                continue;
            }
            *mcmf_by_pda.entry(pda).or_insert(0) += used;
        }
        let unmet_demand = total_positive_net.saturating_sub(total_flow);
        (total_flow, total_cost, unmet_demand, mcmf_by_pda)
    };

    let external_settlements = build_external_settlements_from_net(&net, &participants)?;

    let mut internal_nettings = Vec::<InternalNetting>::new();
    for edge in &edges_orig {
        let b = bilateral.get(&edge.pda).copied().unwrap_or(0);
        let c = cycle_by_pda.get(&edge.pda).copied().unwrap_or(0);
        let m = mcmf_by_pda.get(&edge.pda).copied().unwrap_or(0);
        let flow_used_total = b.checked_add(c)?.checked_add(m)?;
        if flow_used_total > edge.amount {
            return None;
        }
        let residual = edge.amount.saturating_sub(flow_used_total);
        internal_nettings.push(InternalNetting {
            obligation: edge.pda,
            amount: residual,
            flow_used: flow_used_total,
            edge_used_in_flow: m > 0,
            edge_used_in_cycle: c > 0,
        });
    }
    internal_nettings.sort_by(|a, b| a.obligation.to_bytes().cmp(&b.obligation.to_bytes()));

    Some(FlowSolveResult {
        external_settlements,
        internal_nettings,
        total_cost,
        unmet_demand,
        total_flow,
        total_positive_net,
        objective: "lexicographic",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use clearing_solana::ObligationStatus;
    use std::str::FromStr;

    fn ob(from: Pubkey, to: Pubkey, amount: u64) -> Obligation {
        Obligation {
            status: ObligationStatus::Confirmed,
            from: anchor_lang::prelude::Pubkey::new_from_array(from.to_bytes()),
            to: anchor_lang::prelude::Pubkey::new_from_array(to.to_bytes()),
            amount,
            timestamp: 0,
            expecting_operational_day: 0,
            session_id: None,
            from_cancel: false,
            to_cancel: false,
            pool_id: 0,
            bump: 0,
        }
    }

    #[test]
    fn deterministic_for_same_input() {
        let a = Pubkey::from_str("11111111111111111111111111111111").expect("pk");
        let b = Pubkey::from_str("So11111111111111111111111111111111111111112").expect("pk");
        let c = Pubkey::from_str("Sysvar1111111111111111111111111111111111111").expect("pk");
        let p1 = Pubkey::from_str("Stake11111111111111111111111111111111111111").expect("pk");
        let p2 = Pubkey::from_str("Vote111111111111111111111111111111111111111").expect("pk");
        let p3 = Pubkey::from_str("Config1111111111111111111111111111111111111").expect("pk");
        let obligations = vec![(p1, ob(a, b, 7)), (p2, ob(b, c, 5)), (p3, ob(c, a, 4))];
        let r1 = solve_min_cost_flow(&obligations).expect("solve");
        let r2 = solve_min_cost_flow(&obligations).expect("solve");
        assert_eq!(r1.total_flow, r2.total_flow);
        assert_eq!(r1.unmet_demand, r2.unmet_demand);
        assert_eq!(r1.external_settlements.len(), r2.external_settlements.len());
        assert_eq!(r1.internal_nettings.len(), r2.internal_nettings.len());
    }

    #[test]
    fn collapses_transitive_chain_into_single_payment() {
        let a = Pubkey::from_str("11111111111111111111111111111111").expect("pk");
        let b = Pubkey::from_str("So11111111111111111111111111111111111111112").expect("pk");
        let c = Pubkey::from_str("Sysvar1111111111111111111111111111111111111").expect("pk");
        let p1 = Pubkey::from_str("Stake11111111111111111111111111111111111111").expect("pk");
        let p2 = Pubkey::from_str("Vote111111111111111111111111111111111111111").expect("pk");
        let obligations = vec![(p1, ob(a, b, 3)), (p2, ob(b, c, 3))];

        let result = solve_min_cost_flow(&obligations).expect("solve");

        assert_eq!(result.external_settlements.len(), 1);
        let payment = result.external_settlements[0];
        assert_eq!(payment.from, a);
        assert_eq!(payment.to, c);
        assert_eq!(payment.amount, 3);
    }

    #[test]
    fn pure_cycle_produces_internal_leaves_and_no_external() {
        let a = Pubkey::from_str("11111111111111111111111111111111").expect("pk");
        let b = Pubkey::from_str("So11111111111111111111111111111111111111112").expect("pk");
        let c = Pubkey::from_str("Sysvar1111111111111111111111111111111111111").expect("pk");
        let p_ab = Pubkey::from_str("Stake11111111111111111111111111111111111111").expect("pk");
        let p_bc = Pubkey::from_str("Vote111111111111111111111111111111111111111").expect("pk");
        let p_ca = Pubkey::from_str("Config1111111111111111111111111111111111111").expect("pk");
        let obligations = vec![
            (p_ab, ob(a, b, 1)),
            (p_bc, ob(b, c, 1)),
            (p_ca, ob(c, a, 1)),
        ];

        let result = solve_min_cost_flow(&obligations).expect("solve");
        assert!(result.external_settlements.is_empty());
        assert_eq!(result.total_positive_net, 0);
        assert_eq!(result.total_flow, 0);

        let mut by_pda: HashMap<Pubkey, (u64, bool)> = HashMap::new();
        for n in &result.internal_nettings {
            by_pda.insert(n.obligation, (n.flow_used, n.edge_used_in_cycle));
            assert_eq!(n.amount, 0);
        }
        assert_eq!(by_pda.get(&p_ab).copied(), Some((1, true)));
        assert_eq!(by_pda.get(&p_bc).copied(), Some((1, true)));
        assert_eq!(by_pda.get(&p_ca).copied(), Some((1, true)));
    }

    /// A→B 4 и B→A 2: встречное погашение 2 до MCMF, затем внешний платёж A→B 2;
    /// оба обязательства получают ненулевой `flow_used` (merkle / on-chain internal).
    #[test]
    fn bilateral_pair_offsets_before_mcmf() {
        let a = Pubkey::from_str("11111111111111111111111111111111").expect("pk");
        let b = Pubkey::from_str("So11111111111111111111111111111111111111112").expect("pk");
        let p_ab = Pubkey::from_str("Stake11111111111111111111111111111111111111").expect("pk");
        let p_ba = Pubkey::from_str("Vote111111111111111111111111111111111111111").expect("pk");
        let obligations = vec![(p_ab, ob(a, b, 4)), (p_ba, ob(b, a, 2))];

        let result = solve_min_cost_flow(&obligations).expect("solve");

        assert_eq!(result.external_settlements.len(), 1);
        assert_eq!(result.external_settlements[0].from, a);
        assert_eq!(result.external_settlements[0].to, b);
        assert_eq!(result.external_settlements[0].amount, 2);

        let mut by_pda: HashMap<Pubkey, u64> = HashMap::new();
        for n in &result.internal_nettings {
            by_pda.insert(n.obligation, n.flow_used);
        }
        assert_eq!(by_pda.get(&p_ab).copied(), Some(4));
        assert_eq!(by_pda.get(&p_ba).copied(), Some(2));
    }
}
