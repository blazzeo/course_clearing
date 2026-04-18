use solana_sdk::pubkey::Pubkey;

#[derive(Clone, Copy)]
pub struct ObligationEdge {
    pub pda: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

#[derive(Clone, Copy)]
pub struct ExternalSettlement {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

#[derive(Clone, Copy)]
pub struct InternalNetting {
    pub obligation: Pubkey,
    pub amount: u64,
    /// Merkle/on-chain internal: встречное A↔B + снятие циклов + MCMF по остатку.
    pub flow_used: u64,
    pub edge_used_in_flow: bool,
    pub edge_used_in_cycle: bool,
}

pub struct FlowSolveResult {
    pub external_settlements: Vec<ExternalSettlement>,
    pub internal_nettings: Vec<InternalNetting>,
    pub total_cost: i128,
    pub unmet_demand: u64,
    pub total_flow: u64,
    pub total_positive_net: u64,
    pub objective: &'static str,
}

// Flow/capacity type (signed to support residual graph operations).
pub(super) type F = i128;
// Cost type (integer to avoid floating-point instability).
pub(super) type W = i128;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Q {
    pub u: usize,
    pub c: F,
    pub w: W,
}

impl PartialOrd for Q {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Q {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // reverse for min-heap behavior on BinaryHeap
        other
            .w
            .cmp(&self.w)
            .then_with(|| other.u.cmp(&self.u))
            .then_with(|| other.c.cmp(&self.c))
    }
}

#[derive(Clone, Copy)]
pub(super) struct Edge {
    // constant
    pub v: usize,
    pub r: usize,
    pub cap: F,
    pub cost: W,
    // variable
    pub f: F,
}

impl Edge {
    fn new(v: usize, r: usize, cap: F, cost: W) -> Self {
        Self {
            v,
            r,
            cap,
            cost,
            f: 0,
        }
    }
}

pub(super) struct FlowGraph {
    pub(super) edges: Vec<Vec<Edge>>,
}

impl FlowGraph {
    pub(super) fn new(n: usize) -> Self {
        Self {
            edges: (0..n).map(|_| vec![]).collect(),
        }
    }

    pub(super) fn add_arc(&mut self, u: usize, v: usize, c: F, cost: W) {
        let rev_idx_on_v = self.edges[v].len();
        self.edges[u].push(Edge::new(v, rev_idx_on_v, c, cost));

        let rev_idx_on_u = self.edges[u].len() - 1;
        self.edges[v].push(Edge::new(u, rev_idx_on_u, 0, -cost));
    }
}
