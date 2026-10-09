import { z } from "zod";

const nonBlank = z.string().refine((value) => value.trim().length > 0, {
  message: "Deve conter ao menos um caractere não branco.",
});

export const createScriptSchema = z.strictObject({
  content: nonBlank,
});

export const requestChangesSchema = z.strictObject({
  version: z.number().int().positive(),
  reason: nonBlank,
  dueDate: z.iso.date(),
});

export const submitVersionSchema = z.strictObject({
  content: nonBlank,
});

export const approveSchema = z.strictObject({
  version: z.number().int().positive(),
});
