// frontend/app/api/treasury/schedule/run/route.ts
// GET /api/treasury/schedule/run — invoked by Vercel Cron (see vercel.json) once a
// day. Runs every active auto-payout schedule whose nextRunAt is due: distributes
// the fixed amount from the treasury across the project's contributors, then
// advances nextRunAt (WEEKLY/MONTHLY) or deactivates it (CUSTOM one-shot).
// If a run can't complete (e.g. insufficient treasury balance), the schedule is
// left untouched so the next daily cron retries it.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runDistribution, DistributionError } from "@/lib/distribute";
import { advanceFrom, type Frequency } from "@/lib/schedule";

export async function GET(request: NextRequest) {
  // If CRON_SECRET is configured, require it (Vercel sends it as a Bearer token).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const now = new Date();
    const due = await prisma.payoutSchedule.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      include: { project: { select: { contractAddress: true, name: true } } },
    });

    const results: Array<{
      projectId: string;
      contractAddress: string;
      status: "distributed" | "skipped" | "error";
      detail?: string;
      distributed?: string;
    }> = [];

    for (const schedule of due) {
      try {
        const result = await runDistribution({
          contractAddress: schedule.project.contractAddress,
          amountUsdc: schedule.amount,
        });

        if (schedule.frequency === "CUSTOM") {
          // One-shot: mark done and turn off.
          await prisma.payoutSchedule.update({
            where: { id: schedule.id },
            data: { active: false, lastRunAt: now },
          });
        } else {
          // Advance from the scheduled time (not from `now`) so the cadence stays
          // anchored even if the cron fires a little late.
          let nextRunAt = advanceFrom(schedule.nextRunAt, schedule.frequency as Frequency);
          // Don't leave nextRunAt in the past if multiple intervals were missed.
          while (nextRunAt <= now) {
            nextRunAt = advanceFrom(nextRunAt, schedule.frequency as Frequency);
          }
          await prisma.payoutSchedule.update({
            where: { id: schedule.id },
            data: { nextRunAt, lastRunAt: now },
          });
        }

        results.push({
          projectId: schedule.projectId,
          contractAddress: schedule.project.contractAddress,
          status: "distributed",
          distributed: result.distributed.toString(),
        });
      } catch (e: any) {
        // Insufficient balance / config issues: leave the schedule due so the
        // next daily cron retries once funded.
        const isExpected = e instanceof DistributionError;
        if (!isExpected) {
          console.error("[schedule/run]", schedule.id, e);
        }
        results.push({
          projectId: schedule.projectId,
          contractAddress: schedule.project.contractAddress,
          status: isExpected ? "skipped" : "error",
          detail: e?.message,
        });
      }
    }

    return NextResponse.json({ ran: results.length, results });
  } catch (error: any) {
    console.error("[GET /api/treasury/schedule/run]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
