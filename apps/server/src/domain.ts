export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function eligibility(deliveredAt: string, now: string) {
  const delivery = Date.parse(deliveredAt);
  const instant = Date.parse(now);
  const deadline = delivery + 30 * 86400000;
  return {
    eligible:
      Number.isFinite(delivery) &&
      Number.isFinite(instant) &&
      instant >= delivery &&
      instant <= deadline,
    deadline: new Date(deadline).toISOString(),
    policyVersion: "merchandise-30d-v1",
  };
}

export function allocateMinor(total: number, quantity: number) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000
  )
    throw new Error("Invalid merchandise allocation");
  return Array.from(
    { length: quantity },
    (_, index) => Math.floor(total / quantity) + (index < total % quantity ? 1 : 0),
  );
}
