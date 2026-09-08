import { useState } from "react";
import { signCanonicalRequest } from "@/features/developer-portal/lib/signing";
import type { DetailData } from "./types";

type Attempt = NonNullable<DetailData["attempts"]>[number];
export function AttemptVerification({ attempt }: { attempt: Attempt }) {
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);
  const tokopedia = attempt.provider_profile === "TOKOPEDIA_LIKE";
  const header = (name: string) => Object.entries(attempt.request_headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const verify = async () => {
    setPending(true);
    setResult("");
    try {
      const signature = header(tokopedia ? "Authorization" : "X-Shopee-Signature");
      const timestamp = header("X-Shopee-Timestamp");
      const event = header("X-Shopee-Event");
      if (attempt.request_body == null || !signature || (tokopedia ? !attempt.signing_client_id : !timestamp || !event)) {
        setResult("This attempt has no complete signing snapshot. It cannot be verified from stored evidence.");
        return;
      }
      const canonical = tokopedia ? attempt.signing_client_id + attempt.request_body : event! + timestamp! + attempt.request_body;
      const actual = await signCanonicalRequest(secret, canonical);
      setResult(actual === signature.toLowerCase() ? "Signature matches the stored bytes. This is a historical integrity check, not a freshness check or proof of application processing." : "Signature mismatch. Use the key active at this attempt; a rotated key or edited body will not match.");
    } catch { setResult("Could not verify locally. Check that browser cryptography is available."); }
    finally { setSecret(""); setPending(false); }
  };
  return <details><summary>Verify this historical attempt locally</summary>
    <p>Use {tokopedia ? <>the app secret for snapshot Client ID <code>{attempt.signing_client_id ?? "not recorded"}</code></> : "the webhook secret active when this attempt was prepared"}. The key stays in this component’s memory, is never sent or saved, and is cleared after checking or closing this detail. This does not resend the request or bypass freshness validation in your receiver.</p>
    <label>Verification secret<input type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} /></label>
    <button disabled={!secret || pending} onClick={() => void verify()}>{pending ? "Verifying…" : "Verify stored signature"}</button>
    {result && <p role="status">{result}</p>}
  </details>;
}
