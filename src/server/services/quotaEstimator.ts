import { prisma } from "../db";

const DEFAULT_RESET_MINUTES = 60;

export interface QuotaEstimate {
  nextUsableAt: Date;
  confidence: number;
}

export function computeQuotaWindowMs(observedDurationsMs: number[]) {
  const windowMs =
    observedDurationsMs.length > 0
      ? observedDurationsMs.reduce((sum, item) => sum + item, 0) / observedDurationsMs.length
      : DEFAULT_RESET_MINUTES * 60 * 1000;
  const confidence = Math.min(1, observedDurationsMs.length / 5);

  return {
    windowMs,
    confidence,
  };
}

export async function estimateNextUsableAt(accountId: string, from = new Date()): Promise<QuotaEstimate> {
  const events = await prisma.providerAccountEvent.findMany({
    where: {
      accountId,
      type: {
        in: ["account.exhausted", "account.recovered"],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  let lastExhausted: Date | null = null;
  const observedDurationsMs: number[] = [];

  for (const event of events) {
    if (event.type === "account.exhausted") {
      lastExhausted = event.createdAt;
      continue;
    }

    if (event.type === "account.recovered" && lastExhausted) {
      observedDurationsMs.push(event.createdAt.getTime() - lastExhausted.getTime());
      lastExhausted = null;
    }
  }

  const computed = computeQuotaWindowMs(observedDurationsMs);

  return {
    nextUsableAt: new Date(from.getTime() + computed.windowMs),
    confidence: computed.confidence,
  };
}
