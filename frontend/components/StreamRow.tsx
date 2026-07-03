"use client";

// Owner-facing "Streaming payouts" control. The owner commits a total amount over
// a window [start, end]; it drips to contributors continuously (by %), reaching
// the full even sum at the end date. Backed by /api/treasury/streams. Contributors
// pull accrued funds anytime from their cabinet.

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { formatUnits } from "viem";

type StreamStatus = "ACTIVE" | "CANCELED";

interface Stream {
  id: string;
  total: string;
  accrued: string;
  claimed: string;
  startAt: string;
  endAt: string;
  status: StreamStatus;
}

interface ContributorLite {
  id: string;
  role: string;
  wallet: string | null;
  fixedAmount: string | null;
}

interface StreamRowProps {
  address: string;
  ownerPrivyId: string;
  splitMode?: "PERCENTAGE" | "FIXED";
  fixedTotal?: string; // USDC 6 dec, sum of fixed amounts (FIXED mode)
  contributors?: ContributorLite[];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function usdc(v: string) {
  return parseFloat(formatUnits(BigInt(v), 6)).toFixed(2);
}

export function StreamRow({ address, ownerPrivyId, splitMode = "PERCENTAGE", fixedTotal = "0", contributors = [] }: StreamRowProps) {
  const isFixed = splitMode === "FIXED";
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [total, setTotal] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // FIXED: stream all participants by default, or only the ticked ones.
  const streamIds = selected.size > 0 ? Array.from(selected) : undefined;
  const streamSum = isFixed
    ? (selected.size > 0
        ? contributors.filter((c) => selected.has(c.id)).reduce((s, c) => s + BigInt(c.fixedAmount ?? "0"), 0n)
        : BigInt(fixedTotal)
      ).toString()
    : fixedTotal;
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const load = useCallback(async () => {
    if (!ownerPrivyId) return;
    try {
      const res = await authedFetch(
        `/api/treasury/streams?contractAddress=${encodeURIComponent(
          address
        )}&ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`
      );
      const data = await res.json();
      if (res.ok) setStreams(data.streams ?? []);
    } catch {}
    setLoading(false);
  }, [address, ownerPrivyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-poll active streams so the accrued bar advances while the page is open.
  useEffect(() => {
    if (!streams.some((s) => s.status === "ACTIVE")) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [streams, load]);

  async function create() {
    setError("");
    // FIXED projects stream the sum of contributors' fixed amounts (total derived).
    let amt: number | undefined;
    if (!isFixed) {
      amt = parseFloat(total);
      if (!amt || amt <= 0) {
        setError("Enter a total greater than 0.");
        return;
      }
    }
    if (!end) {
      setError("Pick an end date.");
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch("/api/treasury/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId,
          contractAddress: address,
          total: amt,
          startAt: start ? new Date(start).toISOString() : undefined,
          endAt: new Date(end).toISOString(),
          contributorIds: isFixed ? streamIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start stream");
      setTotal("");
      setStart("");
      setEnd("");
      setSelected(new Set());
      setAdding(false);
      await load();
    } catch (e: any) {
      setError(e.message ?? "Failed to start stream");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    await authedFetch(
      `/api/treasury/streams?id=${id}&ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`,
      { method: "DELETE" }
    );
    load();
  }

  if (loading) {
    return <div className="h-24 bg-stone-100 rounded-2xl animate-pulse" />;
  }

  const activeCount = streams.filter((s) => s.status === "ACTIVE").length;

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-400 uppercase tracking-wide">Streaming payouts</p>
        {activeCount > 0 && (
          <span className="text-xs font-medium text-emerald-700">{activeCount} streaming</span>
        )}
      </div>

      {streams.length === 0 ? (
        <p className="text-sm text-stone-500">
          Drip a total amount to contributors continuously until a target date – they can pull
          what&apos;s accrued anytime.
        </p>
      ) : (
        <div className="space-y-3">
          {streams.map((s) => {
            const total = BigInt(s.total);
            const accrued = BigInt(s.accrued);
            const pct = total > 0n ? Number((accrued * 10000n) / total) / 100 : 0;
            return (
              <div key={s.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-stone-800">
                    {usdc(s.total)} USDC
                    <span className="text-xs text-stone-400 font-normal ml-1.5">
                      {fmtDate(s.startAt)} → {fmtDate(s.endAt)}
                    </span>
                  </p>
                  {s.status === "ACTIVE" ? (
                    <button
                      onClick={() => cancel(s.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span className="text-xs text-stone-400">canceled</span>
                  )}
                </div>
                <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      s.status === "ACTIVE" ? "bg-emerald-600" : "bg-stone-300"
                    }`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-stone-400">
                  {usdc(s.accrued)} accrued · {usdc(s.claimed)} claimed
                </p>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="space-y-3 pt-1">
          {isFixed ? (
            <div className="space-y-2">
              {contributors.length > 0 && (
                <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
                  {contributors.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          className="w-4 h-4 accent-emerald-700 shrink-0"
                        />
                        <span className="text-sm text-stone-700 truncate">{c.role}</span>
                      </span>
                      <span className="text-sm text-stone-500">
                        {usdc(c.fixedAmount ?? "0")} USDC
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="text-xs text-stone-500 bg-stone-50 rounded-lg px-3 py-2.5">
                Streams{" "}
                <span className="font-medium text-stone-700">{usdc(streamSum)} USDC</span> over the
                window – {selected.size > 0 ? `${selected.size} selected` : "all participants"} by
                their fixed amount.
              </div>
            </div>
          ) : (
            <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden focus-within:border-emerald-500">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="total to stream"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="flex-1 px-3 py-2.5 text-sm text-stone-900 outline-none"
              />
              <span className="px-2 text-xs text-stone-400">USDC</span>
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-stone-400 mb-1 block">Start (optional)</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-stone-400 mb-1 block">End date</label>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={saving}
              className="flex-1 py-2 text-sm bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-colors"
            >
              {saving ? "Starting..." : "Start stream"}
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
          + Start a stream
        </button>
      )}
      <p className="text-xs text-stone-400">
        The full total is reserved from the treasury upfront and accrues by the second across
        contributors {isFixed ? "by their fixed amount" : "by their %"}. Canceling returns the
        unclaimed remainder.
      </p>
    </div>
  );
}
