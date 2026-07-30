import { DEFAULT_SETTINGS, type AppSettings } from "@expr-talk/shared";
import type { InMemoryDb } from "../db";

const SETTINGS_KEY = "app";

export class SettingsRepository {
  constructor(private readonly db: InMemoryDb) {}

  async get(): Promise<AppSettings> {
    const row = this.db.table("settings").get(SETTINGS_KEY) as
      | AppSettings
      | undefined;
    return structuredClone(row ?? DEFAULT_SETTINGS);
  }

  async save(settings: AppSettings): Promise<void> {
    this.db.table("settings").set(SETTINGS_KEY, structuredClone(settings));
  }
}
