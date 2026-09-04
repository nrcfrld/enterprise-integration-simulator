import { useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { SeedResult } from "@/shared/types/controlPlane";

interface UseSeedShopOptions {
  shopID: string;
  token: string | null | undefined;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export function useSeedShop({
  shopID,
  token,
  onRefresh,
  onNotice,
  onError,
}: UseSeedShopOptions) {
  const [isSeeding, setIsSeeding] = useState(false);

  const resetShop = async () => {
    if (!shopID || !window.confirm("Reset this shop to its seed data?")) return;
    setIsSeeding(true);
    try {
      const result = await controlPlaneRequest<SeedResult>(
        `/control/v1/shops/${shopID}/reset`,
        token,
        { method: "POST" },
      );
      await onRefresh();
      onNotice(
        `Seed complete: ${result.products_seeded} products and ${result.orders_seeded} orders. Create a credential from Credentials when you need a new one-time secret.`,
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
