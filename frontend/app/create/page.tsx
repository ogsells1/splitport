"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { useDeployContract, useWriteContract, usePublicClient } from "wagmi";
import {
  SPLIT_VAULT_BYTECODE,
  SPLIT_VAULT_DEPLOY_ABI,
  VAULT_ABI,
  USDC_ADDRESS,
} from "@/lib/contract";

type Row = { wallet: string; percentage: string; role: string };

type Step =
  | "idle"
  | "deploying"
  | "initializing"
  | "syncing"
  | "done"
  | "error";

const STEP_LABEL: Record<Step, string> = {
  idle: "Create Project",
  deploying: "Deploying contract...",
  initializing: "Setting contributors...",
  syncing: "Saving...",
  done: "✓ Created!",
  error: "Try again",
};

export default function CreateProjectPage() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();
  const publicClient = usePublicClient();

  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();

  const [name, setName] = useState("");
  const [usdcAddress, setUsdcAddress] = useState<string>(USDC_ADDRESS);
  const [rows, setRows] = useState<Row[]>([
    { wallet: "", percentage: "", role: "" },
  ]);
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

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

  const wallet = wallets[0];
  const ownerAddress = wallet?.address;

  const totalPct = rows.reduce((s, r) => s + (parseFloat(r.percentage) || 0), 0);
  const validAddresses = rows.every((r) => isAddress(r.wallet));
  const noDuplicates =
    new Set(rows.map((r) => r.wallet.toLowerCase())).size === rows.length;
  const canSubmit =
    !!ownerAddress &&
    name.trim().length > 0 &&
    isAddress(usdcAddress) &&
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

  async function handleCreate() {
    if (!canSubmit || !ownerAddress || !publicClient) return;
    setErrorMsg("");

    try {
      setStep("deploying");
      const deployTxHash = await deployContractAsync({
        abi: SPLIT_VAULT_DEPLOY_ABI,
        bytecode: SPLIT_VAULT_BYTECODE,
        args: [ownerAddress as `0x${string}`],
      });

      const deployReceipt = await publicClient.waitForTransactionReceipt({
        hash: deployTxHash,
      });

      const vaultAddress = deployReceipt.contractAddress;
      if (!vaultAddress) throw new Error("Deployment did not return a contract address");

      setStep("initializing");
      const wallets_ = rows.map((r) => r.wallet as `0x${string}`);
      const percentages = rows.map((r) => BigInt(Math.round(parseFloat(r.percentage) * 100)));
      const roles = rows.map((r) => r.role.trim());

      const initTxHash = await writeContractAsync({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "initialize",
        args: [name.trim(), usdcAddress as `0x${string}`, wallets_, percentages, roles],
      });
      const initReceipt = await publicClient.waitForTransactionReceipt({ hash: initTxHash });

      setStep("syncing");
      await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId: user!.id,
          name: name.trim(),
          contractAddress: vaultAddress,
          usdcAddress,
          deployBlock: Number(initReceipt.blockNumber),
          contributors: rows.map((r) => ({
            wallet: r.wallet,
            percentage: Math.round(parseFloat(r.percentage) * 100),
            role: r.role.trim(),
          })),
        }),
      });

      setStep("done");
      setTimeout(() => router.push(`/dashboard/${vaultAddress}`), 1000);
    } catch (e: any) {
      setErrorMsg(e?.shortMessage ?? e?.message ?? "Failed to create project");
      setStep("error");
    }
  }

  const busy = step === "deploying" || step === "initializing" || step === "syncing";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-gray-900">BYN Split Pay</span>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← Back
            </a>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Create New Project</h1>
          <p className="text-sm text-gray-500 mt-1">
            Deploys a new SplitVault contract on Arc Testnet and sets up your contributors.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1.5">Project name</label>
            <input
              type="text"
              placeholder="My Music Project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-indigo-400 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1.5">USDC token address</label>
            <input
              type="text"
              value={usdcAddress}
              onChange={(e) => setUsdcAddress(e.target.value)}
              className={`w-full px-3 py-2.5 text-sm font-mono border rounded-xl outline-none transition-colors ${
                usdcAddress && !isAddress(usdcAddress)
                  ? "border-red-300 focus:border-red-400"
                  : "border-gray-200 focus:border-indigo-400"
              }`}
            />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-medium text-gray-700">Contributors</p>

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

        {step === "error" && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
        )}

        <div className="text-xs text-gray-400 bg-white border border-gray-200 rounded-xl px-3 py-2 space-y-1">
          <p>1. Deploy SplitVault contract (signed by your wallet)</p>
          <p>2. Initialize with name, USDC token and contributors</p>
          <p>3. Save project to your dashboard</p>
        </div>

        <button
          onClick={handleCreate}
          disabled={!canSubmit || busy || step === "done"}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {STEP_LABEL[step]}
            </span>
          ) : (
            STEP_LABEL[step]
          )}
        </button>
      </main>
    </div>
  );
}
