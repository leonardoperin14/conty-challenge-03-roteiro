export const TIME_ZONE = "America/Sao_Paulo";

export type VersionStatus = "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED";

export interface ScriptVersion {
  version: number;
  content: string;
  status: VersionStatus;
  submittedAt: string;
  approvedAt: string | null;
  review: {
    reason: string;
    dueDate: string;
    requestedAt: string;
  } | null;
}

export interface ScriptView {
  id: string;
  createdAt: string;
  status: VersionStatus;
  currentVersion: number;
  timezone: typeof TIME_ZONE;
  pendingRequestExpired: boolean;
  versions: ScriptVersion[];
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function civilDateAt(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new AppError("INTERNAL_ERROR", 500, "Relógio retornou um instante inválido.");
  }

  const parts = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

export interface CurrentVersion {
  version: number;
  status: VersionStatus;
  dueDate: string | null;
}

function assertVersionTarget(current: CurrentVersion, targetVersion: number): void {
  if (current.version !== targetVersion) {
    throw new AppError("VERSION_CONFLICT", 409, "A ação precisa apontar para a versão atual.");
  }
}

export function assertCanRequestChanges(
  current: CurrentVersion,
  targetVersion: number,
  dueDate: string,
  now: Date,
): void {
  if (current.status === "APPROVED") {
    throw new AppError("SCRIPT_APPROVED", 409, "O roteiro já foi aprovado.");
  }
  assertVersionTarget(current, targetVersion);
  if (current.status !== "SUBMITTED") {
    throw new AppError("INVALID_TRANSITION", 409, "A versão atual não pode receber outro pedido.");
  }
  if (dueDate < civilDateAt(now)) {
    throw new AppError("DEADLINE_IN_PAST", 422, "O prazo não pode estar no passado em São Paulo.");
  }
}

export function assertCanSubmitVersion(current: CurrentVersion, now: Date): void {
  if (current.status === "APPROVED") {
    throw new AppError("SCRIPT_APPROVED", 409, "O roteiro já foi aprovado.");
  }
  if (current.status !== "CHANGES_REQUESTED" || !current.dueDate) {
    throw new AppError("INVALID_TRANSITION", 409, "Não há um pedido de alteração pendente.");
  }
  if (civilDateAt(now) > current.dueDate) {
    throw new AppError("DEADLINE_EXPIRED", 409, "O prazo para enviar uma nova versão expirou.");
  }
}

export function assertCanApprove(current: CurrentVersion, targetVersion: number): void {
  if (current.status === "APPROVED") {
    throw new AppError("SCRIPT_APPROVED", 409, "O roteiro já foi aprovado.");
  }
  assertVersionTarget(current, targetVersion);
  if (current.status !== "SUBMITTED") {
    throw new AppError("INVALID_TRANSITION", 409, "Só é possível aprovar uma versão enviada.");
  }
}
