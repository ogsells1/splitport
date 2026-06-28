// frontend/app/api/treasury/checkout/route.ts
// POST /api/treasury/checkout — create a Stripe Checkout Session for a card top-up.
// On testnet we use a fixed 1 USD = 1 USDC rate. The actual treasury credit happens
// in the webhook (checkout.session.completed), not here.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Card payments are not configured (missing STRIPE_SECRET_KEY)." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { userPrivyId, amountUsd } = body;

    const amount = Number(amountUsd);
    if (!userPrivyId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "userPrivyId and a positive amountUsd are required" }, { status: 400 });
    }

    // 1 USD = 1 USDC (6 decimals) on testnet.
    const amountUsdc = BigInt(Math.round(amount * 1_000_000));
    const unitAmount = Math.round(amount * 100); // Stripe expects cents

    const user = await prisma.user.upsert({
      where: { privyId: userPrivyId },
      update: {},
      create: { privyId: userPrivyId },
    });

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: { name: "Treasury top-up (USDC)" },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/treasury?status=success`,
      cancel_url: `${origin}/treasury?status=cancelled`,
      metadata: { userId: user.id, amountUsdc: amountUsdc.toString() },
    });

    await prisma.treasuryDeposit.create({
      data: {
        userId: user.id,
        source: "CARD",
        amount: amountUsdc,
        status: "PENDING",
        stripeSessionId: session.id,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("[POST /api/treasury/checkout]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
