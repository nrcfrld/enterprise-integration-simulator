import { useState, type FormEvent } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ControlPlaneSession } from "@/shared/types/controlPlane";

interface LoginPageProps {
  onLogin: (session: ControlPlaneSession) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("admin@example.test");
  const [password, setPassword] = useState("change-me-now");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const chooseMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setError("");
    if (nextMode === "register") {
      setEmail("");
      setPassword("");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      onLogin(await controlPlaneRequest<ControlPlaneSession>(`/control/v1/auth/${mode}`, null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-mark">
        <p className="eyebrow">Enterprise Integration Simulator</p>
        <h1>Practice the<br /><em>unhappy path.</em></h1>
        <p>Marketplace behavior for integration engineers: signatures, retries, failure, and recovery.</p>
      </section>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">Control plane</p>
        <h2>{mode === "login" ? "Enter the simulator" : "Create your operator account"}</h2>
        <div className="login-mode" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : "quiet"} onClick={() => chooseMode("login")}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "selected" : "quiet"} onClick={() => chooseMode("register")}>Create account</button>
        </div>
        {mode === "register" && <p className="form-help">New accounts start as Operators. An Admin can manage users and assign shop ownership.</p>}
        <label>Email<input required autoComplete="email" value={email} type="email" onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} type="password" onChange={(event) => setPassword(event.target.value)} /></label>
        {mode === "register" && <p className="field-note">Use at least 8 characters. Registration signs you in immediately.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={submitting}>{submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"} <span>→</span></button>
      </form>
    </main>
  );
}
