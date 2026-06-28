"use client";

import { useCallback, useEffect, useState } from "react";

interface Contributor {
  id: string;
  wallet: string | null;
  percentage: number;
  role: string;
  status: "PENDING" | "CLAIMED";
  inviteToken?: string;
}

interface DbProjectDashboardProps {
  address: string; // synthetic db_ id
  ownerPrivyId: string;
}

export function DbProjectDashboard({ address, ownerPrivyId }: DbProjectDashboardProps) {
  const [name, setName] = useState("");
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState("");
  const [invitePct, setInvitePct] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/project?contractAddress=${address}`);
      const data = await res.json();
      if (res.ok) {
        setName(data.name);
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
    fetch(`/api/projects?ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`)
      .then((r) => r.json())
      .then((d) =>
        setIsOwner((d.projects ?? []).some((p: any) => p.contractAddress === address))
      )
      .catch(() => {});
  }, [ownerPrivyId, address]);

  const totalPct = contributors.reduce((s, c) => s + c.percentage, 0);

  async function createInvite() {
    setInviteError("");
    const pct = parseFloat(invitePct);
    if (!inviteRole.trim() || !pct || pct <= 0) {
      setInviteError("Enter a role and a percentage greater than 0.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPrivyId,
          contractAddress: address,
          role: inviteRole.trim(),
          percentage: Math.round(pct * 100),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create invite");
      setInviteRole("");
      setInvitePct("");
      setShowInvite(false);
      await load();
    } catch (e: any) {
      setInviteError(e.message ?? "Failed to create invite");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token: string) {
    await fetch(`/api/invite/${token}?ownerPrivyId=${ownerPrivyId}`, { method: "DELETE" });
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
          <span
            className={`text-xs font-medium ${
              totalPct === 10000 ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {(totalPct / 100).toFixed(2)}% / 100%
          </span>
        </div>

        {contributors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">No contributors yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {contributors.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
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
                <span className="text-sm font-semibold text-gray-900">
                  {(c.percentage / 100).toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}

        {isOwner && (
          <div className="px-4 py-3 border-t border-gray-100">
            {showInvite ? (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="role (e.g. artist)"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400"
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
                <div className="flex gap-2">
                  <button
                    onClick={createInvite}
                    disabled={creating}
                    className="flex-1 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors"
                  >
                    {creating ? "Generating..." : "Generate invite link"}
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
                + Invite by Link
              </button>
            )}
          </div>
        )}
      </div>

      {isOwner && contributors.length > 0 && (
        <div className="bg-indigo-50 text-indigo-800 text-xs rounded-xl px-4 py-3">
          Go to{" "}
          <a href="/treasury" className="underline font-medium">
            Treasury
          </a>{" "}
          to distribute funds by %. You can distribute even before everyone has joined — a share is
          reserved for each pending contributor and becomes claimable as soon as they accept their
          invite.
        </div>
      )}
    </div>
  );
}
