import { useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-go";
import "prismjs/components/prism-json";

interface CodeSnippetProps {
  value: string;
  language?: "javascript" | "bash" | "go" | "json" | "text";
}

const highlight = (value: string, language: CodeSnippetProps["language"]): string =>
  Prism.highlight(value, Prism.languages[language ?? "javascript"] ?? Prism.languages.plain, language ?? "javascript");

export function CodeSnippet({ value, language = "javascript" }: CodeSnippetProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="portal-code">
      <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
      <pre className={`language-${language}`}>
        <code dangerouslySetInnerHTML={{ __html: highlight(value, language) }} />
      </pre>
    </div>
  );
}
