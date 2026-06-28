"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { formatUnits, type Address } from "viem";

interface PayoutItem {
  id: string;
  projectName: string;
  amount: string;
  status: "PENDING" | "CLAIMED";
  netAmount: string | null;
  feeAmount: string | null;
  txHash: string | null;
  createdAt: string;
  claimedAt: string | null;
}

export default function CabinetPage() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const [claimable, setClaimable] = useState<bigint>(0n);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");

  const walletAddress = wallets[0]?.address as Address | undefined;

  async function loadCabinet() {
    if (!walletAddress) return;
    try {
      const res = await fetch(`/api/cabinet?wallet=${walletAddress}`);
      const data = await res.json();
      if (res.ok) {
        setClaimable(BigInt(data.claimable ?? "0"));
        setPayouts(data.payouts ?? []);
      }
    } catch {}
  }

  useEffect(() => {
    if (!ready || !authenticated || !walletAddress) return;
    loadCabinet();
    const interval = setInterval(loadCabinet, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, walletAddress]);

  async function handleClaim() {
    if (!walletAddress || claimable === 0n) return;
    setError("");
    setBanner("");
    setClaiming(true);
    try {
      const res = await fetch("/api/cabinet/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Claim failed");
      const net = parseFloat(formatUnits(BigInt(data.net), 6)).toFixed(2);
      setBanner(`Sent ${net} USDC to your wallet. ✓`);
      await loadCabinet();
    } catch (e: any) {
      setError(e.message ?? "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not signed in — explain and offer login.
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm space-y-5 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Your payouts</h1>
          <p className="text-sm text-gray-500">
            Sign in to see what you've earned and send it to your wallet. No crypto experience
            needed — we'll create a wallet for you automatically if you don't have one.
          </p>
          <button
            onClick={login}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const claimableFormatted = parseFloat(formatUnits(claimable, 6)).toFixed(2);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-gray-900">BYN Split Pay</span>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Your cabinet</h1>
          <p className="text-sm text-gray-500 mt-1">
            Money you've earned across projects, ready to send to your wallet.
          </p>
        </div>

        {banner && (
          <div className="bg-emerald-50 text-emerald-700 text-sm rounded-xl px-4 py-3">{banner}</div>
        )}
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Available to claim</p>
            <p className="text-3xl font-semibold text-gray-900">
              {claimableFormatted}
              <span className="text-base text-gray-400 ml-1.5">USDC</span>
            </p>
          </div>

          <div className="bg-indigo-50 text-indigo-800 text-xs rounded-xl px-4 py-3 space-y-1">
            <p className="font-medium">How getting paid works</p>
            <p>
              When you press <b>Claim</b>, your USDC is sent to your crypto wallet (Trust, MetaMask,
              or the built-in wallet we created for you).
            </p>
            <p>
              A small network fee for the transfer is taken out of your amount — so you receive your
              share minus that fee, with nothing to pay upfront.
            </p>
          </div>

          {walletAddress && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Your wallet</p>
              <p className="text-xs text-gray-600 font-mono break-all">{walletAddress}</p>
            </div>
          )}

          <button
            onClick={handleClaim}
            disabled={claiming || claimable === 0n}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
          >
            {claiming
              ? "Sending to your wallet..."
              : claimable === 0n
              ? "Nothing to claim yet"
              : `Claim ${claimableFormatted} USDC`}
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">History</p>
          </div>
          {payouts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No payouts yet.</p>
          ) : (
            payouts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.projectName}</p>
                  {p.status === "CLAIMED" && p.txHash ? (
                    <a
                      href={`https://testnet.arcscan.app/tx/${p.txHash.split("-")[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      claimed ↗
                    </a>
                  ) : (
                    <span className="text-xs text-amber-600">pending</span>
                  )}
                </div>
                <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                  {parseFloat(formatUnits(BigInt(p.amount), 6)).toFixed(2)} USDC
                </span>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
