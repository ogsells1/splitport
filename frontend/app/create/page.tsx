"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";

type Mode = "wallet" | "invite";
type Row = { mode: Mode; wallet: string; percentage: string; role: string };

type CreatedInvite = { role: string; percentage: number; inviteUrl: string };

export default function CreateProjectPage() {
  const { ready, authenticated, user, logout } = usePrivy();
  const router = useRouter();

  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([{ mode: "invite", wallet: "", percentage: "", role: "" }]);
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
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalPct = rows.reduce((s, r) => s + (parseFloat(r.percentage) || 0), 0);
  const walletRows = rows.filter((r) => r.mode === "wallet");
  const validWallets = walletRows.every((r) => isAddress(r.wallet));
  const walletAddrs = walletRows.map((r) => r.wallet.toLowerCase());
  const noDuplicates = new Set(walletAddrs).size === walletAddrs.length;
  const canSubmit =
    name.trim().length > 0 &&
    rows.length > 0 &&
    Math.round(totalPct * 100) === 10000 &&
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
    setRows((prev) => [...prev, { mode: "invite", wallet: "", percentage: "", role: "" }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    if (!canSubmit) return;
    setErrorMsg("");
    setBusy(true);
    try {
      const res = await fetch("/api/project/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId: user!.id,
          name: name.trim(),
          contributors: rows.map((r) => ({
            role: r.role.trim(),
            percentage: Math.round(parseFloat(r.percentage) * 100),
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
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <span className="font-semibold text-gray-900">BYN Split Pay</span>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <div className="text-center space-y-1">
            <p className="text-2xl">✓</p>
            <h1 className="text-xl font-semibold text-gray-900">Project created</h1>
            <p className="text-sm text-gray-500">Share these invite links with your contributors.</p>
          </div>

          {createdInvites.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {createdInvites.map((inv, i) => {
                const url = `${window.location.origin}${inv.inviteUrl}`;
                return (
                  <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-0 space-y-1.5">
                    <p className="text-sm font-medium text-gray-900">
                      {inv.role} · {(inv.percentage / 100).toFixed(2)}%
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={url}
                        className="flex-1 px-2 py-1.5 text-xs font-mono border border-gray-200 rounded-lg bg-gray-50 outline-none"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(url);
                          setCopied(i);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-700 px-3 py-1.5 border border-indigo-200 rounded-lg whitespace-nowrap"
                      >
                        {copied === i ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center bg-white border border-gray-200 rounded-2xl px-4 py-6">
              No invite links — all contributors were added by wallet.
            </p>
          )}

          <button
            onClick={() => router.push(`/dashboard/${createdAddress}`)}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Go to project
          </button>
        </main>
      </div>
    );
  }

  // ── Create form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-gray-900">BYN Split Pay</span>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← Back
            </a>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Create New Project</h1>
          <p className="text-sm text-gray-500 mt-1">
            Set up your split and invite contributors by link — no wallet or crypto needed to start.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <label className="block text-sm text-gray-500 mb-1.5">Project name</label>
          <input
            type="text"
            placeholder="My Music Project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-indigo-400 transition-colors"
          />
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <p className="text-sm font-medium text-gray-700">Contributors</p>

          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="role (e.g. artist)"
                    value={row.role}
                    onChange={(e) => updateRow(i, "role", e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-indigo-400 transition-colors"
                  />
                  <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400">
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
                    <span className="px-1.5 text-xs text-gray-400">%</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setMode(i, "invite")}
                      className={`px-2.5 py-1.5 transition-colors ${row.mode === "invite" ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                    >
                      Invite link
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode(i, "wallet")}
                      className={`px-2.5 py-1.5 transition-colors ${row.mode === "wallet" ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
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
                          : "border-gray-200 focus:border-indigo-400"
                      }`}
                    />
                  ) : (
                    <span className="flex-1 text-xs text-gray-400 px-1">
                      A claim link will be generated to share.
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeRow(i)}
                className="text-gray-300 hover:text-red-400 text-lg leading-none mt-1.5"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}

          <button
            onClick={addRow}
            className="w-full py-2 text-sm text-indigo-600 hover:text-indigo-700 border border-dashed border-indigo-200 rounded-lg transition-colors"
          >
            + Add Contributor
          </button>

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
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
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
