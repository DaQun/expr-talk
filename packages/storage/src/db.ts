/**
 * 生产环境唯一数据源：Tauri Rust 侧 SQLite（src-tauri/src/db/，schema 版本化迁移）。
 * 本包仅在浏览器开发环境（无 Tauri IPC）下提供 InMemoryDb 内存后备与 repository 接口。
 * 注意：schema/列变更必须改 Rust 侧版本化迁移，本包不承载真实迁移逻辑。
 */

export type SqlValue = string | number | null;

export interface DbClient {
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  select<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

/** 极简内存 DB：仅用于开发期 mock，不解析真实 SQL */
export class InMemoryDb implements DbClient {
  private store = new Map<string, Map<string, unknown>>();

  async execute(_sql: string, _params?: SqlValue[]): Promise<void> {
    // no-op for stub
  }

  async select<T>(_sql: string, _params?: SqlValue[]): Promise<T[]> {
    return [];
  }

  /** 直接按表操作（mock helpers） */
  table(name: string): Map<string, unknown> {
    if (!this.store.has(name)) this.store.set(name, new Map());
    return this.store.get(name)!;
  }
}
