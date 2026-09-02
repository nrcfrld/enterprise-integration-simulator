import { useState, type FormEvent } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ControlPlaneSession } from "@/shared/types/controlPlane";

interface LoginPageProps {
  onLogin: (session: ControlPlaneSession) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("admin@example.test");
  const [password, setPassword] = useState("change-me-now");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onLogin(await controlPlaneRequest<ControlPlaneSession>("/control/v1/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
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
        <h2>Enter the simulator</h2>
        <label>Email<input value={email} type="email" onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input value={password} type="password" onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button>Sign in <span>→</span></button>
      </form>
    </main>
  );
}
