import { useEffect, useRef, useState } from "react";
import { controlPlaneCollection } from "@/shared/api/controlPlaneCollection";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { Shop } from "@/shared/types/controlPlane";
import { AccessibleDialog } from "./AccessibleDialog";

type Credential = { id: string; client_id: string; status: string; created_at: string };
export function CredentialRevocation({ id, shop, token, onClose, onRevoked }: {
  id: string; shop: Shop; token?: string | null; onClose: () => void; onRevoked: () => Promise<void>;
}) {
  const [records, setRecords] = useState<Credential[]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const focus = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    let active = true;
    setLoading(true); setRecords(undefined); setError("");
    void controlPlaneCollection<Credential>(`/control/v1/shops/${shop.id}/credentials`, token)
      .then(values => { if (active) setRecords(values); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load credential impact"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [shop.id, token, generation]);
  // The API orders by created_at DESC, id DESC. Reverse without parsing dates:
  // JS Date loses PostgreSQL sub-millisecond precision used by the worker.
  const active = records?.filter(item => item.status === "ACTIVE").reverse();
  const target = records?.find(item => item.id === id);
  const next = active?.filter(item => item.id !== id)[0];
  const isSigner = active?.[0]?.id === id;
  const revoke = async () => {
    if (saving || !target || target.status !== "ACTIVE") return;
    setSaving(true); setError("");
    try {
      await controlPlaneRequest(`/control/v1/credentials/${id}/revoke`, token, { method: "POST" });
      window.dispatchEvent(new CustomEvent("marketplace:credential-revoked", { detail: { clientID: target.client_id } }));
      await onRevoked(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Revocation failed"); }
    finally { setSaving(false); }
  };
  return <AccessibleDialog ariaLabel="Review credential revocation" backdropClassName="modal-backdrop modal modal-open" className="modal-card modal-box" initialFocusRef={focus} returnFocusRef={returnFocus} onClose={() => { if (!saving) onClose(); }}>
    <h2 ref={focus} tabIndex={-1}>Review credential revocation</h2>
    <p>{shop.name} · {shop.provider_profile} · <code>{shop.id}</code></p>
    {loading && <p role="status">Checking active credentials…</p>}
    {target && <>
      <p>Client ID: <code>{target.client_id}</code>. Revocation cannot be undone. API calls using this credential will fail, and a replacement has a different retry-key scope.</p>
      {target.status !== "ACTIVE" ? <p>This credential is already revoked. Refresh the list.</p> : <>
        {!next && <p role="alert">This is the last active credential. Create and save a replacement before revoking if your integration must keep working.</p>}
        {shop.provider_profile === "TOKOPEDIA_LIKE" ? <p>Current webhook signer: <code>{active?.[0]?.client_id || "none"}</code>. After revocation: <code>{next?.client_id || "none — delivery signing will fail"}</code>. {isSigner ? "Revoking this key switches signing on subsequent attempts, including retries. Update APP_KEY/APP_SECRET in your receiver for the replacement at that switch." : "This key is not the current webhook signer; revoking it does not change the signer."}</p> : <p>Shopee webhook verification uses each registration’s secret. Revoking this API credential does not rotate those webhook secrets.</p>}
        <ol><li>Create a replacement and save its one-time values.</li><li>Update your external API client and verify a signed read.</li><li>For Tokopedia, prepare the receiver’s next verification key before revoking the current signer. Creating a newer key alone does not switch signing.</li><li>Revoke, then verify a fresh webhook and inspect pending attempts. Inspect current resource state before repeating mutations under a new credential.</li></ol>
        <p>Impact reflects the latest loaded credentials; another session may change them. Refresh this preview before proceeding if needed.</p>
      </>}
    </>}
    {!loading && records && !target && <p role="alert">Credential no longer available. Close and refresh the list.</p>}
    {error && <p role="alert">{error}</p>}
    <button disabled={saving || loading} onClick={() => setGeneration(value => value + 1)}>Refresh impact</button>{" "}
    <button disabled={saving} onClick={onClose}>Cancel</button>{" "}
    <button className="btn btn-error" disabled={saving || loading || !target || target.status !== "ACTIVE"} onClick={() => void revoke()}>{saving ? "Revoking…" : "Revoke this credential"}</button>
  </AccessibleDialog>;
}
