"use client";

// Owner-facing "One-off payouts" queue on a project page. The owner can schedule
// any number of individual future payouts (amount + date); the daily cron runs
// each due one. Backed by /api/treasury/payments. Distinct from the single
// recurring schedule in AutoPayoutRow.

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { formatUnits } from "viem";

type Status = "PENDING" | "DONE" | "CANCELED";

interface Payment {
  id: string;
  amount: string; // USDC, 6 decimals
  runAt: string;
  status: Status;
  ranAt: string | null;
}

interface ScheduledPayoutsRowProps {
  address: string;
  ownerPrivyId: string;
  splitMode?: "PERCENTAGE" | "FIXED";
  fixedTotal?: string; // USDC 6 dec, sum of fixed amounts (FIXED mode)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_STYLE: Record<Status, string> = {
  PENDING: "text-amber-600 bg-amber-50",
  DONE: "text-emerald-600 bg-emerald-50",
  CANCELED: "text-stone-400 bg-stone-100",
};

export function ScheduledPayoutsRow({ address, ownerPrivyId, splitMode = "PERCENTAGE", fixedTotal = "0" }: ScheduledPayoutsRowProps) {
  const isFixed = splitMode === "FIXED";
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ownerPrivyId) return;
    try {
      const res = await authedFetch(
        `/api/treasury/payments?contractAddress=${encodeURIComponent(
          address
        )}&ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`
      );
      const data = await res.json();
      if (res.ok) setPayments(data.payments ?? []);
    } catch {}
    setLoading(false);
  }, [address, ownerPrivyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError("");
    // FIXED projects derive the amount from contributors' fixed amounts.
    let amt: number | undefined;
    if (!isFixed) {
      amt = parseFloat(amount);
      if (!amt || amt <= 0) {
        setError("Enter an amount greater than 0.");
        return;
      }
    }
    if (!date) {
      setError("Pick a payout date.");
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch("/api/treasury/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId,
          contractAddress: address,
          amount: amt,
          runAt: new Date(date).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to schedule payout");
      setAmount("");
      setDate("");
      setAdding(false);
      await load();
    } catch (e: any) {
      setError(e.message ?? "Failed to schedule payout");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    await authedFetch(
      `/api/treasury/payments?id=${id}&ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`,
      { method: "DELETE" }
    );
    load();
  }

  if (loading) {
    return <div className="h-24 bg-stone-100 rounded-2xl animate-pulse" />;
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-400 uppercase tracking-wide">One-off payouts</p>
        {payments.some((p) => p.status === "PENDING") && (
          <span className="text-xs font-medium text-amber-600">
            {payments.filter((p) => p.status === "PENDING").length} scheduled
          </span>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-stone-500">
          Schedule individual payouts for specific dates — as many as you like.
        </p>
      ) : (
        <div className="divide-y divide-stone-100 -my-1">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">
                  {parseFloat(formatUnits(BigInt(p.amount), 6)).toFixed(2)} USDC
                </p>
                <p className="text-xs text-stone-400">
                  {p.status === "DONE" && p.ranAt
                    ? `paid ${fmtDate(p.ranAt)}`
                    : fmtDate(p.runAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status]}`}
                >
                  {p.status.toLowerCase()}
                </span>
                {p.status === "PENDING" && (
                  <button
                    onClick={() => cancel(p.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="space-y-3 pt-1">
          <div className="flex gap-2">
            {isFixed ? (
              <div className="flex-1 flex items-center px-3 py-2.5 text-xs text-stone-500 bg-stone-50 rounded-lg">
                Pays fixed amounts —{" "}
                <span className="font-medium text-stone-700 ml-1">
                  {parseFloat(formatUnits(BigInt(fixedTotal), 6)).toFixed(2)} USDC
                </span>
              </div>
            ) : (
              <div className="flex-1 flex items-center border border-stone-200 rounded-lg overflow-hidden focus-within:border-emerald-500">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 px-3 py-2.5 text-sm text-stone-900 outline-none w-full"
                />
                <span className="px-2 text-xs text-stone-400">USDC</span>
              </div>
            )}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2.5 text-sm text-stone-900 border border-stone-200 rounded-lg outline-none focus:border-emerald-500"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={saving}
              className="flex-1 py-2 text-sm bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-colors"
            >
              {saving ? "Scheduling..." : "Schedule payout"}
            </button>
            <button
              onClick={() => { setAdding(false); setError(""); }}
              className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-2 text-sm text-emerald-700 hover:text-emerald-800 border border-dashed border-emerald-200 rounded-lg transition-colors"
        >
          + Schedule a payout
        </button>
      )}
      <p className="text-xs text-stone-400">
        Each runs once on its date, splitting the amount across contributors by their %. Runs only
        when the treasury has enough balance; otherwise it retries the next day.
      </p>
    </div>
  );
}
