const paths = {
  "arrow-left": "M19 12H5m6-6-6 6 6 6",
  "chevron-right": "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  x: "m6 6 12 12M6 18 18 6",
  "package-check": "m3 6 8-4 8 4-8 4-8-4Zm0 0v10l8 4V10m0 10 3-1.5M19 6v5m-3 5 2 2 4-4",
  "clipboard-check": "M9 4H5v18h14V4h-4M9 2h6v4H9V2Zm-1 12 3 3 5-6",
  "clipboard-x": "M9 4H5v18h14V4h-4M9 2h6v4H9V2Zm0 9 6 6m-6 0 6-6",
  reset: "M3 4v6h6M3 10a9 9 0 1 1 1 7",
  refresh: "M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4",
  send: "m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2",
  "credit-card": "M3 4h18v16H3V4Zm0 6h18M7 15h3",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6",
  "shopping-bag": "M4 7h16l1 14H3L4 7Zm4 0V6a4 4 0 0 1 8 0v1",
  "external-link": "M14 3h7v7m0-7L10 14M10 4H3v17h17v-7",
  "filter-x": "M3 3h18l-7 8v5l-4 4v-9L3 3Zm14 13 5 5m-5 0 5-5",
  loader: "M12 3a9 9 0 1 1-9 9",
};

export type IconName = keyof typeof paths;

// Button labels carry the accessible name; their icons only reinforce the action visually.
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={name === "loader" ? "icon icon-spinning" : "icon"}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
