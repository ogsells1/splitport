"use client";

import { Suspense, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUnits, parseUnits, getAddress, type Address } from "viem";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";
import { TreasuryAllocateRow } from "@/components/TreasuryAllocateRow";

const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;

interface Deposit {
  id: string;
  source: "CARD" | "CRYPTO";
  amount: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  txHash: string | null;
  createdAt: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  contractAddress: string;
}

export default function TreasuryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TreasuryInner />
    </Suspense>
  );
}

function TreasuryInner() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [balance, setBalance] = useState<bigint>(0n);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [cardAmount, setCardAmount] = useState("");
  const [cryptoAmount, setCryptoAmount] = useState("");
  const [cardBusy, setCardBusy] = useState(false);
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");

  const { writeContractAsync } = useWriteContract();
  const [pendingTx, setPendingTx] = useState<`0x${string}` | undefined>();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: pendingTx });

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  const status = searchParams.get("status");
  useEffect(() => {
    if (status === "success") setBanner("Card payment received — your treasury balance will update shortly.");
    if (status === "cancelled") setBanner("Card payment cancelled.");
  }, [status]);

  async function loadTreasury() {
    if (!user) return;
    try {
      const res = await fetch(`/api/treasury?userPrivyId=${encodeURIComponent(user.id)}`);
      const data = await res.json();
      setBalance(BigInt(data.balance ?? "0"));
      setDeposits(data.deposits ?? []);
    } catch {}
  }

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    loadTreasury();
    const interval = setInterval(loadTreasury, 8000);
    return () => clearInterval(interval);
  }, [ready, authenticated, user]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    fetch(`/api/projects?ownerPrivyId=${encodeURIComponent(user.id)}`)
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, [ready, authenticated, user]);

  // When the on-chain USDC transfer confirms, report it to the backend.
  useEffect(() => {
    if (!receipt || !pendingTx || !user) return;
    (async () => {
      try {
        const res = await fetch("/api/treasury/deposit-crypto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userPrivyId: user.id, txHash: pendingTx }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to credit deposit");
        setBanner("Crypto top-up confirmed.");
        setCryptoAmount("");
        await loadTreasury();
      } catch (e: any) {
        setError(e.message ?? "Failed to credit deposit");
      } finally {
        setPendingTx(undefined);
        setCryptoBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

  async function handleCard() {
    setError("");
    const amount = parseFloat(cardAmount);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setCardBusy(true);
    try {
      const res = await fetch("/api/treasury/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrivyId: user!.id, amountUsd: amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start checkout");
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message ?? "Failed to start checkout");
      setCardBusy(false);
    }
  }

  async function handleCrypto() {
    setError("");
    if (!TREASURY_ADDRESS) {
      setError("Crypto top-up is not configured.");
      return;
    }
    const amount = parseFloat(cryptoAmount);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setCryptoBusy(true);
    try {
      const hash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [getAddress(TREASURY_ADDRESS) as Address, parseUnits(String(amount), 6)],
      });
      setPendingTx(hash);
      setBanner("Transfer submitted, waiting for confirmation...");
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "Transfer failed");
      setCryptoBusy(false);
    }
  }

  if (!ready || !authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const balanceFormatted = parseFloat(formatUnits(balance, 6)).toFixed(2);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-gray-900">BYN Split Pay</span>
          <div className="flex items-center gap-3">
            <a href="/balance" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Balance
            </a>
            <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Dashboard
            </a>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Treasury</h1>
          <p className="text-sm text-gray-500 mt-1">
            Top up your platform balance with a card or crypto. Allocating to projects comes next.
          </p>
        </div>

        {banner && (
          <div className="bg-indigo-50 text-indigo-700 text-sm rounded-xl px-4 py-3">{banner}</div>
        )}
        {error && (
          <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
        )}

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Treasury Balance</p>
          <p className="text-3xl font-semibold text-gray-900">
            {balanceFormatted}
            <span className="text-base text-gray-400 ml-1.5">USDC</span>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <p className="font-medium text-gray-900 text-sm">Top up with card</p>
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400">
              <span className="px-2 text-sm text-gray-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={cardAmount}
                onChange={(e) => setCardAmount(e.target.value)}
                className="flex-1 px-1 py-2 text-sm outline-none"
              />
            </div>
            <button
              onClick={handleCard}
              disabled={cardBusy}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
            >
              {cardBusy ? "Redirecting..." : "Pay with card"}
            </button>
          </div>

          {/* Crypto */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <p className="font-medium text-gray-900 text-sm">Top up with crypto</p>
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={cryptoAmount}
                onChange={(e) => setCryptoAmount(e.target.value)}
                className="flex-1 px-2 py-2 text-sm outline-none"
              />
              <span className="px-2 text-sm text-gray-400">USDC</span>
            </div>
            <button
              onClick={handleCrypto}
              disabled={cryptoBusy || !TREASURY_ADDRESS}
              className="w-full py-2.5 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white font-medium rounded-xl transition-colors text-sm"
            >
              {cryptoBusy ? "Confirming..." : "Send USDC"}
            </button>
            {!TREASURY_ADDRESS && (
              <p className="text-xs text-gray-400">Treasury address not configured.</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Allocate to a project
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Moves USDC from your treasury into a project vault (paid by the treasury wallet).
            </p>
          </div>
          {projects.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">
              No projects yet.{" "}
              <a href="/create" className="text-indigo-600 hover:underline">
                Create one
              </a>
              .
            </p>
          ) : (
            projects.map((p) => (
              <TreasuryAllocateRow
                key={p.id}
                name={p.name}
                contractAddress={p.contractAddress as Address}
                userPrivyId={user!.id}
                onAllocated={loadTreasury}
              />
            ))
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Recent top-ups</p>
          </div>
          {deposits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No top-ups yet.</p>
          ) : (
            deposits.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {d.source === "CARD" ? "Card" : "Crypto"}
                  </span>
                  <span
                    className={`text-xs ${
                      d.status === "CONFIRMED"
                        ? "text-emerald-600"
                        : d.status === "PENDING"
                        ? "text-amber-600"
                        : "text-red-500"
                    }`}
                  >
                    {d.status.toLowerCase()}
                  </span>
                </div>
                <span className="text-sm font-medium text-gray-900">
                  {parseFloat(formatUnits(BigInt(d.amount), 6)).toFixed(2)} USDC
                </span>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
