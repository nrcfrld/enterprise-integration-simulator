export const CONTROL_PAGES = [
  "Dashboard",
  "Shops",
  "Products",
  "Warehouses",
  "Credentials",
  "Webhooks",
  "Orders",
  "Packages",
  "Shipments",
  "Deliveries",
  "Scenarios",
  "Documentation",
  "Users",
] as const;

export type ControlPage = (typeof CONTROL_PAGES)[number];

export const CONTROL_PATHS: Record<ControlPage, string> = {
  Dashboard: "/dashboard",
  Shops: "/shops",
  Products: "/products",
  Warehouses: "/warehouses",
  Credentials: "/credentials",
  Webhooks: "/webhooks",
  Orders: "/orders",
  Packages: "/packages",
  Shipments: "/shipments",
  Deliveries: "/deliveries",
  Scenarios: "/scenarios",
  Documentation: "/docs",
  Users: "/users",
};

export type ControlNavigationItem = {
  label: string;
  page: ControlPage;
  /**
   * A few operational views live inside an order or the developer portal rather
   * than having a separate route. Keep those entries discoverable without
   * pretending they are independent resources.
   */
  description?: string;
  showActiveState?: boolean;
};

export type ControlNavigationSection = {
  label: string;
  items: readonly ControlNavigationItem[];
};

export const CONTROL_NAVIGATION: readonly ControlNavigationSection[] = [
  {
    label: "Overview",
    items: [{ label: "Overview", page: "Dashboard" }],
  },
  {
    label: "OPERATIONS",
    items: [
      { label: "Orders", page: "Orders" },
      { label: "Products", page: "Products" },
      { label: "Warehouses", page: "Warehouses" },
      { label: "Packages", page: "Packages" },
      { label: "Shipments", page: "Shipments" },
    ],
  },
  {
    label: "INTEGRATION",
    items: [
      { label: "API Credentials", page: "Credentials" },
      { label: "Webhooks", page: "Webhooks" },
      { label: "Webhook Deliveries", page: "Deliveries" },
    ],
  },
  {
    label: "SIMULATION",
    items: [
      { label: "Scenarios", page: "Scenarios" },
      {
        label: "Event Logs",
        page: "Orders",
        description: "Inspect an order's event trail from its detail view.",
        showActiveState: false,
      },
    ],
  },
  {
    label: "DEVELOPER",
    items: [
      { label: "API Documentation", page: "Documentation" },
      {
        label: "Integration Guide",
        page: "Documentation",
        description: "Open the quick-start integration guide in the developer portal.",
        showActiveState: false,
      },
    ],
  },
];

export const PAGE_BY_PATH: Record<string, ControlPage> = Object.fromEntries(
  Object.entries(CONTROL_PATHS).map(([page, path]) => [path, page]),
) as Record<string, ControlPage>;

export const PAGEABLE_CONTROL_PAGES = new Set<ControlPage>([
  "Shops",
  "Products",
  "Warehouses",
  "Orders",
  "Packages",
  "Shipments",
  "Credentials",
  "Deliveries",
  "Users",
]);
