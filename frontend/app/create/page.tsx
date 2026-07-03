"use client";

import Logo from "@/components/Logo";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";

type Mode = "wallet" | "invite";
type SplitMode = "PERCENTAGE" | "FIXED";
type Row = { mode: Mode; wallet: string; percentage: string; amount: string; role: string };

type CreatedInvite = { role: string; percentage: number; amount: number | null; inviteUrl: string };

export default function CreateProjectPage() {
  const { ready, authenticated, user, logout } = usePrivy();
  const router = useRouter();

  const [name, setName] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("PERCENTAGE");
  const [rows, setRows] = useState<Row[]>([{ mode: "invite", wallet: "", percentage: "", amount: "", role: "" }]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [createdAddress, setCreatedAddress] = useState<string | null>(null);
  const [createdInvites, setCreatedInvites] = useState<CreatedInvite[]>([]);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isFixed = splitMode === "FIXED";
  const totalPct = rows.reduce((s, r) => s + (parseFloat(r.percentage) || 0), 0);
  const fixedSum = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const walletRows = rows.filter((r) => r.mode === "wallet");
  const validWallets = walletRows.every((r) => isAddress(r.wallet));
  const walletAddrs = walletRows.map((r) => r.wallet.toLowerCase());
  const noDuplicates = new Set(walletAddrs).size === walletAddrs.length;
  const sharesValid = isFixed
    ? rows.every((r) => (parseFloat(r.amount) || 0) > 0)
    : Math.round(totalPct * 100) === 10000;
  const canSubmit =
    name.trim().length > 0 &&
    rows.length > 0 &&
    sharesValid &&
    validWallets &&
    noDuplicates &&
    rows.every((r) => r.role.trim().length > 0);

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function setMode(i: number, mode: Mode) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, mode, wallet: mode === "invite" ? "" : r.wallet } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { mode: "invite", wallet: "", percentage: "", amount: "", role: "" }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    if (!canSubmit) return;
    setErrorMsg("");
    setBusy(true);
    try {
      const res = await authedFetch("/api/project/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId: user!.id,
          name: name.trim(),
          splitMode,
          contributors: rows.map((r) => ({
            role: r.role.trim(),
            percentage: isFixed ? 0 : Math.round(parseFloat(r.percentage) * 100),
            amount: isFixed ? parseFloat(r.amount) : undefined,
            wallet: r.mode === "wallet" ? r.wallet : null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create project");

      setCreatedAddress(data.contractAddress);
      setCreatedInvites(data.invites ?? []);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  // ── Success screen: show invite links ────────────────────────────────
  if (createdAddress) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="bg-white border-b border-stone-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <a href="/dashboard" className="flex items-center gap-2 font-semibold text-stone-900 hover:text-emerald-700 transition-colors"><Logo className="h-6 w-6" />SplitPort</a>
            <button onClick={logout} className="text-sm text-stone-400 hover:text-stone-600 transition-colors">
              Sign out
            </button>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <div className="text-center space-y-1">
            <p className="text-2xl">✓</p>
            <h1 className="text-xl font-semibold text-stone-900">Project created</h1>
            <p className="text-sm text-stone-500">Share these invite links with your contributors.</p>
          </div>

          {createdInvites.length > 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              {createdInvites.map((inv, i) => {
                const url = `${window.location.origin}${inv.inviteUrl}`;
                return (
                  <div key={i} className="px-4 py-3 border-b border-stone-100 last:border-0 space-y-1.5">
                    <p className="text-sm font-medium text-stone-900">
                      {inv.role} ·{" "}
                      {inv.amount != null
                        ? `${inv.amount.toFixed(2)} USDC`
                        : `${(inv.percentage / 100).toFixed(2)}%`}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={url}
                        className="flex-1 px-2 py-1.5 text-xs font-mono border border-stone-200 rounded-lg bg-stone-50 outline-none"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(url);
                          setCopied(i);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                        className="text-xs text-emerald-700 hover:text-emerald-800 px-3 py-1.5 border border-emerald-200 rounded-lg whitespace-nowrap"
                      >
                        {copied === i ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-stone-400 text-center bg-white border border-stone-200 rounded-2xl px-4 py-6">
              No invite links – all contributors were added by wallet.
            </p>
          )}

          <button
            onClick={() => router.push(`/dashboard/${createdAddress}`)}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Go to project
          </button>
        </main>
      </div>
    );
  }

  // ── Create form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-2 font-semibold text-stone-900 hover:text-emerald-700 transition-colors"><Logo className="h-6 w-6" />SplitPort</a>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm text-stone-400 hover:text-stone-600 transition-colors">
              ← Back
            </a>
            <button onClick={logout} className="text-sm text-stone-400 hover:text-stone-600 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Create New Project</h1>
          <p className="text-sm text-stone-500 mt-1">
            Set up your split and invite contributors by link – no wallet or crypto needed to start.
          </p>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <label className="block text-sm text-stone-500 mb-1.5">Project name</label>
          <input
            type="text"
            placeholder="My Music Project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <p className="text-sm font-medium text-stone-700 mb-2">How to split payouts</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSplitMode("PERCENTAGE")}
              className={`text-left p-3 rounded-xl border transition-colors ${
                !isFixed ? "border-emerald-600 bg-emerald-50" : "border-stone-200 hover:border-stone-300"
              }`}
            >
              <p className={`text-sm font-medium ${!isFixed ? "text-emerald-800" : "text-stone-700"}`}>
                By percentage
              </p>
              <p className="text-xs text-stone-500 mt-0.5">
                Split each payout by % (shares sum to 100%).
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("FIXED")}
              className={`text-left p-3 rounded-xl border transition-colors ${
                isFixed ? "border-emerald-600 bg-emerald-50" : "border-stone-200 hover:border-stone-300"
              }`}
            >
              <p className={`text-sm font-medium ${isFixed ? "text-emerald-800" : "text-stone-700"}`}>
                Fixed amount
              </p>
              <p className="text-xs text-stone-500 mt-0.5">
                Each participant gets a fixed USDC amount.
              </p>
            </button>
          </div>
          <p className="text-xs text-stone-400 mt-2">The mode is set now and can&apos;t be changed later.</p>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <p className="text-sm font-medium text-stone-700">Contributors</p>

          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="role (e.g. artist)"
                    value={row.role}
                    onChange={(e) => updateRow(i, "role", e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-emerald-500 transition-colors"
                  />
                  {isFixed ? (
                    <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden focus-within:border-emerald-500">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={row.amount}
                        onChange={(e) => updateRow(i, "amount", e.target.value)}
                        className="w-20 px-2 py-2 text-sm text-right outline-none"
                      />
                      <span className="px-1.5 text-xs text-stone-400">USDC</span>
                    </div>
                  ) : (
                    <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden focus-within:border-emerald-500">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="0"
                        value={row.percentage}
                        onChange={(e) => updateRow(i, "percentage", e.target.value)}
                        className="w-16 px-2 py-2 text-sm text-right outline-none"
                      />
                      <span className="px-1.5 text-xs text-stone-400">%</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex rounded-lg border border-stone-200 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setMode(i, "invite")}
                      className={`px-2.5 py-1.5 transition-colors ${row.mode === "invite" ? "bg-emerald-700 text-white" : "bg-white text-stone-500 hover:bg-stone-50"}`}
                    >
                      Invite link
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode(i, "wallet")}
                      className={`px-2.5 py-1.5 transition-colors ${row.mode === "wallet" ? "bg-emerald-700 text-white" : "bg-white text-stone-500 hover:bg-stone-50"}`}
                    >
                      Wallet
                    </button>
                  </div>
                  {row.mode === "wallet" ? (
                    <input
                      type="text"
                      placeholder="0x... wallet address"
                      value={row.wallet}
                      onChange={(e) => updateRow(i, "wallet", e.target.value)}
                      className={`flex-1 px-3 py-1.5 text-xs font-mono border rounded-lg outline-none transition-colors ${
                        row.wallet && !isAddress(row.wallet)
                          ? "border-red-300 focus:border-red-400"
                          : "border-stone-200 focus:border-emerald-500"
                      }`}
                    />
                  ) : (
                    <span className="flex-1 text-xs text-stone-400 px-1">
                      A claim link will be generated to share.
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeRow(i)}
                className="text-stone-300 hover:text-red-400 text-lg leading-none mt-1.5"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}

          <button
            onClick={addRow}
            className="w-full py-2 text-sm text-emerald-700 hover:text-emerald-800 border border-dashed border-emerald-200 rounded-lg transition-colors"
          >
            + Add Contributor
          </button>

          {isFixed ? (
            <div className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-stone-50 text-stone-700">
              <span>Total per payout</span>
              <span className="font-semibold">{fixedSum.toFixed(2)} USDC</span>
            </div>
          ) : (
            <div
              className={`flex items-center justify-between text-sm px-3 py-2 rounded-lg ${
                Math.round(totalPct * 100) === 10000
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              <span>Total</span>
              <span className="font-semibold">{totalPct.toFixed(2)}% / 100%</span>
            </div>
          )}

          {!noDuplicates && (
            <p className="text-xs text-red-500">Duplicate wallet addresses are not allowed.</p>
          )}
        </div>

        {errorMsg && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={!canSubmit || busy}
          className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </span>
          ) : (
            "Create Project"
          )}
        </button>
      </main>
    </div>
  );
}
