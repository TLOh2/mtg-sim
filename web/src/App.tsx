import { useState } from "react";
import { RunList } from "./components/RunList";
import { RunDetailView } from "./components/RunDetailView";
import { GameLogView } from "./components/GameLogView";

type View = { name: "list" } | { name: "run"; runId: string } | { name: "game"; runId: string; gameIndex: number };

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });

  return (
    <div className="app">
      <header>
        <h1>Commander Simulator Results</h1>
      </header>
      <main>
        {view.name === "list" && <RunList onSelectRun={(runId) => setView({ name: "run", runId })} />}
        {view.name === "run" && (
          <RunDetailView
            runId={view.runId}
            onSelectGame={(gameIndex) => setView({ name: "game", runId: view.runId, gameIndex })}
            onBack={() => setView({ name: "list" })}
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
