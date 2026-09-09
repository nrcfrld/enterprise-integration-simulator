import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../data/endpoints";
import { buildNodeExample } from "../lib/nodeExample";

describe("developer portal Node.js examples", () => {
  it("adds an idempotency key to every retry-safe mutation across all provider contracts", () => {
    for (const endpoint of ENDPOINTS.filter((value) => value.idempotent)) {
      expect(buildNodeExample(endpoint), endpoint.id).toContain(
        '"Idempotency-Key": process.env.IDEMPOTENCY_KEY',
      );
    }
  });

  it("does not add an idempotency key to read-only requests, including POST searches", () => {
    for (const endpoint of ENDPOINTS.filter((value) => !value.idempotent)) {
      expect(buildNodeExample(endpoint), endpoint.id).not.toContain(
        '"Idempotency-Key": process.env.IDEMPOTENCY_KEY',
      );
    }
  });
});
