import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

export interface FakeDb {
  client: SupabaseClient
  tables: Record<string, Row[]>
  /** Force the next matching operation to fail. */
  failNext: (table: string, op: 'select' | 'insert' | 'update', code?: string) => void
}

/**
 * Just enough of the supabase-js query builder to exercise booking
 * persistence against rows the test can inspect afterwards.
 */
export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = { ...seed }
  const failures: { table: string; op: string; code?: string }[] = []
  let nextId = 1

  function takeFailure(table: string, op: string) {
    const index = failures.findIndex((f) => f.table === table && f.op === op)
    if (index === -1) return null
    const [failure] = failures.splice(index, 1)
    return { message: 'forced failure', code: failure.code }
  }

  function from(table: string) {
    tables[table] ??= []
    const filters: ((row: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    let limit: number | null = null

    const apply = () => {
      const failure = takeFailure(table, op)
      if (failure) return { rows: [] as Row[], error: failure }
      if (op === 'insert') {
        const row = { id: `row-${nextId++}`, ...payload }
        tables[table].push(row)
        return { rows: [{ ...row }], error: null }
      }
      const rows = tables[table].filter((row) => filters.every((f) => f(row)))
      if (op === 'update') rows.forEach((row) => Object.assign(row, payload))
      // Copies, as a real client returns: later writes mustn't reach back
      // into a row the caller already read.
      const copies = rows.map((row) => ({ ...row }))
      return { rows: limit === null ? copies : copies.slice(0, limit), error: null }
    }

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return builder
      },
      neq: (column: string, value: unknown) => {
        filters.push((row) => row[column] !== value)
        return builder
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value)
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      lte: (column: string, value: string) => {
        filters.push((row) => row[column] != null && String(row[column]) <= value)
        return builder
      },
      gte: (column: string, value: string) => {
        filters.push((row) => row[column] != null && String(row[column]) >= value)
        return builder
      },
      gt: (column: string, value: string) => {
        filters.push((row) => row[column] != null && String(row[column]) > value)
        return builder
      },
      order: () => builder,
      limit: (count: number) => {
        limit = count
        return builder
      },
      insert: (row: Row) => {
        op = 'insert'
        payload = row
        return builder
      },
      update: (patch: Row) => {
        op = 'update'
        payload = patch
        return builder
      },
      maybeSingle: async () => {
        const { rows, error } = apply()
        return { data: rows[0] ?? null, error }
      },
      single: async () => {
        const { rows, error } = apply()
        return { data: rows[0] ?? null, error }
      },
      then: (resolve: (value: { data: Row[]; error: unknown }) => unknown) => {
        const { rows, error } = apply()
        return Promise.resolve(resolve({ data: rows, error }))
      },
    }
    return builder
  }

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    failNext: (table, op, code) => failures.push({ table, op, code }),
  }
}
