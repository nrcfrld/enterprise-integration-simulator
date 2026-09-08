import { useEffect, useRef, useState } from "react";

export const isPendingDelivery = (status?: string) => status === "PENDING";

// A fresh scope or manual refresh starts at most twelve sequential checks.
// Callback changes (including each response) must not restart that budget.
export function useBoundedRefresh(scope: string, enabled: boolean, refresh: () => Promise<void>) {
  const callback = useRef(refresh);
  useEffect(() => { callback.current = refresh; }, [refresh]);
  const [cycle, setCycle] = useState(0);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let remaining = 12;
    setFinished(false);
    const check = async () => {
      if (!active) return;
      try { await callback.current(); } catch {
        if (active) setFinished(true);
        return;
      }
      if (!active) return;
      if (--remaining > 0) timer = setTimeout(() => void check(), 5000);
      else setFinished(true);
    };
    if (enabled) timer = setTimeout(() => void check(), 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [scope, enabled, cycle]);
  return {
    polling: enabled && !finished,
    refreshNow: async () => { await refresh(); setCycle(value => value + 1); },
  };
}
