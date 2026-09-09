export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:18080";

export interface ControlPlaneErrorResponse {
  error?: { message?: string; code?: string };
}

export async function controlPlaneRequest<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data: T | null = response.status === 204 ? null : await response.json() as T;

  if (response.status === 401 && token) {
    window.dispatchEvent(new Event("marketplace:session-invalid"));
  }
  if (!response.ok) {
    const error = data as ControlPlaneErrorResponse | null;
    throw Object.assign(new Error(error?.error?.message || "Request failed"), { code: error?.error?.code, status: response.status });
  }

  return data as T;
}
