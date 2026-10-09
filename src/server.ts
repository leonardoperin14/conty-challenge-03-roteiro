import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { systemClock } from "./domain/script.js";
import { SqliteScriptStore } from "./store/sqlite-script-store.js";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/scripts.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const store = new SqliteScriptStore(new DatabaseSync(databasePath));
const app = createApp({ store, clock: systemClock });
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log("API disponível em http://localhost:" + info.port);
});
