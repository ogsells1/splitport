"use client";

import { useVaultEvents, VaultEvent, TxType } from "@/lib/events";
import { useState } from "react";

const EXPLORER_BASE = "https://testnet.arcscan.app/tx/";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TYPE_META: Record<
  TxType,
  { label: string; dot: string; rowBg: string; badge: string }
> = {
  deposit: {
    label: "Deposit",
    dot: "bg-emerald-400",
    rowBg: "hover:bg-emerald-950/30",
    badge: "bg-emerald-900/60 text-emerald-300 border border-emerald-700/50",
  },
  payment: {
    label: "Payment",
    dot: "bg-violet-400",
    rowBg: "hover:bg-violet-950/30",
    badge: "bg-violet-900/60 text-violet-300 border border-violet-700/50",
  },
  distribution: {
    label: "Distribution",
    dot: "bg-amber-400",
    rowBg: "hover:bg-amber-950/30",
    badge: "bg-amber-900/60 text-amber-300 border border-amber-700/50",
  },
};

function EventRow({ ev }: { ev: VaultEvent }) {
  const meta = TYPE_META[ev.type];
  return (
    <tr className={`border-b border-white/5 transition-colors ${meta.rowBg}`}>
      {/* Type */}
      <td className="py-3 pl-6 pr-4">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </td>

      {/* Amount */}
      <td className="py-3 px-4 text-right font-mono font-semibold text-white tabular-nums">
        <span className="text-white/40 text-xs mr-1">USDC</span>
        {parseFloat(ev.amountFormatted).toFixed(2)}
      </td>

      {/* Detail */}
      <td className="py-3 px-4 text-sm text-white/50 font-mono">
        {ev.type === "deposit" && ev.from && (
          <span title={ev.from}>{shortAddr(ev.from)}</span>
        )}
        {ev.type === "payment" && ev.wallet && (
          <span>
            <span title={ev.wallet}>{shortAddr(ev.wallet)}</span>
            {ev.role && (
              <span className="ml-2 text-white/30 text-xs">[{ev.role}]</span>
            )}
          </span>
        )}
        {ev.type === "distribution" && (
          <span className="text-white/30">
            {ev.contributorCount} recipient{ev.contributorCount !== 1 ? "s" : ""}
          </span>
        )}
      </td>

      {/* Date */}
      <td className="py-3 px-4 text-xs text-white/30 whitespace-nowrap">
        {formatDate(ev.timestamp)}
      </td>

      {/* Tx */}
      <td className="py-3 pl-4 pr-6 text-right">
        {ev.txHash ? (
          <a
            href={`${EXPLORER_BASE}${ev.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-white/30 hover:text-white/70 transition-colors font-mono"
            title={ev.txHash}
          >
            {ev.txHash.slice(0, 8)}…
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="opacity-60"
            >
              <path
                d="M1.5 8.5L8.5 1.5M8.5 1.5H3.5M8.5 1.5V6.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        ) : (
          <span className="text-white/20 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

function EventCard({ ev }: { ev: VaultEvent }) {
  const meta = TYPE_META[ev.type];
  return (
    <div className="px-4 py-3 border-b border-white/5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        <span className="font-mono font-semibold text-white tabular-nums text-sm">
          <span className="text-white/40 text-xs mr-1">USDC</span>
          {parseFloat(ev.amountFormatted).toFixed(2)}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/50 font-mono">
        <span className="truncate">
          {ev.type === "deposit" && ev.from && (
            <span title={ev.from}>{shortAddr(ev.from)}</span>
          )}
          {ev.type === "payment" && ev.wallet && (
            <>
              <span title={ev.wallet}>{shortAddr(ev.wallet)}</span>
              {ev.role && (
                <span className="ml-2 text-white/30">[{ev.role}]</span>
              )}
            </>
          )}
          {ev.type === "distribution" && (
            <span className="text-white/30">
              {ev.contributorCount} recipient{ev.contributorCount !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span className="text-white/30 whitespace-nowrap flex-shrink-0">
          {formatDate(ev.timestamp)}
        </span>
      </div>

      {ev.txHash && (
        <a
          href={`${EXPLORER_BASE}${ev.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-white/30 hover:text-white/70 transition-colors font-mono"
          title={ev.txHash}
        >
          {ev.txHash.slice(0, 10)}…
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-60">
            <path
              d="M1.5 8.5L8.5 1.5M8.5 1.5H3.5M8.5 1.5V6.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <tr>
      <td colSpan={5} className="py-20 text-center">
        <div className="flex flex-col items-center gap-3 text-white/20">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            className="opacity-30"
          >
            <rect
              x="6"
              y="10"
              width="28"
              height="22"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M6 16h28"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M13 24h4M13 28h8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-sm">No transactions yet</span>
        </div>
      </td>
    </tr>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-white/5 animate-pulse">
          <td className="py-3 pl-6 pr-4">
            <div className="h-5 w-20 rounded-full bg-white/5" />
          </td>
          <td className="py-3 px-4">
            <div className="h-4 w-16 rounded bg-white/5 ml-auto" />
          </td>
          <td className="py-3 px-4">
            <div className="h-4 w-24 rounded bg-white/5" />
          </td>
          <td className="py-3 px-4">
            <div className="h-4 w-28 rounded bg-white/5" />
          </td>
          <td className="py-3 pl-4 pr-6">
            <div className="h-4 w-16 rounded bg-white/5 ml-auto" />
          </td>
        </tr>
      ))}
    </>
  );
}

function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-white/5 last:border-b-0 animate-pulse">
          <div className="flex items-center justify-between gap-2">
            <div className="h-5 w-20 rounded-full bg-white/5" />
            <div className="h-4 w-16 rounded bg-white/5" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="h-3 w-24 rounded bg-white/5" />
            <div className="h-3 w-20 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyStateMobile() {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-white/20">
      <svg width="36" height="36" viewBox="0 0 40 40" fill="none" className="opacity-30">
        <rect x="6" y="10" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 16h28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M13 24h4M13 28h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="text-sm">No transactions yet</span>
    </div>
  );
}

const FILTERS: { key: TxType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "deposit", label: "Deposits" },
  { key: "payment", label: "Payments" },
  { key: "distribution", label: "Distributions" },
];

export default function HistoryPage() {
  const { events, loading, error } = useVaultEvents();
  const [filter, setFilter] = useState<TxType | "all">("all");

  const filtered =
    filter === "all" ? events : events.filter((e) => e.type === filter);

  // Aggregate stats
  const totalDeposited = events
    .filter((e) => e.type === "deposit")
    .reduce((s, e) => s + e.amount, 0n);
  const totalPaid = events
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + e.amount, 0n);
  const distCount = events.filter((e) => e.type === "distribution").length;

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Subtle grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8 sm:mb-10">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors mb-6"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M7.5 9L4.5 6L7.5 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Dashboard
          </a>

          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Transaction History
          </h1>
          <p className="mt-1.5 text-sm text-white/40">
            All on-chain events from the SplitVault contract
          </p>
        </div>

        {/* Stats row */}
        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
            {[
              {
                label: "Total Deposited",
                value: `${parseFloat((Number(totalDeposited) / 1e6).toString()).toFixed(2)} USDC`,
                color: "text-emerald-400",
              },
              {
                label: "Total Paid Out",
                value: `${parseFloat((Number(totalPaid) / 1e6).toString()).toFixed(2)} USDC`,
                color: "text-violet-400",
              },
              {
                label: "Distributions",
                value: distCount.toString(),
                color: "text-amber-400",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-white/8 bg-white/3 px-5 py-4"
              >
                <p className="text-xs text-white/30 mb-1">{s.label}</p>
                <p className={`text-xl font-bold font-mono ${s.color}`}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 p-1 rounded-lg bg-white/4 border border-white/8 w-fit max-w-full overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                filter === f.key
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {f.label}
              {f.key !== "all" && !loading && (
                <span className="ml-1.5 text-white/25">
                  {events.filter((e) => e.type === f.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table (sm and up) / Cards (mobile) */}
        <div className="rounded-xl border border-white/8 overflow-hidden">
          {error ? (
            <div className="py-16 text-center text-sm text-red-400/70">
              Failed to load events: {error}
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="sm:hidden">
                {loading ? (
                  <SkeletonCards />
                ) : filtered.length === 0 ? (
                  <EmptyStateMobile />
                ) : (
                  filtered.map((ev, i) => <EventCard key={i} ev={ev} />)
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/3">
                      <th className="py-3 pl-6 pr-4 text-left text-xs font-medium text-white/30 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="py-3 px-4 text-right text-xs font-medium text-white/30 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-white/30 uppercase tracking-wider">
                        Detail
                      </th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-white/30 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="py-3 pl-4 pr-6 text-right text-xs font-medium text-white/30 uppercase tracking-wider">
                        Tx
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/0">
                    {loading ? (
                      <SkeletonRows />
                    ) : filtered.length === 0 ? (
                      <EmptyState />
                    ) : (
                      filtered.map((ev, i) => <EventRow key={i} ev={ev} />)
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer count */}
        {!loading && !error && filtered.length > 0 && (
          <p className="mt-3 text-xs text-white/20 text-right">
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </main>
  );
}
