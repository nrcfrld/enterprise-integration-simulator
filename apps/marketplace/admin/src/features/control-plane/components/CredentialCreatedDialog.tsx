import { type RefObject, useEffect, useRef, useState } from "react";
import type { CreatedCredential, Shop } from "@/shared/types/controlPlane";
import { AccessibleDialog } from "./AccessibleDialog";

type CopyState = "idle" | "copied" | "error";

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="m7.5 12.5 3 3 6.5-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CredentialValue({ label, value }: { label: string; value: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    timer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <div className="credential-value">
      <div className="credential-value-heading">
        <span>{label}</span>
        <span className={`copy-feedback ${copyState}`} aria-live="polite">
          {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : ""}
        </span>
      </div>
      <div className="credential-value-control">
        <code>{value}</code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          <CopyIcon />
          Copy
        </button>
      </div>
    </div>
  );
}

export function CredentialCreatedDialog({
  credential,
  shop,
  onUseInSimulator,
  onClose,
  returnFocusRef,
}: {
  credential: CreatedCredential;
  shop?: Shop;
  onUseInSimulator?: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const initialFocusRef = useRef<HTMLHeadingElement>(null);
  const values = [
    ["Client ID", credential.client_id],
    ["Client secret", credential.client_secret],
    ...(credential.access_token ? [["Access token", credential.access_token]] : []),
  ] as const;

  return (
    <AccessibleDialog
      ariaDescribedby="credential-dialog-description"
      ariaLabelledby="credential-dialog-title"
      backdropClassName="modal modal-open credential-dialog-backdrop"
      className="modal-box credential-dialog"
      initialFocusRef={initialFocusRef}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
        <header className="credential-dialog-heading">
          <span className="credential-dialog-icon"><SuccessIcon /></span>
          <div>
            <h2 id="credential-dialog-title" ref={initialFocusRef} tabIndex={-1}>Credential created</h2>
            <p id="credential-dialog-description">Copy these values now. The secret and access token cannot be shown again.</p>
          </div>
        </header>

        {shop && <p>Shop: <b>{shop.name}</b> · {shop.provider_profile} · <code>{shop.id}</code></p>}
        <div className="credential-values">
          {values.map(([label, value]) => <CredentialValue key={label} label={label} value={value} />)}
        </div>

        <p className="credential-security-note">
          Use in simulator transfers these values only in memory and returns to your request. Save a separate copy in a password manager or secret vault. The access token is required only for Tokopedia-like requests.
        </p>

        <footer className="credential-dialog-actions">
          {onUseInSimulator && <button type="button" className="btn btn-primary" onClick={onUseInSimulator}>Use in simulator</button>}
          <button type="button" className="btn btn-primary" onClick={onClose}>I saved these credentials</button>
        </footer>
    </AccessibleDialog>
  );
}
