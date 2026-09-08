import { useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { SeedResult } from "@/shared/types/controlPlane";

interface UseSeedShopOptions {
  shopID: string;
  shopName?: string;
  token: string | null | undefined;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export function useSeedShop({
  shopID,
  shopName,
  token,
  onRefresh,
  onNotice,
  onError,
}: UseSeedShopOptions) {
  const [isSeeding, setIsSeeding] = useState(false);

  const resetShop = async () => {
    if (!shopID || isSeeding || !window.confirm(`Reset ${shopName || "shop"} (${shopID}) to sample data?\n\nPermanently deletes credentials, webhook registrations and delivery history, orders, packages, shipments, events, products and inventory. Existing API credentials stop working.\n\nCreates 100 products, 50 completed historical orders, an unusable sample credential and a disabled example webhook. Warehouse definitions and scenario settings remain. Create and save a new credential, then configure your receiver again. This cannot be undone.`)) return;
    setIsSeeding(true);
    try {
      const result = await controlPlaneRequest<SeedResult>(
        `/control/v1/shops/${shopID}/reset`,
        token,
        { method: "POST" },
      );
      await onRefresh();
      onNotice(
        `Seed complete: ${result.products_seeded} products and ${result.orders_seeded} orders. Previous credentials and webhook history were deleted. Create and save a new credential, revoke the unusable sample credential, and configure your receiver again.`,
      );
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Request failed";
      onError(`Could not seed this shop: ${detail}`);
    } finally {
      setIsSeeding(false);
    }
  };

  return { isSeeding, resetShop };
}
