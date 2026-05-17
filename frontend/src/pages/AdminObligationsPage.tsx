import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { getAllObligationsFromDb } from "../api";
import { Obligation, ObligationStatus } from "../interfaces";
import { API_URL } from "../main";
import { MapObligationStatus } from "./ObligationsPage";

function csvEscape(value: string | number | null | undefined): string {
	const s = value == null ? "" : String(value);
	return `"${s.replace(/"/g, "\"\"")}"`;
}

export default function AdminObligationsPage() {
	const [items, setItems] = useState<Obligation[]>([]);
	const [loading, setLoading] = useState(false);
	const [walletFilter, setWalletFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState<ObligationStatus>(ObligationStatus.All);
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [page, setPage] = useState(1);
	const PAGE_SIZE = 15;

	const load = async () => {
		try {
			setLoading(true);
			setItems(await getAllObligationsFromDb(API_URL));
		} catch (error) {
			console.error("Error loading all obligations:", error);
			toast.error("Не удалось загрузить обязательства");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, []);

	useEffect(() => {
		setPage(1);
	}, [walletFilter, statusFilter, dateFrom, dateTo]);

	const formatDate = (date: number | null) => {
		if (!date) return "-";
		const tsMs = date < 1_000_000_000_000 ? date * 1000 : date;
		return new Date(tsMs).toLocaleString("ru-RU");
	};

	const formatOperationalDay = (dayTs?: number) => {
		if (!dayTs) return "-";
		return new Date(dayTs * 1000).toLocaleDateString("ru-RU");
	};

	const getStatusClass = (status: ObligationStatus) => {
		switch (status) {
			case ObligationStatus.Created:
				return "status-badge status-pending";
			case ObligationStatus.Confirmed:
			case ObligationStatus.PartiallyNetted:
				return "status-badge status-confirmed";
			case ObligationStatus.Netted:
				return "status-badge status-cleared";
			default:
				return "status-badge";
		}
	};

	const filtered = useMemo(() => {
		const wallet = walletFilter.trim();
		const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() / 1000 : null;
		const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() / 1000 : null;
		return items.filter((o) => {
			if (statusFilter !== ObligationStatus.All && o.status !== statusFilter) return false;
			if (wallet) {
				const from = o.from.toBase58();
				const to = o.to.toBase58();
				if (!from.includes(wallet) && !to.includes(wallet)) return false;
			}
			if (fromTs && o.timestamp < fromTs) return false;
			if (toTs && o.timestamp > toTs) return false;
			return true;
		});
	}, [items, walletFilter, statusFilter, dateFrom, dateTo]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const pageSafe = Math.min(page, totalPages);
	const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

	const exportCsv = () => {
		const headers = [
			"pda",
			"from",
			"to",
			"status",
			"remaining_amount_lamports",
			"original_amount_lamports",
			"created_at_unix",
		];
		const rows = filtered.map((o) => [
			o.pda.toBase58(),
			o.from.toBase58(),
			o.to.toBase58(),
			MapObligationStatus(o.status),
			o.amount,
			o.originalAmount ?? "",
			o.timestamp,
		]);
		const csv = [headers, ...rows]
			.map((row) => row.map((x) => csvEscape(x as string | number | null | undefined)).join(","))
			.join("\n");
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `admin_obligations_${Date.now()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const hint: CSSProperties = {
		fontSize: "12px",
		color: "#64748b",
		marginTop: "8px",
		marginBottom: 0,
		lineHeight: 1.45,
	};

	const fieldInput: CSSProperties = {
		width: "100%",
		boxSizing: "border-box",
	};

	return (
		<div className="card">
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					alignItems: "flex-start",
					justifyContent: "space-between",
					gap: "12px",
					marginBottom: "18px",
				}}
			>
				<h1 style={{ margin: 0, color: "#1e293b" }}>Все обязательства</h1>
				<div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
					<button className="btn btn-primary" onClick={load} disabled={loading}>
						{loading ? "Обновление..." : "Обновить список"}
					</button>
					<button className="btn btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
						Экспорт CSV
					</button>
				</div>
			</div>

			<section
				style={{
					border: "1px solid #e2e8f0",
					borderRadius: "10px",
					padding: "16px 18px 18px",
					background: "#f8fafc",
					marginBottom: "18px",
				}}
				aria-labelledby="admin-oblig-filters-heading"
			>
				<h2 id="admin-oblig-filters-heading" style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0", color: "#0f172a" }}>
					Фильтры
				</h2>
				<p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 18px 0", lineHeight: 1.5 }}>
					Данные из базы индексатора. Условия суммируются: в списке остаются только те позиции, которые подходят <strong>по всем</strong> выбранным критериям сразу.
				</p>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
						gap: "18px 22px",
						alignItems: "start",
					}}
				>
					<div>
						<label htmlFor="admin-obl-wallet" className="label" style={{ marginBottom: "6px" }}>
							Участник
						</label>
						<input
							id="admin-obl-wallet"
							className="input"
							placeholder="Фрагмент адреса кошелька"
							autoComplete="off"
							value={walletFilter}
							onChange={(e) => setWalletFilter(e.target.value)}
							style={fieldInput}
						/>
						<p style={hint}>Совпадение с адресом дебитора или кредитора. Пусто — все участники.</p>
					</div>

					<div>
						<label htmlFor="admin-obl-status" className="label" style={{ marginBottom: "6px" }}>
							Статус в базе
						</label>
						<select
							id="admin-obl-status"
							className="input"
							value={statusFilter}
							onChange={(e) => setStatusFilter(Number(e.target.value))}
							style={fieldInput}
						>
							<option value={ObligationStatus.All}>Любой</option>
							<option value={ObligationStatus.Created}>Ожидает подтверждения</option>
							<option value={ObligationStatus.Confirmed}>Подтверждено</option>
							<option value={ObligationStatus.PartiallyNetted}>Частично погашено</option>
							<option value={ObligationStatus.Netted}>Выполнено</option>
							<option value={ObligationStatus.Declined}>Отклонено</option>
							<option value={ObligationStatus.Cancelled}>Отменено</option>
						</select>
						<p style={hint}>Как сохранено индексатором после событий по цепочке.</p>
					</div>

					<div>
						<span className="label" style={{ marginBottom: "8px", display: "block" }}>
							Период по дате появления в БД
						</span>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: "10px",
							}}
						>
							<div>
								<label htmlFor="admin-obl-df" style={{ ...hint, marginBottom: "6px", marginTop: 0, fontWeight: 600, color: "#475569" }}>
									Начало
								</label>
								<input
									id="admin-obl-df"
									type="date"
									className="input"
									value={dateFrom}
									onChange={(e) => setDateFrom(e.target.value)}
									style={fieldInput}
								/>
							</div>
							<div>
								<label htmlFor="admin-obl-dt" style={{ ...hint, marginBottom: "6px", marginTop: 0, fontWeight: 600, color: "#475569" }}>
									Конец
								</label>
								<input
									id="admin-obl-dt"
									type="date"
									className="input"
									value={dateTo}
									onChange={(e) => setDateTo(e.target.value)}
									style={fieldInput}
								/>
							</div>
						</div>
						<p style={hint}>Границы включительно, в локальном времени браузера. Пустое поле — без ограничения с этой стороны.</p>
					</div>
				</div>

				{!loading && items.length > 0 && (
					<div
						style={{
							marginTop: "16px",
							paddingTop: "14px",
							borderTop: "1px solid #e2e8f0",
							fontSize: "13px",
							color: "#334155",
						}}
					>
						Совпало с условиями: <strong>{filtered.length}</strong> из {items.length}
						{filtered.length === items.length ? " (все записи из базы)." : "."}
					</div>
				)}
			</section>

			{loading ? (
				<p style={{ color: "#666" }}>Загрузка...</p>
			) : filtered.length === 0 ? (
				<p style={{ color: "#666", textAlign: "center", padding: "24px" }}>Ничего не подошло под фильтры или список пуст</p>
			) : (
				<>
					<table className="table">
						<thead>
							<tr>
								<th>Дебитор</th>
								<th>Кредитор</th>
								<th>Сумма (остаток / номинал)</th>
								<th>Статус</th>
								<th>Создано</th>
								<th>Опер. день расчета</th>
							</tr>
						</thead>
						<tbody>
							{pageItems.map((o) => (
								<tr key={o.pda.toBase58()}>
									<td><Link to={`/participant/${o.from.toBase58()}`}>{o.from.toBase58().slice(0, 8)}...</Link></td>
									<td><Link to={`/participant/${o.to.toBase58()}`}>{o.to.toBase58().slice(0, 8)}...</Link></td>
									<td>
										{(o.amount / 1e9).toFixed(4)}
										{o.originalAmount != null ? ` / ${(o.originalAmount / 1e9).toFixed(4)}` : ""}
										{" "}SOL
									</td>
									<td><span className={getStatusClass(o.status)}>{MapObligationStatus(o.status)}</span></td>
									<td>{formatDate(o.timestamp)}</td>
									<td>{formatOperationalDay(o.expectingOperationalDay)}</td>
								</tr>
							))}
						</tbody>
					</table>
					<div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", marginTop: "10px" }}>
						<button className="btn btn-secondary" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Назад</button>
						<span style={{ color: "#666", fontSize: "14px" }}>Стр. {pageSafe} / {totalPages}</span>
						<button className="btn btn-secondary" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Вперед</button>
					</div>
				</>
			)}
		</div>
	);
}
