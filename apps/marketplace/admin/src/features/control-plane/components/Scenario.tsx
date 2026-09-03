import { useEffect, useState } from "react";
import { controlPlaneRequest } from "@/shared/api/controlPlaneClient";

const request = controlPlaneRequest;

export function Scenario({ token, shopID, data, onSaved }: any) {
  const [form, setForm] = useState(data || {});
  useEffect(() => setForm(data || {}), [data]);
  if (!shopID)
    return (
      <p className="empty">Choose a shop before configuring fault injection.</p>
    );
  const save = async () => {
    await request(`/control/v1/shops/${shopID}/scenario`, token, {
      method: "PUT",
      body: JSON.stringify(form),
    });
    onSaved();
  };
  const fields = [
    {
      key: "api_slow_ms",
      label: "API slow response (ms)",
      help: "Tambahkan waktu tunggu ini ketika skenario slow response terpicu. Gunakan bersama probabilitas slow response.",
    },
    {
      key: "api_slow_probability",
      label: "Slow response probability (%)",
      help: "Persentase request public API yang akan diberi delay. Nilai 100 berarti setiap request melambat.",
    },
    {
      key: "api_random_500_probability",
      label: "Random 500 (%)",
      help: "Persentase request public API yang langsung menerima HTTP 500 ter-simulasi. Gunakan untuk menguji retry dan error handling client.",
    },
    {
      key: "api_timeout_probability",
      label: "Timeout (%)",
      help: "Persentase request public API yang ditahan selama 35 detik. Gunakan untuk menguji timeout client dan pembatalan request.",
    },
    {
      key: "webhook_delay_seconds",
      label: "Webhook delay (s)",
      help: "Menunda job webhook sebelum dikirim. Nilai ini juga digunakan untuk membuat event order.paid terlambat saat out-of-order aktif.",
    },
  ];
  const flags = [
    {
      key: "force_rate_limit",
      label: "Force rate limit",
      help: "Paksa request public API menerima respons rate limit untuk memeriksa backoff dan penghormatan header rate-limit pada client.",
    },
    {
      key: "webhook_duplicate",
      label: "Duplicate webhook",
      help: "Buat dua delivery untuk event yang sama. Penerima webhook harus melakukan deduplikasi berdasarkan event id.",
    },
    {
      key: "webhook_out_of_order",
      label: "Out-of-order webhook",
      help: "Tunda event order.paid agar event setelahnya dapat tiba lebih dulu. Gunakan untuk menguji state machine penerima.",
    },
    {
      key: "webhook_force_failure",
      label: "Force webhook failure",
      help: "Paksa attempt delivery gagal sebelum HTTP request dibuat. Delivery akan tercatat gagal lalu mengikuti retry terjadwal.",
    },
  ];
  return (
    <article className="scenario">
      <p className="eyebrow">Fault injection</p>
      <h2>Turn the happy path off.</h2>
      <div className="field-grid">
        {fields.map(({ key, label, help }) => {
          const helpID = `scenario-help-${key}`;
          return <div className="scenario-field" key={key}>
            <div className="scenario-label-row">
              <label htmlFor={`scenario-${key}`}>{label}</label>
              <ScenarioHelp id={helpID} label={label}>{help}</ScenarioHelp>
            </div>
            <input
              id={`scenario-${key}`}
              type="number"
              min="0"
              value={form[key] ?? 0}
              aria-describedby={helpID}
              onChange={(event) =>
                setForm({ ...form, [key]: Number(event.target.value) })
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
                id={`scenario-${key}`}
                type="checkbox"
                checked={Boolean(form[key])}
                aria-describedby={helpID}
                onChange={(event) =>
                  setForm({ ...form, [key]: event.target.checked })
                }
              />
              {label}
            </label>
            <ScenarioHelp id={helpID} label={label}>{help}</ScenarioHelp>
          </div>;
        })}
      </div>
      <button onClick={save}>
        Apply scenario <span>→</span>
      </button>
    </article>
  );
}
function ScenarioHelp({ id, label, children }: any) {
  return (
    <details className="scenario-help">
      <summary aria-label={`Penjelasan: ${label}`} title={`Penjelasan ${label}`}>
        ?
      </summary>
      <span id={id} role="note">{children}</span>
    </details>
  );
}
