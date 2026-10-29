import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { AuthError, SESSION_COOKIE } from "./auth.js";
import type { Config } from "./config.js";
import { randomToken, safeEqual } from "./crypto.js";
import { mcpRoutes } from "./mcp.js";
import { apiRoutes } from "./routes.js";
import { BuildError } from "./runner.js";
import { InputError, NotFoundError, type Services } from "./services.js";

const SESSION_DAYS = 30;

export interface App {
  server: FastifyInstance;
  loginToken: string;
}

export async function createApp(config: Config, services: Services, version: string): Promise<App> {
  const server = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  const loginToken = randomToken();

  await server.register(cookie);
  await server.register(websocket);

  server.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host ?? "";
    if (!config.allowedHosts.includes(host)) {
      return reply.code(421).send({ error: { code: "host_not_allowed", message: `Host ${host} is not allowed.` } });
    }
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "invalid_input", message: "Invalid input.", issues: error.issues } });
    }
    if (error instanceof BuildError) {
      return reply.code(422).send({ error: { code: "build_failed", message: error.message, diagnostics: error.diagnostics } });
    }
    if (error instanceof InputError) return reply.code(400).send({ error: { code: "invalid_input", message: error.message } });
    if (error instanceof NotFoundError) return reply.code(404).send({ error: { code: "not_found", message: error.message } });
    if (error instanceof AuthError) {
      return reply.code(error.status).send({ error: { code: error.status === 401 ? "unauthorized" : "forbidden", message: error.message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: "bad_request", message: (error as Error).message } });
    }
    console.error(error);
    return reply.code(500).send({ error: { code: "internal", message: "Something went wrong. Check the server console." } });
  });

  server.get<{ Querystring: { token?: string } }>("/login", async (request, reply) => {
    const token = request.query.token ?? "";
    if (!safeEqual(token, loginToken)) {
      reply.code(401).type("text/html");
      return "<p>This sign-in link is invalid or from an older run. Use the link printed by <code>sila start</code>.</p>";
    }
    const session = randomToken();
    services.store.createSession(session, SESSION_DAYS);
    reply.setCookie(SESSION_COOKIE, session, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.publicUrl.startsWith("https://"),
      maxAge: SESSION_DAYS * 86_400,
    });
    return reply.redirect("/");
  });

  server.post("/logout", async (request, reply) => {
    const session = request.cookies[SESSION_COOKIE];
    if (session) services.store.deleteSession(session);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.code(204);
  });

  await server.register((api) => apiRoutes(api, services, { version, allowedHosts: config.allowedHosts }), {
    prefix: "/api/v1",
  });
  await server.register((mcp) => mcpRoutes(mcp, services, version));

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  if (existsSync(join(publicDir, "index.html"))) {
    await server.register(fastifyStatic, { root: publicDir });
    server.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: { code: "not_found", message: "Route not found." } });
    });
  } else {
    server.get("/", async (_request, reply) => {
      reply.type("text/html");
      return "<p>The dashboard is not built. Run <code>npm run build</code>, or <code>npm run dev:dashboard</code> for development.</p>";
    });
  }

  return { server, loginToken };
}
