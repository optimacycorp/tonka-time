import { env } from "./config.js";

export const coreCities = new Set([
  "colorado springs",
  "fountain",
  "security-widefield",
  "falcon",
  "peyton",
  "monument",
  "black forest",
  "manitou springs",
]);

export function isFriday(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.getUTCDay() === 5;
}

export function weekendEndDate(startDate: string) {
  const date = new Date(`${startDate}T00:00:00`);
  date.setUTCDate(date.getUTCDate() + 3);
  return date.toISOString().slice(0, 10);
}

export function classifyDeliveryZone(city: string) {
  const normalizedCity = city.trim().toLowerCase();
  if (coreCities.has(normalizedCity)) {
    return { zone: "CORE", deliveryFeeCents: env.CORE_DELIVERY_FEE_CENTS, requiresReview: false };
  }
  if (normalizedCity.includes("el paso")) {
    return { zone: "EXTENDED", deliveryFeeCents: env.EXTENDED_DELIVERY_BASE_FEE_CENTS, requiresReview: true };
  }
  return { zone: "MANUAL_REVIEW", deliveryFeeCents: env.EXTENDED_DELIVERY_BASE_FEE_CENTS, requiresReview: true };
}

export function calculatePricing({
  deliveryFeeCents,
  damageWaiverChoice,
}: {
  deliveryFeeCents: number;
  damageWaiverChoice: "ACCEPTED" | "DECLINED" | "UNDECIDED";
}) {
  const damageWaiverFeeCents = damageWaiverChoice === "ACCEPTED" ? env.DAMAGE_WAIVER_FEE_CENTS : 0;
  const rentalSubtotalCents = env.WEEKEND_PRICE_CENTS;
  const depositCents = env.DEPOSIT_CENTS;
  const totalDueCents = rentalSubtotalCents + deliveryFeeCents + damageWaiverFeeCents + depositCents;
  return {
    rentalSubtotalCents,
    deliveryFeeCents,
    damageWaiverFeeCents,
    depositCents,
    taxCents: 0,
    totalDueCents,
  };
}
