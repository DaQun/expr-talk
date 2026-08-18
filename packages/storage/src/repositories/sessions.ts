import type {
  CreateSessionInput,
  HistoryQuery,
  TrainingSession,
} from "@showtalk/shared";
import type { InMemoryDb } from "../db";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(): string {
  return `ses_${Math.random().toString(36).slice(2, 12)}`;
}

export class SessionRepository {
  constructor(private readonly db: InMemoryDb) {}

  async create(input: CreateSessionInput): Promise<TrainingSession> {
    const session: TrainingSession = {
      id: createId(),
      mode: input.mode,
      topic: input.topic,
      goal: input.goal,
      status: "created",
      startedAt: nowIso(),
      liveTranscript: [],
      parentSessionId: input.parentSessionId,
      round: input.round,
      targetIssue: input.targetIssue,
    };
    this.db.table("sessions").set(session.id, session);
    return structuredClone(session);
  }

  async update(session: TrainingSession): Promise<TrainingSession> {
    this.db.table("sessions").set(session.id, structuredClone(session));
    return structuredClone(session);
  }

  async get(id: string): Promise<TrainingSession | null> {
    const row = this.db.table("sessions").get(id) as TrainingSession | undefined;
    return row ? structuredClone(row) : null;
  }

  async delete(id: string): Promise<void> {
    this.db.table("sessions").delete(id);
  }

  async list(query: HistoryQuery = {}): Promise<TrainingSession[]> {
    let rows = [...this.db.table("sessions").values()] as TrainingSession[];
    if (query.mode) {
      rows = rows.filter((r) => r.mode === query.mode);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.topic.toLowerCase().includes(q) ||
          (r.finalTranscript ?? "").toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return rows.slice(offset, offset + limit).map((r) => structuredClone(r));
  }
}
