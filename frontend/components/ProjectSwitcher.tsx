"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { useRouter } from "next/navigation";

interface ProjectSummary {
  id: string;
  name: string;
  contractAddress: string;
  contributorCount: number;
}

interface ProjectSwitcherProps {
  ownerPrivyId: string;
  currentAddress: string;
}

export function ProjectSwitcher({ ownerPrivyId, currentAddress }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authedFetch(`/api/projects?ownerPrivyId=${encodeURIComponent(ownerPrivyId)}`)
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .finally(() => setLoading(false));
  }, [ownerPrivyId]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const current = projects.find(
    (p) => p.contractAddress.toLowerCase() === currentAddress.toLowerCase()
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-stone-900 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-lg transition-colors"
      >
        {loading ? "Loading..." : current?.name ?? "Select project"}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-50">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-64 bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden z-50">
          <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
            {projects.length === 0 && !loading && (
              <p className="px-4 py-3 text-sm text-stone-400">No projects yet</p>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setOpen(false);
                  router.push(`/dashboard/${p.contractAddress}`);
                }}
                className={`w-full text-left px-4 py-2.5 hover:bg-stone-50 transition-colors ${
                  p.contractAddress.toLowerCase() === currentAddress.toLowerCase()
                    ? "bg-emerald-50"
                    : ""
                }`}
              >
                <p className="text-sm font-medium text-stone-900">{p.name}</p>
                <p className="text-xs text-stone-400 font-mono mt-0.5">
                  {p.contractAddress.startsWith("db_")
                    ? `${p.contributorCount} contributors`
                    : `${p.contractAddress.slice(0, 8)}...${p.contractAddress.slice(-6)} · ${p.contributorCount} contributors`}
                </p>
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              router.push("/create");
            }}
            className="w-full text-left px-4 py-3 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors border-t border-stone-100"
          >
            + New Project
          </button>
        </div>
      )}
    </div>
  );
}
