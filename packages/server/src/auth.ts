import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKey, KeyScope, Store } from "./db.js";

export const SESSION_COOKIE = "sila_session";
export const CSRF_HEADER = "x-sila-request";
export const KEY_PREFIX = "osk_";

export type Principal = { kind: "session" } | { kind: "key"; key: ApiKey };

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export function identify(request: FastifyRequest, store: Store): Principal | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const key = store.findKey(header.slice(7).trim());
    return key ? { kind: "key", key } : undefined;
  }
  const session = request.cookies[SESSION_COOKIE];
  if (session && store.hasSession(session)) return { kind: "session" };
  return undefined;
}

export function authenticate(store: Store) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const principal = identify(request, store);
    if (!principal) throw new AuthError(401, "Sign in from the link printed by `sila start`, or send an API key.");
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (principal.kind === "session" && mutating && request.headers[CSRF_HEADER] !== "1") {
      throw new AuthError(403, `Requests from the browser must include the ${CSRF_HEADER} header.`);
    }
    if (principal.kind === "key" && mutating && principal.key.scope !== "write") {
      throw new AuthError(403, "This API key is read-only.");
    }
    request.principal = principal;
  };
}

export function requireSession(request: FastifyRequest): void {
  if (request.principal?.kind !== "session") {
    throw new AuthError(403, "API keys can only be managed from the dashboard.");
  }
}

export function canWrite(principal: Principal | undefined): boolean {
  return principal?.kind === "session" || (principal?.kind === "key" && principal.key.scope === ("write" satisfies KeyScope));
}
