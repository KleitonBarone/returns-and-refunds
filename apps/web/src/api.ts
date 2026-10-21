import { type } from "arktype";

const errorContract = type({ message: "string" });

export async function api(path: string, body?: unknown) {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = errorContract(result);
    throw new Error(
      error instanceof type.errors
        ? "The request could not be completed. Try again."
        : error.message,
    );
  }
  return result;
}
