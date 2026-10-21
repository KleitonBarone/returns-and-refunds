import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Actor } from "../../../packages/contracts/src/index.ts";
import type { Database } from "./db.ts";
import { HttpError } from "./domain.ts";
import { customers, memberships, merchants, sessions, users } from "./schema.ts";

export async function listPersonas(db: Database) {
  return db
    .select({
      id: users.id,
      name: users.name,
      merchantId: memberships.merchantId,
      merchantName: merchants.name,
      role: memberships.role,
      customerId: customers.id,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(merchants, eq(merchants.id, memberships.merchantId))
    .leftJoin(
      customers,
      and(eq(customers.userId, users.id), eq(customers.merchantId, memberships.merchantId)),
    )
    .orderBy(users.name);
}
function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createSession(db: Database, personaId: string) {
  const actor = (await listPersonas(db)).find((persona) => persona.id === personaId);
  if (!actor) throw new HttpError(404, "Demo persona not found");
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: tokenHash(token),
    userId: actor.id,
    merchantId: actor.merchantId,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  return { actor, token };
}
export async function sessionActor(db: Database, request: FastifyRequest): Promise<Actor | null> {
  const token = request.cookies.returns_session;
  if (!token) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash(token)),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    );
  if (!session) return null;
  return (
    (await listPersonas(db)).find(
      (actor) => actor.id === session.userId && actor.merchantId === session.merchantId,
    ) ?? null
  );
}
export function requireActor(actor: Actor | null, role?: Actor["role"]) {
  if (!actor) throw new HttpError(401, "Choose a demo persona to continue");
  if (role && actor.role !== role)
    throw new HttpError(403, `This action requires the ${role} role`);
  return actor;
}
