import { useEffect, useState } from "react";
import type { ControlPlaneSession } from "@/shared/types/controlPlane";

export function restoreSession(): ControlPlaneSession | null {
  const stored = localStorage.getItem("marketplace-session");
  if (!stored) return null;
  try {
    return JSON.parse(stored) as ControlPlaneSession;
  } catch {
    localStorage.removeItem("marketplace-session");
    return null;
  }
}

export function useControlPlaneSession() {
  const [session, setSession] = useState<ControlPlaneSession | null>(restoreSession);

  useEffect(() => {
    const invalidate = () => {
      localStorage.removeItem("marketplace-session");
      setSession(null);
    };
    window.addEventListener("marketplace:session-invalid", invalidate);
    return () => window.removeEventListener("marketplace:session-invalid", invalidate);
  }, []);

  const login = (nextSession: ControlPlaneSession) => {
    localStorage.setItem("marketplace-session", JSON.stringify(nextSession));
    setSession(nextSession);
  };

  const logout = () => {
    localStorage.removeItem("marketplace-session");
    setSession(null);
  };

  return { session, token: session?.token, login, logout };
}
