import type { refundStates } from "../../../packages/contracts/src/index.ts";

export function date(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function dateTime(value: string) {
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}
export function stateLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
export function refundLabel(value: (typeof refundStates)[number]) {
  return {
    pending: "Queued",
    processing: "Processing",
    succeeded: "Confirmed",
    failed: "Rejected",
    unknown: "Outcome unknown",
  }[value];
}
