import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Clock } from "../src/domain/script.js";
import { SqliteScriptStore } from "../src/store/sqlite-script-store.js";

class TestClock implements Clock {
  constructor(private instant: string) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: string): void {
    this.instant = instant;
  }
}

function setup(instant = "2026-03-10T12:00:00.000Z") {
  const store = new SqliteScriptStore(new DatabaseSync(":memory:"));
  const clock = new TestClock(instant);
  return { app: createApp({ store, clock }), store, clock };
}

function post(path: string, role: string, body: unknown): Request {
  return new Request("http://localhost" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Actor-Role": role },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<any> {
  return response.json();
}

const openStores: SqliteScriptStore[] = [];
afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
});

describe("revisão de roteiro", () => {
  it("percorre várias versões, preserva o histórico e encerra na aprovação", async () => {
    const state = setup();
    openStores.push(state.store);

    const createdResponse = await state.app.request(
      post("/scripts", "creator", { content: "Roteiro original" }),
    );
    expect(createdResponse.status).toBe(201);
    const created = await readJson(createdResponse);
    expect(created.status).toBe("SUBMITTED");
    expect(created.currentVersion).toBe(1);

    const firstRequest = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "Adicionar CTA",
        dueDate: "2026-03-12",
      }),
    );
    expect(firstRequest.status).toBe(201);

    const secondVersionResponse = await state.app.request(
      post("/scripts/" + created.id + "/versions", "creator", { content: "Roteiro com CTA" }),
    );
    expect(secondVersionResponse.status).toBe(201);
    const secondVersion = await readJson(secondVersionResponse);

    const secondRequest = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 2,
        reason: "Ajustar a chamada",
        dueDate: "2026-03-13",
      }),
    );
    expect(secondRequest.status).toBe(201);

    const thirdVersionResponse = await state.app.request(
      post("/scripts/" + created.id + "/versions", "creator", { content: "Roteiro final" }),
    );
    expect(thirdVersionResponse.status).toBe(201);
    const thirdVersion = await readJson(thirdVersionResponse);

    const approval = await state.app.request(
      post("/scripts/" + created.id + "/approve", "brand", { version: 3 }),
    );
    expect(approval.status).toBe(200);
    const approved = await readJson(approval);
    expect(approved.status).toBe("APPROVED");
    expect(approved.versions.map((version: { content: string }) => version.content)).toEqual([
      "Roteiro original",
      "Roteiro com CTA",
      "Roteiro final",
    ]);
    expect(approved.versions.map((version: { status: string }) => version.status)).toEqual([
      "CHANGES_REQUESTED",
      "CHANGES_REQUESTED",
      "APPROVED",
    ]);

    expect(
      (
        await state.app.request(
          post("/scripts/" + created.id + "/change-requests", "brand", {
            version: 3,
            reason: "Outro ajuste",
            dueDate: "2026-03-13",
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await state.app.request(
          post("/scripts/" + created.id + "/versions", "creator", { content: "Outra versão" }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await state.app.request(
          post("/scripts/" + created.id + "/approve", "brand", { version: 3 }),
        )
      ).status,
    ).toBe(409);
    expect(secondVersion.currentVersion).toBe(2);
    expect(thirdVersion.currentVersion).toBe(3);
  });

  it("aceita pedido e reenvio até o último milissegundo do dia em São Paulo", async () => {
    const state = setup("2026-03-13T02:59:59.999Z");
    openStores.push(state.store);
    const created = await readJson(
      await state.app.request(post("/scripts", "creator", { content: "Roteiro" })),
    );

    const requestResponse = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "Ajustar abertura",
        dueDate: "2026-03-12",
      }),
    );
    expect(requestResponse.status).toBe(201);

    const revisionResponse = await state.app.request(
      post("/scripts/" + created.id + "/versions", "creator", { content: "Roteiro revisado" }),
    );
    expect(revisionResponse.status).toBe(201);
    expect((await readJson(revisionResponse)).currentVersion).toBe(2);
  });

  it("rejeita pedido e reenvio no primeiro instante do dia seguinte", async () => {
    const requestState = setup("2026-03-13T03:00:00.000Z");
    openStores.push(requestState.store);
    const created = await readJson(
      await requestState.app.request(post("/scripts", "creator", { content: "Roteiro" })),
    );
    const pastRequest = await requestState.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "Ajustar abertura",
        dueDate: "2026-03-12",
      }),
    );
    expect(pastRequest.status).toBe(422);

    const revisionState = setup("2026-03-10T12:00:00.000Z");
    openStores.push(revisionState.store);
    const second = await readJson(
      await revisionState.app.request(post("/scripts", "creator", { content: "Roteiro" })),
    );
    await revisionState.app.request(
      post("/scripts/" + second.id + "/change-requests", "brand", {
        version: 1,
        reason: "Ajustar abertura",
        dueDate: "2026-03-12",
      }),
    );
    revisionState.clock.set("2026-03-13T03:00:00.000Z");
    const lateRevision = await revisionState.app.request(
      post("/scripts/" + second.id + "/versions", "creator", { content: "Roteiro atrasado" }),
    );
    expect(lateRevision.status).toBe(409);
    const read = await revisionState.app.request("/scripts/" + second.id);
    expect((await readJson(read)).pendingRequestExpired).toBe(true);
  });

  it("exige motivo e prazo e rejeita transições inválidas e papéis incorretos", async () => {
    const state = setup();
    openStores.push(state.store);
    const created = await readJson(
      await state.app.request(post("/scripts", "creator", { content: "Roteiro" })),
    );

    const noRole = await state.app.request(
      post("/scripts/" + created.id + "/approve", "creator", { version: 1 }),
    );
    expect(noRole.status).toBe(403);
    const blankReason = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "   ",
        dueDate: "2026-03-12",
      }),
    );
    expect(blankReason.status).toBe(422);
    const missingReason = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        dueDate: "2026-03-12",
      }),
    );
    expect(missingReason.status).toBe(422);
    const missingDeadline = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "Motivo válido",
      }),
    );
    expect(missingDeadline.status).toBe(422);
    const invalidDate = await state.app.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "Motivo válido",
        dueDate: "2026-02-30",
      }),
    );
    expect(invalidDate.status).toBe(422);
    const noPendingRequest = await state.app.request(
      post("/scripts/" + created.id + "/versions", "creator", { content: "Versão sem pedido" }),
    );
    expect(noPendingRequest.status).toBe(409);
  });

  it("serializa duas aprovações concorrentes da mesma versão", async () => {
    const state = setup();
    openStores.push(state.store);
    const created = await readJson(
      await state.app.request(post("/scripts", "creator", { content: "Roteiro" })),
    );

    const results = await Promise.all([
      state.app.request(post("/scripts/" + created.id + "/approve", "brand", { version: 1 })),
      state.app.request(post("/scripts/" + created.id + "/approve", "brand", { version: 1 })),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await readJson(await state.app.request("/scripts/" + created.id));
    expect(saved.status).toBe("APPROVED");
    expect(saved.versions).toHaveLength(1);
  });

  it("persiste o histórico ao reabrir o banco e rejeita versão alvo desatualizada", async () => {
    const databasePath = join(tmpdir(), "script-review-" + randomUUID() + ".sqlite");
    const clock = new TestClock("2026-03-10T12:00:00.000Z");
    const firstStore = new SqliteScriptStore(new DatabaseSync(databasePath));
    const firstApp = createApp({ store: firstStore, clock });
    const created = await readJson(
      await firstApp.request(post("/scripts", "creator", { content: "Roteiro inicial" })),
    );
    await firstApp.request(
      post("/scripts/" + created.id + "/change-requests", "brand", {
        version: 1,
        reason: "Revisar final",
        dueDate: "2026-03-12",
      }),
    );
    await firstApp.request(
      post("/scripts/" + created.id + "/versions", "creator", { content: "Versão 2" }),
    );
    firstStore.close();

    const reopenedStore = new SqliteScriptStore(new DatabaseSync(databasePath));
    try {
      const reopenedApp = createApp({ store: reopenedStore, clock });
      const stale = await reopenedApp.request(
        post("/scripts/" + created.id + "/approve", "brand", { version: 1 }),
      );
      expect(stale.status).toBe(409);
      const read = await reopenedApp.request("/scripts/" + created.id);
      const script = await readJson(read);
      expect(script.currentVersion).toBe(2);
      expect(script.versions[0].content).toBe("Roteiro inicial");
      expect(script.versions[0].review.reason).toBe("Revisar final");
    } finally {
      reopenedStore.close();
      for (const suffix of ["", "-shm", "-wal"]) {
        try {
          unlinkSync(databasePath + suffix);
        } catch {
          // SQLite may not create sidecar files for this test.
        }
      }
    }
  });
});
