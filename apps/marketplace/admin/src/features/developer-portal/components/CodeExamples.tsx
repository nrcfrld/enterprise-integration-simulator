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
      <details>
        <summary>
          <span><strong>Export this request to Node.js</strong><small>Ready-to-run example using the current request</small></span>
        </summary>
        <div className="code-examples__content">
          <p>Set the credential environment variables and run with Node 20+ or Bun. The example uses the current path, query, body, and operation key. Keep the same idempotency key when retrying, and never share one-time secrets.</p>
          <CodeSnippet value={buildNodeExample(endpoint, input)} language="javascript" />
        </div>
      </details>
    </section>
  );
}
