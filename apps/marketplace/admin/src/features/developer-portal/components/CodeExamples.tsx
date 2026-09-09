import type { RequestInput } from "../lib/preparedRequest";
import type { PortalEndpoint } from "../types";
import { buildNodeExample } from "../lib/nodeExample";
import { CodeSnippet } from "./CodeSnippet";

interface CodeExamplesProps {
  endpoint: PortalEndpoint;
  input?: RequestInput;
}

export function CodeExamples({ endpoint, input }: CodeExamplesProps) {
  return (
    <section className="code-examples">
      <h3>Export this request to Node.js</h3>
      <p>Uses the current edited path, query, raw body, and operation key. Set the credential environment variables and run with Node 20+ or Bun. Authentication timestamps and signatures are regenerated on every attempt; keep the same idempotency key when retrying. Never share a response that contains one-time secrets.</p>
      <CodeSnippet value={buildNodeExample(endpoint, input)} language="javascript" />
    </section>
  );
}
