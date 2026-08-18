import type { Utterance } from "@showtalk/shared";
import type { InMemoryDb } from "../db";

export class UtteranceRepository {
  constructor(private readonly db: InMemoryDb) {}

  async replaceForSession(sessionId: string, utterances: Utterance[]): Promise<void> {
    const table = this.db.table("utterances");
    for (const [id, value] of table.entries()) {
      const u = value as Utterance;
      if (u.sessionId === sessionId) table.delete(id);
    }
    for (const u of utterances) {
      table.set(u.id, structuredClone(u));
    }
  }

  async listBySession(sessionId: string): Promise<Utterance[]> {
    return [...this.db.table("utterances").values()]
      .map((v) => v as Utterance)
      .filter((u) => u.sessionId === sessionId)
      .map((u) => structuredClone(u));
  }
}
