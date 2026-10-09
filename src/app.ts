import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { AppError, type Clock } from "./domain/script.js";
import {
  approveSchema,
  createScriptSchema,
  requestChangesSchema,
  submitVersionSchema,
} from "./domain/validation.js";
import type { ScriptStore } from "./store/script-store.js";

interface AppDependencies {
  store: ScriptStore;
  clock: Clock;
}

function errorResponse(context: Context, error: AppError): Response {
  return context.json(
    { error: { code: error.code, message: error.message } },
    error.status as 400 | 403 | 404 | 409 | 422 | 500,
  );
}

async function readBody<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw new AppError("MALFORMED_JSON", 400, "O corpo precisa ser um JSON válido.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", 422, "Um ou mais campos são inválidos.");
  }
  return parsed.data;
}

function requireRole(context: Context, expected: "brand" | "creator"): Response | null {
  const role = context.req.header("X-Actor-Role");
  if (role !== expected) {
    return context.json(
      { error: { code: "FORBIDDEN", message: "Esta ação exige o papel " + expected + "." } },
      403,
    );
  }
  return null;
}

export function createApp({ store, clock }: AppDependencies) {
  const app = new Hono();

  app.onError((error, context) => {
    if (error instanceof AppError) return errorResponse(context, error);
    return context.json(
      { error: { code: "INTERNAL_ERROR", message: "Ocorreu um erro interno." } },
      500,
    );
  });

  app.get("/health", (context) => context.json({ status: "ok" }));

  app.post("/scripts", async (context) => {
    const forbidden = requireRole(context, "creator");
    if (forbidden) return forbidden;
    const input = await readBody(context, createScriptSchema);
    return context.json(store.create(input.content, clock), 201);
  });

  app.get("/scripts/:id", (context) => {
    return context.json(store.get(context.req.param("id"), clock));
  });

  app.post("/scripts/:id/change-requests", async (context) => {
    const forbidden = requireRole(context, "brand");
    if (forbidden) return forbidden;
    const input = await readBody(context, requestChangesSchema);
    return context.json(store.requestChanges(context.req.param("id"), input, clock), 201);
  });

  app.post("/scripts/:id/versions", async (context) => {
    const forbidden = requireRole(context, "creator");
    if (forbidden) return forbidden;
    const input = await readBody(context, submitVersionSchema);
    return context.json(store.submitVersion(context.req.param("id"), input.content, clock), 201);
  });

  app.post("/scripts/:id/approve", async (context) => {
    const forbidden = requireRole(context, "brand");
    if (forbidden) return forbidden;
    const input = await readBody(context, approveSchema);
    return context.json(store.approve(context.req.param("id"), input.version, clock));
  });

  return app;
}
