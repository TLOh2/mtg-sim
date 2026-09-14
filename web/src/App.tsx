import { useState } from "react";
import { RunList } from "./components/RunList";
import { RunDetailView } from "./components/RunDetailView";
import { GameLogView } from "./components/GameLogView";
import { DeckLeaderboardView } from "./components/DeckLeaderboardView";
import { ThemeToggle } from "./components/ThemeToggle";

type View =
  | { name: "list" }
  | { name: "run"; runId: string }
  | { name: "game"; runId: string; gameIndex: number }
  | { name: "leaderboard" };

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });

  return (
    <div className="app">
      <header className="app-header">
        <h1>Commander Simulator Results</h1>
        <div className="run-header-actions">
          {view.name !== "leaderboard" && (
            <button type="button" className="secondary" onClick={() => setView({ name: "leaderboard" })}>
              Deck leaderboard
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main>
        {view.name === "list" && <RunList onSelectRun={(runId) => setView({ name: "run", runId })} />}
        {view.name === "leaderboard" && <DeckLeaderboardView onBack={() => setView({ name: "list" })} />}
        {view.name === "run" && (
          <RunDetailView
            runId={view.runId}
            onSelectGame={(gameIndex) => setView({ name: "game", runId: view.runId, gameIndex })}
            onBack={() => setView({ name: "list" })}
            onRunStarted={(runId) => setView({ name: "run", runId })}
          />
        )}
        {view.name === "game" && (
          <GameLogView
            runId={view.runId}
            gameIndex={view.gameIndex}
            onBack={() => setView({ name: "run", runId: view.runId })}
          />
        )}
      </main>
    </div>
  );
}
