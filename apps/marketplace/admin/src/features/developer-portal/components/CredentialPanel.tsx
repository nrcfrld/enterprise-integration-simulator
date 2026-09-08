import type { Shop, CredentialHandoff } from "@/shared/types/controlPlane";
import type { IntegrationCredentials, ProviderContract } from "../types";
import type { ControlPage } from "@/app/navigation";

interface CredentialPanelProps {
  shop?: Shop;
  knownCredential?: CredentialHandoff;
  credentials: IntegrationCredentials;
  onChange: (credentials: IntegrationCredentials) => void;
  onClear: () => void;
  onNavigate: (page: ControlPage) => void;
  contract: ProviderContract;
}

export function CredentialPanel({ shop, knownCredential, credentials, onChange, onClear, onNavigate, contract }: CredentialPanelProps) {
  const tokopedia = contract === "tokopedia";
  return (
    <section className="credential-panel">
      <div>
        <h3>Integration credential{shop ? ` for ${shop.name}` : ""}</h3>
        <p>This is different from your dashboard login. Create an active credential in Control plane → Credentials, then paste its Client ID and secret here.{tokopedia && " Tokopedia-like requests also need the one-time access token."}</p>
        <p>{knownCredential ? <>Known Client ID: <code>{knownCredential.credential.client_id}</code> · {knownCredential.shop.name} · {knownCredential.shop.provider_profile} (transferred from Credentials).</> : "Pasted credential ownership is not verified here. Use a credential created for the current shop."}</p>
        <p>If the one-time values are lost or were seeded, revoke that credential and create a new one. Use in simulator returns here with the new values.</p>
        <button type="button" className="link-button" onClick={() => onNavigate("Credentials")}>Open Credentials</button>
      </div>
      <div className="credential-fields">
        <label>Client ID<input value={credentials.clientID} onChange={(event) => onChange({ ...credentials, clientID: event.target.value })} placeholder="client_…" autoComplete="off" /></label>
        <label>Client secret<input type="password" value={credentials.secret} onChange={(event) => onChange({ ...credentials, secret: event.target.value })} placeholder="Paste the secret shown once" autoComplete="off" /><small>Kept only in memory while visiting this shop’s console and portal. Clear credential, change shop, reset the shop, sign out, or reload to erase it.</small></label>
        {tokopedia && <label>Tokopedia-like access token<input type="password" value={credentials.accessToken} onChange={(event) => onChange({ ...credentials, accessToken: event.target.value })} placeholder="Paste the access token shown once" autoComplete="off" /><small>Sent as x-tts-access-token. It is not part of the query signature.</small></label>}
        <button type="button" className="quiet" onClick={onClear}>Clear credential</button>
      </div>
    </section>
  );
}
