import type { HttpMethod as HttpMethodType } from "../types";

interface HttpMethodProps {
  method: HttpMethodType;
}

export function HttpMethod({ method }: HttpMethodProps) {
  return <span className={`http ${method.toLowerCase()}`}>{method}</span>;
}
