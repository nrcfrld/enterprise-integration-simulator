export interface ControlPlaneSession {
  token: string;
  user: {
    id: string;
    email: string;
    role: "ADMIN" | "OPERATOR";
  };
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}
