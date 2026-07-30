/**
 * SQLite 连接将由 Tauri Rust 侧持有。
 * 本模块提供 TS 侧 repository 接口与内存实现，便于前端开发与单测。
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
