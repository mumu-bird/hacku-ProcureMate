import type { Need, Product } from "./types";

// Only extract facts explicitly present in the observed merchant title.
// A missing claim is unknown, not proof of the opposite.
export function giftSpecs(product: Product) {
  const match = product.name.match(/(\d+)\s*(?:毫升|ml)/i);
  return {
    capacityMl: match ? Number(match[1]) : null,
    insulationClaimed: /真空|保溫|保温|insulat/i.test(product.name),
    sourceUrl: product.sourceUrl,
    observedAt: product.observedAt,
    basis: "商品标题明确标注；不是完整型号兼容性认证",
  };
}
export function unmetRequirements(product: Product, need: Need): string[] {
  if (need.scenario === "event") {
    const reasons: string[] = [];
    if (product.category !== "gift") reasons.push("不是批准的礼品品类");
    const specs = giftSpecs(product);
    if (
      need.minCapacityMl &&
      (specs.capacityMl === null || specs.capacityMl < need.minCapacityMl)
    )
      reasons.push(
        specs.capacityMl === null
          ? "容量未在来源标题中确认"
          : `容量 ${specs.capacityMl} ml 低于所需 ${need.minCapacityMl} ml`,
      );
    if (need.requiresInsulated && !specs.insulationClaimed)
      reasons.push("来源标题未确认保温能力；不猜测符合要求");
    return reasons;
  }
  if (need.scenario === "replenishment")
    return product.id === need.sku && product.category === "consumable"
      ? []
      : ["不是指定补货商品"];
  const reasons: string[] = [];
  if (!product.tags.includes(need.job)) reasons.push("不在当前岗位模板内");
  if (!product.connector || !need.connectors.includes(product.connector))
    reasons.push("不符合指定设备接口");
  return reasons;
}
