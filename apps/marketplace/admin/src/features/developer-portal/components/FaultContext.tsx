import { useCallback, useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import { activeFaults, CLEAR_FAULTS } from "@/shared/scenarios";

export function FaultContext({ shopID, token, onConfigure }: { shopID: string; token: string; onConfigure: () => void }) {
  const [state, setState] = useState<{ faults?: string[]; maintenance?: boolean; error?: string }>({});
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setState({});
    void Promise.allSettled([
      controlPlaneRequest<typeof CLEAR_FAULTS>(`/control/v1/shops/${shopID}/scenario`, token),
      controlPlaneRequest<{ enabled: boolean }>("/control/v1/maintenance", token),
    ]).then(([scenario, maintenance]) => {
      if (!active) return;
      setState({
        faults: scenario.status === "fulfilled" ? activeFaults(scenario.value) : undefined,
        maintenance: maintenance.status === "fulfilled" ? maintenance.value.enabled : undefined,
        error: scenario.status === "rejected" || maintenance.status === "rejected" ? "Some fault settings could not be checked. Retry before assuming the shop is healthy." : undefined,
      });
    });
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [shopID, token, generation, refresh]);
  return <section className="reference-callout" aria-label="Active fault context">
    <h3>Simulation conditions</h3>
    <p>{state.faults ? state.faults.length ? state.faults.join(" · ") : "No shop faults enabled at last check." : "Shop fault status unknown / checking…"}</p>
    <p>{state.maintenance === undefined ? "Global maintenance status unknown / checking…" : state.maintenance ? "Global maintenance is ON: public APIs return 503. Ask an Admin to turn it off on the dashboard." : "Global maintenance is off at last check."}</p>
    {state.error && <p role="alert">{state.error}</p>}
    <p>Settings can change in another session. Check again before testing. Clearing shop faults does not reset data or disable global maintenance.</p>
    <button type="button" onClick={refresh}>Refresh fault status</button>{" "}
    <button type="button" onClick={onConfigure}>Configure or clear shop faults</button>
  </section>;
}
