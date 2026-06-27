"use client";

import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useWriteContract, useReadContract } from "wagmi";
import { VAULT_ABI } from "@/lib/contract";

interface ContributorsEditorProps {
  vaultAddress: Address;
  walletAddress?: string;
  ownerPrivyId?: string;
}

type Row = {
  wallet: string;
  percentage: string;
  role: string;
  status: "CLAIMED" | "PENDING";
  inviteToken?: string;
};

type Step = "idle" | "distributing" | "replacing" | "syncing" | "done" | "error";

export function ContributorsEditor({ vaultAddress, walletAddress, ownerPrivyId }: ContributorsEditorProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingInvites, setPendingInvites] = useState<Row[]>([]);
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState("");
  const [invitePct, setInvitePct] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [newInviteLink, setNewInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { writeContractAsync } = useWriteContract();

  const { data: contributors } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "getContributors",
  });

  const { data: owner } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "owner",
  });

  const { data: info } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "getProjectInfo",
  });

  const isOwner =
    walletAddress && owner ? walletAddress.toLowerCase() === owner.toLowerCase() : false;

  useEffect(() => {
    if (open && contributors) {
      setRows(
        contributors
          .filter((c) => c.active)
          .map((c) => ({
            wallet: c.wallet,
            percentage: String(Number(c.percentage) / 100),
            role: c.role,
            status: "CLAIMED" as const,
          }))
      );
    }
  }, [open, contributors]);

  async function refreshInvites() {
    try {
      const res = await fetch(`/api/project?contractAddress=${vaultAddress}`);
      if (!res.ok) return;
      const data = await res.json();
      const onChainWallets = new Set((contributors ?? []).map((c) => c.wallet.toLowerCase()));

      const stillWaiting: Row[] = [];
      const claimedNotOnChain: Row[] = [];

      for (const c of data.contributors ?? []) {
        if (c.status === "PENDING") {
          stillWaiting.push({
            wallet: "",
            percentage: String(c.percentage / 100),
            role: c.role,
            status: "PENDING",
            inviteToken: c.inviteToken,
          });
        } else if (c.wallet && !onChainWallets.has(c.wallet.toLowerCase())) {
          claimedNotOnChain.push({
            wallet: c.wallet,
            percentage: String(c.percentage / 100),
            role: c.role,
            status: "CLAIMED",
          });
        }
      }

      setPendingInvites(stillWaiting);
      if (claimedNotOnChain.length > 0) {
        setRows((prev) => {
          const existing = new Set(prev.map((r) => r.wallet.toLowerCase()));
          const toAdd = claimedNotOnChain.filter((r) => !existing.has(r.wallet.toLowerCase()));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    if (open) refreshInvites();
  }, [open, contributors]);

  if (!isOwner) return null;

  const totalPct = rows.reduce((s, r) => s + (parseFloat(r.percentage) || 0), 0);
  const validAddresses = rows.every((r) => isAddress(r.wallet));
  const noDuplicates =
    new Set(rows.map((r) => r.wallet.toLowerCase())).size === rows.length;
  const canSubmit =
    rows.length > 0 &&
    Math.round(totalPct * 100) === 10000 &&
    validAddresses &&
    noDuplicates &&
    rows.every((r) => r.role.trim().length > 0);

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { wallet: "", percentage: "", role: "", status: "CLAIMED" }]);
  }

  async function createInvite() {
    setInviteError("");
    const pct = parseFloat(invitePct);
    if (!inviteRole.trim() || !pct || pct <= 0) {
      setInviteError("Enter a role and a percentage greater than 0.");
      return;
    }
    setCreatingInvite(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId,
          contractAddress: vaultAddress,
          role: inviteRole.trim(),
          percentage: Math.round(pct * 100),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create invite");

      setNewInviteLink(`${window.location.origin}/invite/${data.inviteToken}`);
      setInviteRole("");
      setInvitePct("");
      await refreshInvites();
    } catch (e: any) {
      setInviteError(e.message ?? "Failed to create invite");
    } finally {
      setCreatingInvite(false);
    }
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!canSubmit) return;
    setErrorMsg("");

    try {
      const pending = info?.pendingBalance ?? 0n;
      if (pending > 0n) {
        setStep("distributing");
        await writeContractAsync({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: "distribute",
        });
        fetch(`/api/transactions/sync?contractAddress=${vaultAddress}`, { method: "POST" }).catch(() => {});
      }

      setStep("replacing");
      const wallets = rows.map((r) => r.wallet as `0x${string}`);
      const percentages = rows.map((r) => BigInt(Math.round(parseFloat(r.percentage) * 100)));
      const roles = rows.map((r) => r.role.trim());

      await writeContractAsync({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "replaceContributors",
        args: [wallets, percentages, roles],
      });

      setStep("syncing");
      await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId,
          name: info?.name,
          contractAddress: vaultAddress,
          usdcAddress: info?.usdcToken,
          contributors: rows.map((r) => ({
            wallet: r.wallet,
            percentage: Math.round(parseFloat(r.percentage) * 100),
            role: r.role.trim(),
          })),
        }),
      });

      setStep("done");
      setTimeout(() => {
        setOpen(false);
        setStep("idle");
      }, 1500);
    } catch (e: any) {
      setErrorMsg(e?.shortMessage ?? e?.message ?? "Transaction failed");
      setStep("error");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition-colors text-sm"
      >
        <span>✎</span> Edit Contributors
      </button>
    );
  }

  const busy = step === "distributing" || step === "replacing" || step === "syncing";

  const stepLabel: Record<Step, string> = {
    idle: "Save Changes",
    distributing: "Distributing pending balance...",
    replacing: "Updating contributors...",
    syncing: "Syncing...",
    done: "✓ Saved!",
    error: "Try again",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Edit Contributors</h3>
          <button
            onClick={() => { setOpen(false); setStep("idle"); setErrorMsg(""); }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <input
                  type="text"
                  placeholder="0x... wallet address"
                  value={row.wallet}
                  onChange={(e) => updateRow(i, "wallet", e.target.value)}
                  className={`w-full px-3 py-2 text-sm font-mono border rounded-lg outline-none transition-colors ${
                    row.wallet && !isAddress(row.wallet)
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-200 focus:border-indigo-400"
                  }`}
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="role (e.g. artist)"
                    value={row.role}
                    onChange={(e) => updateRow(i, "role", e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400 transition-colors"
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
                      className="w-16 px-2 py-1.5 text-xs text-right outline-none"
                    />
                    <span className="px-1.5 text-xs text-gray-400">%</span>
                  </div>
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
        </div>

        {pendingInvites.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Waiting for participant
            </p>
            {pendingInvites.map((inv, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 bg-amber-50 rounded-lg px-3 py-2"
              >
                <div className="text-xs text-amber-800">
                  <span className="font-medium">{inv.role}</span> · {parseFloat(inv.percentage).toFixed(2)}%
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.inviteToken}`);
                    }}
                    className="text-xs text-amber-700 hover:text-amber-900 underline"
                  >
                    Copy link
                  </button>
                  <button
                    onClick={async () => {
                      await fetch(`/api/invite/${inv.inviteToken}?ownerPrivyId=${ownerPrivyId}`, {
                        method: "DELETE",
                      });
                      refreshInvites();
                    }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={addRow}
            className="flex-1 py-2 text-sm text-indigo-600 hover:text-indigo-700 border border-dashed border-indigo-200 rounded-lg transition-colors"
          >
            + Add Contributor
          </button>
          <button
            onClick={() => { setShowInviteForm((v) => !v); setNewInviteLink(null); setInviteError(""); }}
            className="flex-1 py-2 text-sm text-gray-600 hover:text-gray-800 border border-dashed border-gray-300 rounded-lg transition-colors"
          >
            + Invite by Link
          </button>
        </div>

        {showInviteForm && (
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            {newInviteLink ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Share this link with the participant:</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={newInviteLink}
                    className="flex-1 px-2 py-1.5 text-xs font-mono border border-gray-200 rounded-lg bg-white outline-none"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(newInviteLink);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="text-xs text-indigo-600 hover:text-indigo-700 px-2 py-1.5 border border-indigo-200 rounded-lg"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <button
                  onClick={() => setNewInviteLink(null)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  + Create another invite
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="role (e.g. artist)"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400 transition-colors"
                  />
                  <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400">
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
                  </div>
                </div>
                {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
                <button
                  onClick={createInvite}
                  disabled={creatingInvite}
                  className="w-full py-2 text-sm bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {creatingInvite ? "Generating..." : "Generate invite link"}
                </button>
                <p className="text-xs text-gray-400">
                  This share is reserved until the link is claimed — it won't count toward the
                  100% on-chain until then.
                </p>
              </>
            )}
          </div>
        )}

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

        {(info?.pendingBalance ?? 0n) > 0n && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            ⚠ There is a pending balance — it will be distributed to the current
            contributors before the replacement takes effect.
          </p>
        )}

        {step === "error" && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
        )}

        <button
          onClick={handleSave}
          disabled={!canSubmit || busy || step === "done"}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {stepLabel[step]}
            </span>
          ) : (
            stepLabel[step]
          )}
        </button>
      </div>
    </div>
  );
}
