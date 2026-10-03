import observedPolicy from "../data/merchant-policy.json";
export const shippingPolicy = observedPolicy;
export function shippingCents(subtotalCents: number) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0)
    throw Error("商品净额无效。");
  // Test checkout contains only regular cash-priced goods, no coupon/points
  // deduction or membership-based waiver. Exceptional fulfillment is unverified.
  return subtotalCents >= shippingPolicy.freeDeliveryThresholdCents
    ? 0
    : shippingPolicy.baseDeliveryCents;
}
