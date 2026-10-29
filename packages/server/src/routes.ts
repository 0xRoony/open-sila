import type { FastifyInstance } from "fastify";
import { describeNode, listNodes, platformSchema } from "@open-sila/core";
import { z } from "zod";
import { authenticate, identify, KEY_PREFIX, requireSession } from "./auth.js";
import { randomToken } from "./crypto.js";
import type { RunnerEvent } from "./runner.js";
import type { Services } from "./services.js";

const keySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(["read", "write"]).default("write"),
});

const secretSchema = z.object({ value: z.string() });

type IdParams = { id: string };

export async function apiRoutes(
  app: FastifyInstance,
  services: Services,
  options: { version: string; allowedHosts: string[] },
): Promise<void> {
  const { version } = options;
  const { store, runner } = services;

  app.get("/health", async () => ({ status: "ok", version }));

  app.register(async (api) => {
    api.addHook("preHandler", authenticate(store));

    api.get("/session", async (request) => ({
      kind: request.principal?.kind,
      scope: request.principal?.kind === "key" ? request.principal.key.scope : "write",
      version,
    }));

    api.get<{ Querystring: { platform?: string } }>("/nodes", async (request) => {
      const platform = request.query.platform ? platformSchema.parse(request.query.platform) : undefined;
      return listNodes(platform).map(describeNode);
    });

    api.get("/projects", async () => services.listProjects());

    api.post("/projects", async (request, reply) => {
      reply.code(201);
      return services.createProject(request.body);
    });

    api.get<{ Params: IdParams }>("/projects/:id", async (request) => services.project(request.params.id));

    api.patch<{ Params: IdParams }>("/projects/:id", async (request) =>
      services.updateProject(request.params.id, request.body),
    );

    api.delete<{ Params: IdParams }>("/projects/:id", async (request, reply) => {
      await services.deleteProject(request.params.id);
      reply.code(204);
    });

    api.get<{ Params: IdParams }>("/projects/:id/diagnostics", async (request) => services.validate(request.params.id));

    api.get<{ Params: IdParams; Querystring: { mode?: string } }>("/projects/:id/code", async (request) =>
      services.compile(request.params.id, request.query.mode === "development" ? "development" : "production"),
    );

    api.post<{ Querystring: { name?: string } }>("/projects/import", async (request, reply) => {
      reply.code(201);
      return services.importDocument(request.body, request.query.name);
    });

    api.get<{ Params: IdParams; Querystring: { format?: string } }>("/projects/:id/export", async (request, reply) => {
      if (request.query.format === "json") {
        const file = services.exportDocument(request.params.id);
        reply.header("content-type", "application/json");
        reply.header("content-disposition", `attachment; filename="${file.name}"`);
        return JSON.stringify(file.document, null, 2);
      }
      const archive = await services.exportZip(request.params.id);
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", `attachment; filename="${archive.name}"`);
      return archive.data;
    });

    api.get<{ Params: IdParams }>("/projects/:id/secrets", async (request) => services.listSecrets(request.params.id));

    api.put<{ Params: IdParams & { name: string } }>("/projects/:id/secrets/:name", async (request, reply) => {
      const { value } = secretSchema.parse(request.body);
      services.setSecret(request.params.id, request.params.name, value);
      reply.code(204);
    });

    api.delete<{ Params: IdParams & { name: string } }>("/projects/:id/secrets/:name", async (request, reply) => {
      services.deleteSecret(request.params.id, request.params.name);
      reply.code(204);
    });

    api.get<{ Params: IdParams }>("/projects/:id/bot", async (request) => services.botStatus(request.params.id));

    api.get<{ Params: IdParams }>("/projects/:id/runs", async (request) => {
      services.project(request.params.id);
      return { runs: runner.runs.list(request.params.id), latest: runner.runs.latestSteps(request.params.id) };
    });

    api.get<{ Params: IdParams & { runId: string } }>("/projects/:id/runs/:runId", async (request, reply) => {
      services.project(request.params.id);
      const run = runner.runs.get(request.params.id, request.params.runId);
      if (!run) {
        reply.code(404);
        return { error: { code: "not_found", message: "Run not found. Only the last 200 runs are kept." } };
      }
      return run;
    });

    api.delete<{ Params: IdParams }>("/projects/:id/runs", async (request, reply) => {
      services.project(request.params.id);
      runner.runs.clear(request.params.id);
      reply.code(204);
    });

    api.get<{ Params: IdParams }>("/projects/:id/network", async (request) => {
      services.project(request.params.id);
      return runner.runs.network(request.params.id);
    });
    api.post<{ Params: IdParams }>("/projects/:id/bot/start", async (request) => services.startBot(request.params.id));
    api.post<{ Params: IdParams }>("/projects/:id/bot/stop", async (request) => services.stopBot(request.params.id));
    api.get<{ Params: IdParams }>("/projects/:id/versions", async (request) => services.listVersions(request.params.id));
    api.post<{ Params: IdParams }>("/projects/:id/versions", async (request) => {
      const body = z.object({ label: z.string().max(80).default("") }).parse(request.body ?? {});
      return services.saveVersion(request.params.id, body.label);
    });
    api.get<{ Params: IdParams & { versionId: string } }>("/projects/:id/versions/:versionId", async (request) =>
      services.getVersion(request.params.id, request.params.versionId),
    );
    api.post<{ Params: IdParams & { versionId: string } }>("/projects/:id/versions/:versionId/restore", async (request) =>
      services.restoreVersion(request.params.id, request.params.versionId),
    );
    api.post<{ Params: IdParams }>("/projects/:id/bot/run", async (request) => {
      const body = z.object({ nodeId: z.string(), payload: z.unknown().optional() }).parse(request.body);
      return services.runManual(request.params.id, body.nodeId, body.payload ?? null);
    });

    api.get("/keys", async (request) => {
      requireSession(request);
      return store.listKeys();
    });

    api.post("/keys", async (request, reply) => {
      requireSession(request);
      const input = keySchema.parse(request.body);
      const secret = `${KEY_PREFIX}${randomToken(24)}`;
      reply.code(201);
      return { ...store.createKey(input.name, input.scope, secret), secret };
    });

    api.delete<{ Params: IdParams }>("/keys/:id", async (request, reply) => {
      requireSession(request);
      if (!store.deleteKey(request.params.id)) {
        reply.code(404);
        return { error: { code: "not_found", message: "API key not found." } };
      }
      reply.code(204);
    });
  });

  app.get("/events", { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    const trusted = !origin || options.allowedHosts.includes(URL.canParse(origin) ? new URL(origin).host : "");
    if (!trusted || !identify(request, store)) {
      socket.close(4401, "Unauthorized");
      return;
    }
    const send = (event: RunnerEvent) => socket.send(JSON.stringify(event));
    runner.on("event", send);
    socket.on("close", () => runner.off("event", send));
  });
}
