export const CLEAR_FAULTS = {
  api_slow_ms: 0, api_slow_probability: 0, api_random_500_probability: 0,
  api_timeout_probability: 0, force_rate_limit: false, webhook_duplicate: false,
  webhook_delay_seconds: 0, webhook_out_of_order: false, webhook_force_failure: false,
};

export const SCENARIO_EXERCISES = [
  { name: "Duplicate delivery", config: { webhook_duplicate: true }, outcome: "Trigger a fresh order event. Expect two deliveries with the same event ID and one durable consumer inbox row. Clear faults afterward; queued deliveries remain." },
  { name: "Client timeout", config: { api_timeout_probability: 100 }, outcome: "Set the request timeout to 5 seconds and send a read request. The API waits 35 seconds; the client stops waiting first. Clear faults, then retry. Cancelling a mutation does not undo it." },
  { name: "Rate-limit recovery", config: { force_rate_limit: true }, outcome: "Send a signed request and inspect HTTP 429 and quota headers. Forced limiting continues until you clear faults. Then honor any remaining real quota reset before retrying with the same operation key." },
] as const;

export function activeFaults(config: Partial<typeof CLEAR_FAULTS>): string[] {
  return [
    config.api_slow_probability && config.api_slow_ms ? `Slow responses: ${config.api_slow_probability}% / ${config.api_slow_ms}ms` : "",
    config.api_random_500_probability ? `HTTP 500: ${config.api_random_500_probability}%` : "",
    config.api_timeout_probability ? `35-second timeout: ${config.api_timeout_probability}%` : "",
    config.force_rate_limit ? "Forced rate limit" : "",
    config.webhook_duplicate ? "Duplicate webhooks" : "",
    config.webhook_delay_seconds ? `Webhook delay: ${config.webhook_delay_seconds}s` : "",
    config.webhook_out_of_order ? "Out-of-order webhooks" : "",
    config.webhook_force_failure ? "Forced webhook failure" : "",
  ].filter((value): value is string => typeof value === "string" && Boolean(value));
}
