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
      <p>Replace a path placeholder with an id from the list response, set the environment variables, then run the file with Node 20+ or Bun. The signing input matches the simulator.</p>
      <CodeSnippet value={buildNodeExample(endpoint)} language="javascript" />
    </section>
  );
}
