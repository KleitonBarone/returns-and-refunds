import { type } from "arktype";

const errorContract = type({ message: "string" });

export async function api(path: string, body?: unknown) {
  if (import.meta.env.MODE === "demo") {
    const { demoApi } = await import("./demo/api.ts");
    return demoApi(path, body);
  }
  let response: Response;
  try {
    response = await fetch(
      `/api${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new Error("The local service could not be reached. Try again.");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("The local service is unavailable. Try again.");
  }
  if (!response.ok) {
    const error = errorContract(result);
    throw new Error(
      error instanceof type.errors
        ? "The request could not be completed. Try again."
        : response.status >= 500
          ? "The local service is unavailable. Try again."
          : error.message,
    );
  }
  return result;
}
