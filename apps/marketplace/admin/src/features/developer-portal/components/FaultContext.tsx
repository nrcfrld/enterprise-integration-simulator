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
  return <section className="fault-context" aria-labelledby="simulation-conditions-title">
    <div className="fault-context__summary">
      <div>
        <h3 id="simulation-conditions-title">Simulation conditions</h3>
      </div>
      <div className="fault-context__status" aria-live="polite">
        <span>{state.faults ? state.faults.length ? state.faults.join(" · ") : "No shop faults enabled" : "Checking shop faults…"}</span>
        <span>{state.maintenance === undefined ? "Checking maintenance…" : state.maintenance ? "Global maintenance is on" : "Global maintenance is off"}</span>
      </div>
      {state.error && <p className="fault-context__error" role="alert">{state.error}</p>}
      <p className="fault-context__note">Conditions can change in another session. Refresh before testing a failure scenario.</p>
    </div>
    <div className="fault-context__actions">
      <button className="btn btn-outline" type="button" onClick={refresh}>Refresh status</button>
      <button className="btn btn-ghost" type="button" onClick={onConfigure}>Manage faults</button>
    </div>
  </section>;
}
