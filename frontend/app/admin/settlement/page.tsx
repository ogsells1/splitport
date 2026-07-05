"use client";

import { useEffect, useState } from "react";

type Status = {
  envMode: string;
  override: "custodial" | "circle" | null;
  activeMode: string;
  circleBalance: string | null;
};

export default function SettlementAdminPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("splitport-admin-token");
    if (saved) setToken(saved);
  }, []);

  async function refresh(t: string) {
    setError(null);
    const res = await fetch("/api/admin/settlement-mode", {
      headers: { "x-admin-token": t },
    });
    if (!res.ok) {
      setStatus(null);
      setError(res.status === 401 ? "Invalid admin token" : `Error ${res.status}`);
      return;
    }
    setStatus(await res.json());
  }

  async function setMode(mode: "custodial" | "circle" | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settlement-mode", {
        method: "POST",
        headers: { "x-admin-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await refresh(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    localStorage.setItem("splitport-admin-token", token);
    refresh(token);
  }

  const usdc = status?.circleBalance ? (Number(status.circleBalance) / 1_000_000).toFixed(6) : "-";

  return (
    <main style={{ maxWidth: 480, margin: "60px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Settlement mode (demo)</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="password"
          placeholder="Admin token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={{ flex: 1, padding: 8, border: "1px solid #d6d3d1", borderRadius: 6 }}
        />
        <button onClick={connect} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #047857", background: "#047857", color: "#fff" }}>
          Connect
        </button>
      </div>

      {error && <p style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</p>}

      {status && (
        <div style={{ border: "1px solid #d6d3d1", borderRadius: 8, padding: 16 }}>
          <p style={{ margin: "0 0 8px" }}>
            <strong>Active signer:</strong> {status.activeMode}
          </p>
          <p style={{ margin: "0 0 8px", color: "#78716c", fontSize: 13 }}>
            CUSTODY_MODE env: {status.envMode} · override: {status.override ?? "none"}
          </p>
          <p style={{ margin: "0 0 16px" }}>
            <strong>Circle wallet balance:</strong> {usdc} USDC
          </p>

          {status.envMode === "onchain" ? (
            <p style={{ color: "#78716c", fontSize: 13 }}>
              CUSTODY_MODE=onchain uses the vault signer directly; this toggle only
              applies when CUSTODY_MODE is custodial.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={busy}
                onClick={() => setMode("custodial")}
                style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #d6d3d1", background: status.activeMode === "custodial" ? "#f5f5f4" : "#fff" }}
              >
                Use viem executor
              </button>
              <button
                disabled={busy}
                onClick={() => setMode("circle")}
                style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #d6d3d1", background: status.activeMode === "circle" ? "#f5f5f4" : "#fff" }}
              >
                Use Circle Wallet
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
