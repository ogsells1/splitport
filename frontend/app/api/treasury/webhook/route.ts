// frontend/app/api/treasury/webhook/route.ts
// POST /api/treasury/webhook - Stripe webhook. On checkout.session.completed,
// mark the matching treasury deposit CONFIRMED (idempotent on stripeSessionId).
//
// Stripe requires the raw request body for signature verification, so we read
// request.text() and never parse it as JSON beforehand.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error("[treasury/webhook] signature verification failed", err?.message);
    return NextResponse.json({ error: `Webhook Error: ${err?.message}` }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { id: string };

      const deposit = await prisma.treasuryDeposit.findUnique({
        where: { stripeSessionId: session.id },
      });

      if (deposit && deposit.status !== "CONFIRMED") {
        await prisma.treasuryDeposit.update({
          where: { id: deposit.id },
          data: { status: "CONFIRMED", confirmedAt: new Date() },
        });
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as { id: string };
      await prisma.treasuryDeposit.updateMany({
        where: { stripeSessionId: session.id, status: "PENDING" },
        data: { status: "FAILED" },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[treasury/webhook] handler error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
