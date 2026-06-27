"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useWriteContract, useReadContract } from "wagmi";
import { VAULT_ADDRESS, VAULT_ABI } from "@/lib/contract";

interface ContributorsEditorProps {
  walletAddress?: string;
}

type Row = { wallet: string; percentage: string; role: string };

type Step = "idle" | "distributing" | "replacing" | "syncing" | "done" | "error";

export function ContributorsEditor({ walletAddress }: ContributorsEditorProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();

  const { data: contributors } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getContributors",
  });

  const { data: owner } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "owner",
  });

  const { data: info } = useReadContract({
    address: VAULT_ADDRESS,
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
          }))
      );
    }
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
    setRows((prev) => [...prev, { wallet: "", percentage: "", role: "" }]);
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
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "distribute",
        });
      }

      setStep("replacing");
      const wallets = rows.map((r) => r.wallet as `0x${string}`);
      const percentages = rows.map((r) => BigInt(Math.round(parseFloat(r.percentage) * 100)));
      const roles = rows.map((r) => r.role.trim());

      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "replaceContributors",
        args: [wallets, percentages, roles],
      });

      setStep("syncing");
      await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: info?.name,
          contractAddress: VAULT_ADDRESS,
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
