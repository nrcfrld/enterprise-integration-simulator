import { CLEAR_FAULTS, SCENARIO_EXERCISES } from "@/shared/scenarios";
import { useEffect, useState, type ReactNode } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";
import type { ControlPlaneData } from "@/shared/types/controlPlane";

const request = controlPlaneRequest;

type NumericScenarioKey =
  | "api_slow_ms"
  | "api_slow_probability"
  | "api_random_500_probability"
  | "api_timeout_probability"
  | "webhook_delay_seconds";
type BooleanScenarioKey =
  | "force_rate_limit"
  | "webhook_duplicate"
  | "webhook_out_of_order"
  | "webhook_force_failure";
type ScenarioConfig = Pick<ControlPlaneData, NumericScenarioKey | BooleanScenarioKey>;

interface ScenarioProps {
  token: string | null | undefined;
  shopID: string;
  data: ControlPlaneData | null;
  onSaved: () => void;
}

export function Scenario({ token, shopID, data, onSaved }: ScenarioProps) {
  const [form, setForm] = useState<ScenarioConfig>(data || {});
  const [exercise, setExercise] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setForm(data || {}), [data]);
  if (!shopID)
    return (
      <p className="empty">Choose a shop before configuring fault injection.</p>
    );
  const save = async (values: ScenarioConfig = form) => {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "number" && (!Number.isInteger(value) || value < 0 || (key.includes("probability") && value > 100))) {
        setError(`${key.replaceAll("_", " ")}: enter a whole number ${key.includes("probability") ? "from 0 to 100" : "of zero or more"}.`);
        return;
      }
    }
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await request<unknown>(`/control/v1/shops/${shopID}/scenario`, token, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setSaving(false);
    }
  };
  const fields: Array<{ key: NumericScenarioKey; label: string; help: string }> = [
    {
      key: "api_slow_ms",
      label: "API slow response (ms)",
      help: "Delay applied when slow response is triggered. Set its probability above zero to enable it.",
    },
    {
      key: "api_slow_probability",
      label: "Slow response probability (%)",
      help: "Percentage of public requests delayed, from 0 to 100. A value of 100 delays every request.",
    },
    {
      key: "api_random_500_probability",
      label: "Random 500 (%)",
      help: "Percentage of public requests returning a simulated HTTP 500. Test retry and error handling.",
    },
    {
      key: "api_timeout_probability",
      label: "Timeout (%)",
      help: "Percentage of public requests held for 35 seconds. Test client timeout and cancellation.",
    },
    {
      key: "webhook_delay_seconds",
      label: "Webhook delay (s)",
      help: "Delay webhook jobs before sending. Also delays order.paid when out-of-order delivery is enabled.",
    },
  ];
  const flags: Array<{ key: BooleanScenarioKey; label: string; help: string }> = [
    {
      key: "force_rate_limit",
      label: "Force rate limit",
      help: "Force HTTP 429 to test client backoff. Clear this fault to allow requests again; real quota limits still apply.",
    },
    {
      key: "webhook_duplicate",
      label: "Duplicate webhook",
      help: "Create two deliveries for the same event. The receiver must deduplicate by event ID.",
    },
    {
      key: "webhook_out_of_order",
      label: "Out-of-order webhook",
      help: "Delay order.paid so later events can arrive first. Fetch current state instead of applying an old payload.",
    },
    {
      key: "webhook_force_failure",
      label: "Force webhook failure",
      help: "Fail delivery before making an HTTP request. The failed attempt is recorded and scheduled retries follow.",
    },
  ];
  return (
    <article className="scenario card bg-base-100">
      <p className="eyebrow">Fault injection</p>
      <h2>Practice failure and recovery</h2>
      <p>These settings affect only the selected shop. Resetting sample data preserves them. Clearing faults does not undo events or remove queued deliveries.</p>
      <label>Learning exercise<select disabled={saving} value={exercise} onChange={event => {
        setExercise(event.target.value);
        const preset = SCENARIO_EXERCISES.find(item => item.name === event.target.value);
        if (preset) setForm({ ...CLEAR_FAULTS, ...preset.config });
      }}><option value="">Custom settings</option>{SCENARIO_EXERCISES.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
      {exercise && <p role="note">{SCENARIO_EXERCISES.find(item => item.name === exercise)?.outcome} Choose Apply scenario to activate this exercise.</p>}
      <div className="field-grid">
        {fields.map(({ key, label, help }) => {
          const helpID = `scenario-help-${key}`;
          return <div className="scenario-field" key={key}>
            <div className="scenario-label-row">
              <label htmlFor={`scenario-${key}`}>{label}</label>
              <ScenarioHelp id={helpID} label={label}>{help}</ScenarioHelp>
            </div>
            <input
              className="input input-bordered"
              id={`scenario-${key}`}
              type="number"
              min="0"
              max={key.includes("probability") ? 100 : undefined}
              disabled={saving}
              value={form[key] ?? 0}
              aria-describedby={helpID}
              onChange={(event) =>
                (setExercise(""), setForm({ ...form, [key]: Number(event.target.value) }))
              }
            />
          </div>;
        })}
      </div>
      <div className="toggles">
        {flags.map(({ key, label, help }) => {
          const helpID = `scenario-help-${key}`;
          return <div className="scenario-toggle" key={key}>
            <label htmlFor={`scenario-${key}`}>
              <input
                className="toggle toggle-primary"
                id={`scenario-${key}`}
                type="checkbox"
                disabled={saving}
                checked={Boolean(form[key])}
                aria-describedby={helpID}
                onChange={(event) =>
                  (setExercise(""), setForm({ ...form, [key]: event.target.checked }))
                }
              />
              {label}
            </label>
            <ScenarioHelp id={helpID} label={label}>{help}</ScenarioHelp>
          </div>;
        })}
      </div>
      {error && <p className="error alert alert-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? "Applying…" : "Apply scenario"} {!saving && <span>→</span>}
      </button>
      <button className="btn btn-ghost" disabled={saving} onClick={() => { setExercise(""); setForm({ ...CLEAR_FAULTS }); void save(CLEAR_FAULTS); }}>Clear shop faults</button>
    </article>
  );
}
interface ScenarioHelpProps {
  id: string;
  label: string;
  children: ReactNode;
}

function ScenarioHelp({ id, label, children }: ScenarioHelpProps) {
  return (
    <details className="scenario-help">
      <summary aria-label={`Explanation: ${label}`} title={`Explanation ${label}`}>
        ?
      </summary>
      <span id={id} role="note">{children}</span>
    </details>
  );
}
