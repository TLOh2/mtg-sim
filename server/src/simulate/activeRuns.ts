import { exec, type ChildProcess } from "node:child_process";

// Tracks the in-flight Forge processes for each run so the API can cancel one
// after the original POST /api/runs request has already returned (fire-and-
// forget - see startPodFromDecklistText's own doc comment). A run can have
// several at once (forgeRunner splits a run into parallel batches), and each
// is dropped as soon as it exits, cancelled or not.
const activeChildren = new Map<string, Set<ChildProcess>>();

// A killed process still surfaces as a nonzero exit to forgeRunner's own
// close handler, which would otherwise report it as a generic failure. This
// tracks which exits were actually a deliberate user cancellation so
// runAndAnalyzePod can label the run "cancelled" instead of "failed".
const cancelledRunIds = new Set<string>();

export function registerActiveRun(runId: string, child: ChildProcess): void {
  if (!activeChildren.has(runId)) activeChildren.set(runId, new Set());
  activeChildren.get(runId)!.add(child);
  child.once("exit", () => {
    const children = activeChildren.get(runId);
    children?.delete(child);
    if (children?.size === 0) activeChildren.delete(runId);
  });
}

/**
 * forgeRunner spawns java directly (see javaSim.ts), so `child` is the real
 * Forge JVM. Still routed through taskkill /T on Windows out of caution: this
 * bit us before when an intermediate shell was in the chain (a plain kill()
 * only killed the shell wrapper, silently orphaning Forge for minutes), and /T
 * also catches any child the JVM itself happens to spawn.
 */
export function killProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    exec(`taskkill /PID ${child.pid} /T /F`, () => {
      // Best-effort: a race where the process already exited on its own is
      // fine (taskkill just reports "not found"), not worth surfacing.
    });
  } else {
    child.kill();
  }
}

/** Returns true if at least one running process was found and asked to stop. */
export function cancelRun(runId: string): boolean {
  const children = activeChildren.get(runId);
  if (!children || children.size === 0) return false;
  cancelledRunIds.add(runId);
  for (const child of children) killProcess(child);
  return true;
}

export function wasCancelled(runId: string): boolean {
  return cancelledRunIds.has(runId);
}
