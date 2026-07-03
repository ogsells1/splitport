"use client";

// Owner-facing "Automatic payouts" control on a project page. Lets the owner set
// a fixed amount to distribute weekly, monthly, or once on a custom date. Backed
// by /api/treasury/schedule; a daily cron actually runs due schedules.

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { formatUnits } from "viem";

type Frequency = "WEEKLY" | "MONTHLY" | "CUSTOM";

interface Schedule {
  id: string;
  frequency: Frequency;
  amount: string; // USDC, 6 decimals
  nextRunAt: string;
  active: boolean;
  lastRunAt: string | null;
}

interface AutoPayoutRowProps {
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

// <input type="date"> wants YYYY-MM-DD.
function toDateInput(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

export function AutoPayoutRow({ address, ownerPrivyId, splitMode = "PERCENTAGE", fixedTotal = "0" }: AutoPayoutRowProps) {
  const isFixed = splitMode === "FIXED";
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ownerPrivyId) return;
    try {
      const res = await authedFetch(
        `/api/treasury/schedule?contractAddress=${encodeURIComponent(
          address
        )}&ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`
      );
      const data = await res.json();
      if (res.ok) setSchedule(data.schedule);
    } catch {}
    setLoading(false);
  }, [address, ownerPrivyId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit() {
    if (schedule) {
      setFrequency(schedule.frequency);
      setAmount(parseFloat(formatUnits(BigInt(schedule.amount), 6)).toString());
      setDate(toDateInput(schedule.nextRunAt));
    } else {
      setFrequency("MONTHLY");
      setAmount("");
      setDate("");
    }
    setError("");
    setEditing(true);
  }

  async function save() {
    setError("");
    // FIXED projects derive the per-run amount from contributors' fixed amounts.
    let amt: number | undefined;
    if (!isFixed) {
      amt = parseFloat(amount);
      if (!amt || amt <= 0) {
        setError("Enter an amount greater than 0.");
        return;
      }
    }
    if (frequency === "CUSTOM" && !date) {
      setError("Pick the next payout date.");
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch("/api/treasury/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId,
          contractAddress: address,
          frequency,
          amount: amt,
          // For weekly/monthly the date is optional; send it if the owner set one.
          nextRunAt: date ? new Date(date).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save schedule");
      setSchedule(data.schedule);
      setEditing(false);
    } catch (e: any) {
      setError(e.message ?? "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  async function turnOff() {
    setSaving(true);
    try {
      await authedFetch(
        `/api/treasury/schedule?contractAddress=${encodeURIComponent(
          address
        )}&ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`,
        { method: "DELETE" }
      );
      setSchedule(null);
      setEditing(false);
    } catch {}
    setSaving(false);
  }

  if (loading) {
    return <div className="h-24 bg-stone-100 rounded-2xl animate-pulse" />;
  }

  const freqLabel: Record<Frequency, string> = {
    WEEKLY: "Every week",
    MONTHLY: "Every month",
    CUSTOM: "Once",
  };

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-400 uppercase tracking-wide">Automatic payouts</p>
        {schedule && !editing && (
          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            on
          </span>
        )}
      </div>

      {!editing && (
        <>
          {schedule ? (
            <div className="space-y-1">
              <p className="text-sm text-stone-800">
                <span className="font-semibold">
                  {parseFloat(formatUnits(BigInt(schedule.amount), 6)).toFixed(2)} USDC
                </span>{" "}
                · {freqLabel[schedule.frequency].toLowerCase()}
              </p>
              <p className="text-xs text-stone-400">
                Next payout: <span className="text-stone-600">{fmtDate(schedule.nextRunAt)}</span>
                {schedule.lastRunAt && <> · last: {fmtDate(schedule.lastRunAt)}</>}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-500">
              Pay contributors automatically on a schedule, straight from the treasury.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={startEdit}
              className="px-4 py-2 text-sm bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg transition-colors"
            >
              {schedule ? "Edit schedule" : "Set up auto payouts"}
            </button>
            {schedule && (
              <button
                onClick={turnOff}
                disabled={saving}
                className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium"
              >
                Turn off
              </button>
            )}
          </div>
        </>
      )}

      {editing && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-stone-400 mb-1 block">Frequency</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["WEEKLY", "MONTHLY", "CUSTOM"] as Frequency[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFrequency(f)}
                  className={`py-2 text-xs font-medium rounded-lg border transition-colors ${
                    frequency === f
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                      : "border-stone-200 text-stone-500 hover:border-stone-300"
                  }`}
                >
                  {f === "WEEKLY" ? "Weekly" : f === "MONTHLY" ? "Monthly" : "Custom date"}
                </button>
              ))}
            </div>
          </div>

          {isFixed ? (
            <div className="text-xs text-stone-500 bg-stone-50 rounded-lg px-3 py-2">
              Each run pays every participant their fixed amount –{" "}
              <span className="font-medium text-stone-700">
                {parseFloat(formatUnits(BigInt(fixedTotal), 6)).toFixed(2)} USDC
              </span>{" "}
              per payout.
            </div>
          ) : (
            <div>
              <label className="text-xs text-stone-400 mb-1 block">Amount per payout</label>
              <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden focus-within:border-emerald-500">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <span className="px-2 text-xs text-stone-400">USDC</span>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-stone-400 mb-1 block">
              {frequency === "CUSTOM" ? "Payout date" : "First payout (optional)"}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 text-sm text-stone-900 border border-stone-200 rounded-lg outline-none focus:border-emerald-500"
            />
            {frequency !== "CUSTOM" && (
              <p className="text-xs text-stone-400 mt-1">
                Leave empty to start one {frequency === "WEEKLY" ? "week" : "month"} from now.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-2 text-sm bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-colors"
            >
              {saving ? "Saving..." : "Save schedule"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-stone-400">
            Each payout splits the amount across contributors by their %. It runs only when the
            treasury has enough balance; otherwise it retries the next day.
          </p>
        </div>
      )}
    </div>
  );
}
