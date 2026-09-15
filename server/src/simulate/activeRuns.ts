import { exec, type ChildProcess } from "node:child_process";

// Tracks the in-flight Forge process for each run so the API can cancel one
// after the original POST /api/runs request has already returned (fire-and-
// forget - see startPodFromDecklistText's own doc comment). Cleared as soon
// as the process exits, cancelled or not, so a stale entry can never be
// cancelled twice.
const activeChildren = new Map<string, ChildProcess>();

// A killed process still surfaces as a nonzero exit to forgeRunner's own
// close handler, which would otherwise report it as a generic failure. This
// tracks which exits were actually a deliberate user cancellation so
// runAndAnalyzePod can label the run "cancelled" instead of "failed".
const cancelledRunIds = new Set<string>();

export function registerActiveRun(runId: string, child: ChildProcess): void {
  activeChildren.set(runId, child);
  child.once("exit", () => {
    if (activeChildren.get(runId) === child) activeChildren.delete(runId);
  });
}

/** Returns true if a running process was found and asked to stop. */
export function cancelRun(runId: string): boolean {
  const child = activeChildren.get(runId);
  if (!child) return false;
  cancelledRunIds.add(runId);

  // forgeRunner spawns java directly now (see javaSim.ts) - `child` is the
  // real Forge JVM's own process, so in principle a plain child.kill() would
  // reach it. Still routed through taskkill /T on Windows out of caution:
  // this bit us before when an intermediate shell was in the chain (a plain
  // kill() only killed the shell wrapper, silently orphaning Forge for
  // minutes), and /T costs nothing extra now that there's no tree to speak
  // of - it just also catches any child the JVM itself happens to spawn.
  if (process.platform === "win32" && child.pid) {
    exec(`taskkill /PID ${child.pid} /T /F`, () => {
      // Best-effort: a race where the process already exited on its own is
      // fine (taskkill just reports "not found"), not worth surfacing.
    });
  } else {
    child.kill();
  }
  return true;
}

export function wasCancelled(runId: string): boolean {
  return cancelledRunIds.has(runId);
}
