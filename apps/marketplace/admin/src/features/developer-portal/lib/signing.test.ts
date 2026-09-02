import { describe, expect, it } from "vitest";
import {
  buildCanonicalRequest,
  buildShopeeCanonicalRequest,
  buildTokopediaSigningInput,
  prettyJSON,
} from "./signing";

describe("developer portal signing helpers", () => {
  it("keeps the query string outside the canonical request", () => {
    expect(buildCanonicalRequest("GET", "/api/v1/webhooks", "1700000000", "")).toBe(
      "GET/api/v1/webhooks1700000000",
    );
  });

  it("formats JSON responses without changing non-JSON error bodies", () => {
    expect(prettyJSON('{"ok":true}')).toBe('{\n  "ok": true\n}');
    expect(prettyJSON("upstream unavailable")).toBe("upstream unavailable");
  });

  it("uses each provider's documented signing input", () => {
    expect(buildShopeeCanonicalRequest("partner_1", "/api/shopee/v1/orders", "1700000000", "")).toBe(
      "partner_1/api/shopee/v1/orders1700000000",
    );
    expect(buildTokopediaSigningInput(
      "/api/tokopedia/v202309/products/search",
      new URLSearchParams("timestamp=1700000000&app_key=app_1&sign=ignored"),
      '{"page_size":20}',
    )).toBe('/api/tokopedia/v202309/products/searchapp_keyapp_1timestamp1700000000{"page_size":20}');
  });
});
