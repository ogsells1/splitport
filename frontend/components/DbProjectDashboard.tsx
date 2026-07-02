"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { formatUnits, isAddress } from "viem";
import { AutoPayoutRow } from "./AutoPayoutRow";
import { ScheduledPayoutsRow } from "./ScheduledPayoutsRow";
import { StreamRow } from "./StreamRow";

interface Contributor {
  id: string;
  wallet: string | null;
  percentage: number;
  fixedAmount: string | null; // USDC 6 dec, FIXED mode
  role: string;
  status: "PENDING" | "CLAIMED";
  inviteToken?: string;
}

type SplitMode = "PERCENTAGE" | "FIXED";

interface DbProjectDashboardProps {
  address: string; // synthetic db_ id
  ownerPrivyId: string;
}

function fmtUsdc(v: bigint) {
  return parseFloat(formatUnits(v, 6)).toFixed(2);
}

export function DbProjectDashboard({ address, ownerPrivyId }: DbProjectDashboardProps) {
  const [name, setName] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("PERCENTAGE");
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showInvite, setShowInvite] = useState(false);
  const [addMode, setAddMode] = useState<"invite" | "wallet">("invite");
  const [inviteRole, setInviteRole] = useState("");
  const [invitePct, setInvitePct] = useState("");
  const [inviteAmount, setInviteAmount] = useState("");
  const [inviteWallet, setInviteWallet] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Treasury balance + distribute-from-here
  const [treasuryBalance, setTreasuryBalance] = useState<bigint>(0n);
  const [distributedTotal, setDistributedTotal] = useState<bigint>(0n);
  const [distAmount, setDistAmount] = useState("");
  const [distributing, setDistributing] = useState(false);
  const [distError, setDistError] = useState("");
  const [distDone, setDistDone] = useState(false);

  // FIXED-mode: selected contributors + inline amount editing
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const isFixed = splitMode === "FIXED";

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/project?contractAddress=${address}`);
      const data = await res.json();
      if (res.ok) {
        setName(data.name);
        setSplitMode(data.splitMode === "FIXED" ? "FIXED" : "PERCENTAGE");
        setContributors(data.contributors ?? []);
      }
    } catch {}
    setLoading(false);
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!ownerPrivyId) return;
    authedFetch(`/api/projects?ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`)
      .then((r) => r.json())
      .then((d) =>
        setIsOwner((d.projects ?? []).some((p: any) => p.contractAddress === address))
      )
      .catch(() => {});
  }, [ownerPrivyId, address]);

  const loadTreasury = useCallback(async () => {
    if (!ownerPrivyId) return;
    try {
      const res = await authedFetch(`/api/treasury?userPrivyId=${encodeURIComponent(ownerPrivyId)}`);
      const data = await res.json();
      if (res.ok) {
        setTreasuryBalance(BigInt(data.balance ?? "0"));
        const forThis = (data.distributions ?? [])
          .filter((d: any) => d.contractAddress === address)
          .reduce((s: bigint, d: any) => s + BigInt(d.total), 0n);
        setDistributedTotal(forThis);
      }
    } catch {}
  }, [ownerPrivyId, address]);

  useEffect(() => {
    loadTreasury();
  }, [loadTreasury]);

  const totalPct = contributors.reduce((s, c) => s + c.percentage, 0);
  const fixedTotal = contributors.reduce((s, c) => s + BigInt(c.fixedAmount ?? "0"), 0n);
  const selectedTotal = contributors
    .filter((c) => selected.has(c.id))
    .reduce((s, c) => s + BigInt(c.fixedAmount ?? "0"), 0n);

  // Distribute by percentage (PERCENTAGE projects use the amount input).
  async function distributePct() {
    setDistError("");
    const amt = parseFloat(distAmount);
    if (!amt || amt <= 0) {
      setDistError("Enter an amount greater than 0.");
      return;
    }
    await runDistribute({ amount: amt });
    setDistAmount("");
  }

  // Distribute fixed amounts to all or a chosen subset.
  async function distributeFixed(ids?: string[]) {
    setDistError("");
    await runDistribute({ contributorIds: ids });
  }

  async function runDistribute(payload: { amount?: number; contributorIds?: string[] }) {
    setDistributing(true);
    try {
      const res = await authedFetch("/api/treasury/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerPrivyId, contractAddress: address, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Distribution failed");
      setDistDone(true);
      setSelected(new Set());
      await loadTreasury();
      setTimeout(() => setDistDone(false), 2500);
    } catch (e: any) {
      setDistError(e.message ?? "Distribution failed");
    } finally {
      setDistributing(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveAmount(contributorId: string) {
    const amt = parseFloat(editValue);
    if (!amt || amt <= 0) return;
    await authedFetch("/api/contributor", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerPrivyId, contributorId, amount: amt }),
    });
    setEditingId(null);
    setEditValue("");
    await load();
  }

  async function createInvite() {
    setInviteError("");
    if (!inviteRole.trim()) {
      setInviteError("Enter a role.");
      return;
    }
    const body: any = { ownerPrivyId, contractAddress: address, role: inviteRole.trim() };
    if (isFixed) {
      const amt = parseFloat(inviteAmount);
      if (!amt || amt <= 0) {
        setInviteError("Enter a fixed amount greater than 0.");
        return;
      }
      body.amount = amt;
    } else {
      const pct = parseFloat(invitePct);
      if (!pct || pct <= 0) {
        setInviteError("Enter a percentage greater than 0.");
        return;
      }
      body.percentage = Math.round(pct * 100);
    }
    if (addMode === "wallet") {
      if (!isAddress(inviteWallet)) {
        setInviteError("Enter a valid wallet address.");
        return;
      }
      body.wallet = inviteWallet.trim();
    }
    setCreating(true);
    try {
      const res = await authedFetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add contributor");
      setInviteRole("");
      setInvitePct("");
      setInviteAmount("");
      setInviteWallet("");
      setShowInvite(false);
      await load();
    } catch (e: any) {
      setInviteError(e.message ?? "Failed to add contributor");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token: string) {
    await authedFetch(`/api/invite/${token}?ownerPrivyId=${ownerPrivyId}`, { method: "DELETE" });
    load();
  }

  function copy(token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-12 bg-gray-100 rounded-2xl" />
        <div className="h-48 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Project</p>
          <h2 className="text-xl font-semibold text-gray-900">{name}</h2>
          <span className="inline-block mt-1.5 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {isFixed ? "Fixed amount" : "Percentage split"}
          </span>
        </div>
        {isOwner && (
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full mt-1">
            owner
          </span>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Contributors</p>
          {isFixed ? (
            <span className="text-xs font-medium text-gray-600">
              {fmtUsdc(fixedTotal)} USDC / payout
            </span>
          ) : (
            <span
              className={`text-xs font-medium ${
                totalPct === 10000 ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              {(totalPct / 100).toFixed(2)}% / 100%
            </span>
          )}
        </div>

        {contributors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">No contributors yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {contributors.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  {isFixed && isOwner && (
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelected(c.id)}
                      className="w-4 h-4 accent-indigo-600 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{c.role}</p>
                    {c.status === "CLAIMED" && c.wallet ? (
                      <p className="text-xs text-gray-400 font-mono mt-0.5">
                        {c.wallet.slice(0, 6)}...{c.wallet.slice(-4)}
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-amber-600">invite pending</span>
                        {isOwner && c.inviteToken && (
                          <>
                            <button
                              onClick={() => copy(c.inviteToken!)}
                              className="text-xs text-indigo-600 hover:text-indigo-700 underline"
                            >
                              {copied === c.inviteToken ? "Copied!" : "Copy link"}
                            </button>
                            <button
                              onClick={() => revoke(c.inviteToken!)}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Revoke
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {isFixed ? (
                  editingId === c.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-20 px-2 py-1 text-sm text-right border border-gray-200 rounded-lg outline-none focus:border-indigo-400"
                      />
                      <button
                        onClick={() => saveAmount(c.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditValue(""); }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (!isOwner) return;
                        setEditingId(c.id);
                        setEditValue(formatUnits(BigInt(c.fixedAmount ?? "0"), 6));
                      }}
                      className={`text-sm font-semibold text-gray-900 ${
                        isOwner ? "hover:text-indigo-600" : ""
                      }`}
                      title={isOwner ? "Edit amount" : undefined}
                    >
                      {fmtUsdc(BigInt(c.fixedAmount ?? "0"))} USDC
                    </button>
                  )
                ) : (
                  <span className="text-sm font-semibold text-gray-900">
                    {(c.percentage / 100).toFixed(2)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {isOwner && (
          <div className="px-4 py-3 border-t border-gray-100">
            {showInvite ? (
              <div className="space-y-2">
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs w-max">
                  <button
                    type="button"
                    onClick={() => setAddMode("invite")}
                    className={`px-2.5 py-1.5 transition-colors ${addMode === "invite" ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                  >
                    Invite link
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode("wallet")}
                    className={`px-2.5 py-1.5 transition-colors ${addMode === "wallet" ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                  >
                    Wallet
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="role (e.g. artist)"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400"
                  />
                  <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400">
                    {isFixed ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={inviteAmount}
                          onChange={(e) => setInviteAmount(e.target.value)}
                          className="w-20 px-2 py-1.5 text-xs text-right outline-none"
                        />
                        <span className="px-1.5 text-xs text-gray-400">USDC</span>
                      </>
                    ) : (
                      <>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="0"
                          value={invitePct}
                          onChange={(e) => setInvitePct(e.target.value)}
                          className="w-16 px-2 py-1.5 text-xs text-right outline-none"
                        />
                        <span className="px-1.5 text-xs text-gray-400">%</span>
                      </>
                    )}
                  </div>
                </div>
                {addMode === "wallet" && (
                  <input
                    type="text"
                    placeholder="0x... wallet address"
                    value={inviteWallet}
                    onChange={(e) => setInviteWallet(e.target.value)}
                    className={`w-full px-3 py-1.5 text-xs font-mono border rounded-lg outline-none transition-colors ${
                      inviteWallet && !isAddress(inviteWallet)
                        ? "border-red-300 focus:border-red-400"
                        : "border-gray-200 focus:border-indigo-400"
                    }`}
                  />
                )}
                {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={createInvite}
                    disabled={creating}
                    className="flex-1 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors"
                  >
                    {creating
                      ? "Saving..."
                      : addMode === "wallet"
                      ? "Add contributor"
                      : "Generate invite link"}
                  </button>
                  <button
                    onClick={() => { setShowInvite(false); setInviteError(""); }}
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowInvite(true)}
                className="w-full py-2 text-sm text-indigo-600 hover:text-indigo-700 border border-dashed border-indigo-200 rounded-lg transition-colors"
              >
                + Add Contributor
              </button>
            )}
          </div>
        )}
      </div>

      {isOwner && contributors.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Treasury balance</p>
              <p className="text-2xl font-semibold text-gray-900">
                {fmtUsdc(treasuryBalance)}
                <span className="text-sm text-gray-400 ml-1.5">USDC</span>
              </p>
            </div>
            {distributedTotal > 0n && (
              <p className="text-xs text-gray-400 mb-1">
                distributed to this project:{" "}
                <span className="text-gray-600 font-medium">
                  {fmtUsdc(distributedTotal)} USDC
                </span>
              </p>
            )}
          </div>

          {isFixed ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => distributeFixed()}
                  disabled={distributing || distDone || treasuryBalance === 0n || fixedTotal === 0n}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {distributing ? "Distributing..." : distDone ? "✓ Distributed" : `Distribute to all · ${fmtUsdc(fixedTotal)} USDC`}
                </button>
                <button
                  onClick={() => distributeFixed(Array.from(selected))}
                  disabled={distributing || distDone || selected.size === 0}
                  className="px-5 py-2.5 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 text-sm font-medium rounded-lg transition-colors"
                >
                  Distribute selected{selected.size > 0 ? ` · ${fmtUsdc(selectedTotal)} USDC` : ""}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Each participant gets their fixed amount. Tick rows above to pay only some of them.
                Need funds?{" "}
                <a href="/treasury" className="text-indigo-600 hover:underline">Top up treasury</a>.
              </p>
              {distError && <p className="text-xs text-red-500">{distError}</p>}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400 transition-colors">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={distAmount}
                    onChange={(e) => setDistAmount(e.target.value)}
                    className="flex-1 px-3 py-2.5 text-sm text-gray-900 outline-none"
                  />
                  <span className="px-2 text-xs text-gray-400">USDC</span>
                </div>
                <button
                  onClick={distributePct}
                  disabled={distributing || distDone || treasuryBalance === 0n}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  {distributing ? "Distributing..." : distDone ? "✓ Distributed" : "Distribute"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Splits the amount across contributors by their %. Pending contributors&apos; shares are
                reserved until they accept their invite. Need funds?{" "}
                <a href="/treasury" className="text-indigo-600 hover:underline">
                  Top up treasury
                </a>
                .
              </p>
              {distError && <p className="text-xs text-red-500 mt-1.5">{distError}</p>}
            </div>
          )}
        </div>
      )}

      {isOwner && contributors.length > 0 && (
        <AutoPayoutRow
          address={address}
          ownerPrivyId={ownerPrivyId}
          splitMode={splitMode}
          fixedTotal={fixedTotal.toString()}
        />
      )}

      {isOwner && contributors.length > 0 && (
        <ScheduledPayoutsRow
          address={address}
          ownerPrivyId={ownerPrivyId}
          splitMode={splitMode}
          fixedTotal={fixedTotal.toString()}
        />
      )}

      {isOwner && contributors.length > 0 && (
        <StreamRow
          address={address}
          ownerPrivyId={ownerPrivyId}
          splitMode={splitMode}
          fixedTotal={fixedTotal.toString()}
          contributors={contributors.map((c) => ({
            id: c.id,
            role: c.role,
            wallet: c.wallet,
            fixedAmount: c.fixedAmount,
          }))}
        />
      )}
    </div>
  );
}
