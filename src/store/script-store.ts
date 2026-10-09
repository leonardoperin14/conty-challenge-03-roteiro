import type { Clock, ScriptView } from "../domain/script.js";

export interface ScriptStore {
  create(content: string, clock: Clock): ScriptView;
  get(id: string, clock: Clock): ScriptView;
  requestChanges(
    id: string,
    input: { version: number; reason: string; dueDate: string },
    clock: Clock,
  ): ScriptView;
  submitVersion(id: string, content: string, clock: Clock): ScriptView;
  approve(id: string, version: number, clock: Clock): ScriptView;
}
