/**
 * Minimal type declarations for sql.js (WASM SQLite).
 * Only the subset of the API used by this project is typed here.
 */

declare module 'sql.js' {
  export interface QueryExecResult {
    columns: string[]
    values: (string | number | Uint8Array | null)[][]
  }

  export interface ParamsObject {
    [key: string]: string | number | Uint8Array | null
  }

  export type BindParams = ParamsObject | (string | number | Uint8Array | null)[]

  export interface Statement {
    bind(params?: BindParams): boolean
    step(): boolean
    get(params?: BindParams): (string | number | Uint8Array | null)[]
    getAsObject(params?: BindParams): Record<string, string | number | Uint8Array | null>
    getColumnNames(): string[]
    run(params?: BindParams): void
    reset(): void
    free(): boolean
    freemem(): void
  }

  export interface Database {
    run(sql: string, params?: BindParams): Database
    exec(sql: string, params?: BindParams): QueryExecResult[]
    each(sql: string, params: BindParams, callback: (row: Record<string, unknown>) => void, done?: () => void): Database
    prepare(sql: string, params?: BindParams): Statement
    export(): Uint8Array
    close(): void
    getRowsModified(): number
    create_function(name: string, func: (...args: unknown[]) => unknown): Database
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>

  export default initSqlJs
}
