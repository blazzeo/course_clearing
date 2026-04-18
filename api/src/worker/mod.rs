//! Фоновый воркер клиринга и канал команд от HTTP / индексера.

mod clearing;

pub use clearing::{Worker, WorkerCommand, WorkerState};
