"use client";

import Logo from "@/components/Logo";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { formatUnits, type Address } from "viem";
import { USDC_ADDRESS } from "@/lib/contract";

const ARC_CHAIN_PARAMS = {
  chainId: "0x4cf4d2", // 5042002
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

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

interface StreamItem {
  id: string;
  projectName: string;
  total: string;
  accrued: string;
  claimed: string;
  claimable: string;
  startAt: string;
  endAt: string;
  status: "ACTIVE" | "CANCELED";
}

export default function CabinetPage() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const [claimable, setClaimable] = useState<bigint>(0n);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [streams, setStreams] = useState<StreamItem[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [walletMsg, setWalletMsg] = useState("");

  const walletAddress = wallets[0]?.address as Address | undefined;

  async function addArcNetwork() {
    setWalletMsg("");
    try {
      const provider: any = await wallets[0]?.getEthereumProvider();
      if (!provider) throw new Error("No wallet provider");
      await provider.request({ method: "wallet_addEthereumChain", params: [ARC_CHAIN_PARAMS] });
      setWalletMsg("Arc Testnet added to your wallet ✓");
    } catch (e: any) {
      setWalletMsg(e?.message ?? "Your wallet didn't add the network — you can add it manually.");
    }
  }

  async function addUsdcToken() {
    setWalletMsg("");
    try {
      const provider: any = await wallets[0]?.getEthereumProvider();
      if (!provider) throw new Error("No wallet provider");
      await provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: USDC_ADDRESS, symbol: "USDC", decimals: 6 } },
      });
      setWalletMsg("USDC added to your wallet ✓");
    } catch (e: any) {
      setWalletMsg(e?.message ?? "Your wallet didn't add the token — you can add it manually.");
    }
  }

  async function loadCabinet() {
    if (!walletAddress) return;
    try {
      const res = await authedFetch(`/api/cabinet?wallet=${walletAddress}`);
      const data = await res.json();
      if (res.ok) {
        setClaimable(BigInt(data.claimable ?? "0"));
        setPayouts(data.payouts ?? []);
        setStreams(data.streams ?? []);
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
      const res = await authedFetch("/api/cabinet/claim", {
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
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not signed in — explain and offer login.
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm space-y-5 text-center">
          <h1 className="text-xl font-semibold text-stone-900">Your payouts</h1>
          <p className="text-sm text-stone-500">
            Sign in to see what you&apos;ve earned and send it to your wallet. No crypto experience
            needed — we&apos;ll create a wallet for you automatically if you don&apos;t have one.
          </p>
          <button
            onClick={login}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const claimableFormatted = parseFloat(formatUnits(claimable, 6)).toFixed(2);

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-2 font-semibold text-stone-900 hover:text-emerald-700 transition-colors"><Logo className="h-6 w-6" />SplitPort</a>
          <button onClick={logout} className="text-sm text-stone-400 hover:text-stone-600 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Your cabinet</h1>
          <p className="text-sm text-stone-500 mt-1">
            Money you&apos;ve earned across projects, ready to send to your wallet.
          </p>
        </div>

        {banner && (
          <div className="bg-emerald-50 text-emerald-700 text-sm rounded-xl px-4 py-3">{banner}</div>
        )}
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4">
          <div>
            <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Available to claim</p>
            <p className="text-3xl font-semibold text-stone-900">
              {claimableFormatted}
              <span className="text-base text-stone-400 ml-1.5">USDC</span>
            </p>
          </div>

          <div className="bg-emerald-50 text-emerald-800 text-xs rounded-xl px-4 py-3 space-y-1">
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
              <p className="text-xs text-stone-400 mb-1">Your wallet</p>
              <p className="text-xs text-stone-600 font-mono break-all">{walletAddress}</p>
            </div>
          )}

          <button
            onClick={handleClaim}
            disabled={claiming || claimable === 0n}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-medium rounded-xl transition-colors text-sm"
          >
            {claiming
              ? "Sending to your wallet..."
              : claimable === 0n
              ? "Nothing to claim yet"
              : `Claim ${claimableFormatted} USDC`}
          </button>
        </div>

        {streams.filter((s) => s.status === "ACTIVE").length > 0 && (
          <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
            <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">Streaming in</p>
            {streams
              .filter((s) => s.status === "ACTIVE")
              .map((s) => {
                const total = BigInt(s.total);
                const accrued = BigInt(s.accrued);
                const pct = total > 0n ? Number((accrued * 10000n) / total) / 100 : 0;
                return (
                  <div key={s.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-stone-800">{s.projectName}</p>
                      <p className="text-sm font-semibold text-emerald-700">
                        +{parseFloat(formatUnits(BigInt(s.claimable), 6)).toFixed(2)} USDC
                      </p>
                    </div>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 rounded-full transition-all"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-stone-400">
                      {parseFloat(formatUnits(accrued, 6)).toFixed(2)} of{" "}
                      {parseFloat(formatUnits(total, 6)).toFixed(2)} USDC accrued · until{" "}
                      {new Date(s.endAt).toLocaleDateString()}
                    </p>
                  </div>
                );
              })}
            <p className="text-xs text-stone-400">
              This keeps growing every second. Claim anytime — it&apos;s included in your total above.
            </p>
          </div>
        )}

        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
          <div>
            <p className="text-sm font-medium text-stone-900">See your money in your wallet</p>
            <p className="text-sm text-stone-500 mt-0.5">
              Add the Arc Testnet network and the USDC token so your balance shows up in Trust,
              MetaMask, or your wallet app.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={addArcNetwork}
              className="py-2.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-medium rounded-xl transition-colors"
            >
              Add Arc network
            </button>
            <button
              onClick={addUsdcToken}
              className="py-2.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-medium rounded-xl transition-colors"
            >
              Add USDC token
            </button>
          </div>
          {walletMsg && <p className="text-xs text-stone-500">{walletMsg}</p>}
          <p className="text-xs text-stone-400">
            Using the built-in wallet? Your balance is always shown here — adding to an app is only
            needed for external wallets.
          </p>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">History</p>
          </div>
          {payouts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-stone-400 text-center">No payouts yet.</p>
          ) : (
            payouts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-4 py-3 border-b border-stone-50 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900 truncate">{p.projectName}</p>
                  {p.status === "CLAIMED" && p.txHash ? (
                    <a
                      href={`https://testnet.arcscan.app/tx/${p.txHash.split("-")[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-600 hover:text-emerald-800"
                    >
                      claimed ↗
                    </a>
                  ) : (
                    <span className="text-xs text-amber-600">pending</span>
                  )}
                </div>
                <span className="text-sm font-medium text-stone-900 whitespace-nowrap">
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
