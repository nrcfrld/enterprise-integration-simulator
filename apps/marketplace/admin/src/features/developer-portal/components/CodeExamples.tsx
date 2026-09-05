import type { PortalEndpoint } from "../types";
import { buildNodeExample } from "../lib/nodeExample";
import { CodeSnippet } from "./CodeSnippet";

interface CodeExamplesProps {
  endpoint: PortalEndpoint;
}

export function CodeExamples({ endpoint }: CodeExamplesProps) {
  return (
    <section className="code-examples">
      <h3>Run this exact request from Node.js</h3>
      <p>Replace path and body example identifiers (including package_id and order_item_id) with returned IDs, set the environment variables, then run the file with Node 20+ or Bun. The signing input matches the simulator.</p>
      <CodeSnippet value={buildNodeExample(endpoint)} language="javascript" />
    </section>
  );
}
