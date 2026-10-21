import { type } from "arktype";
export const browserProcessRecord = type({
  runId: "string",
  process: { pid: "number.integer > 0", birth: "string", commandHash: "string" },
});
export const browserCommand = type({
  id: "string.uuid",
  action: "'restart' | 'stop-api' | 'start-api'",
}).onDeepUndeclaredKey("reject");
export const browserCommandResult = type({ id: "string.uuid", "error?": "string" });
