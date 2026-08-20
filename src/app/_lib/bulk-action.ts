/**
 * Runs `action` once per id, sequentially (not Promise.all — these are user-
 * initiated destructive/state-changing calls against the same few backend
 * routes, and running them one at a time avoids hammering the API with a
 * burst of concurrent requests for a bulk action the user just clicked).
 * Failures are caught individually so one bad id doesn't stop the rest;
 * `action` controls the exact failure message by what it throws (e.g.
 * prefixing it with an identifying label) — this only collects them.
 */
export async function runBulkAction(ids: string[], action: (id: string) => Promise<void>): Promise<string[]> {
  const failures: string[] = [];
  for (const id of ids) {
    try {
      await action(id);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  return failures;
}
