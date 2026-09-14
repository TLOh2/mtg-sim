import { shortName } from "./RunList";

/** Row = attacker, column = defender, cell = total combat damage dealt. */
export function ThreatMatrixTable({
  matrix,
  players,
}: {
  matrix: Record<string, Record<string, number>>;
  players: string[];
}) {
  const hasAnyDamage = players.some((p) => players.some((q) => p !== q && (matrix[p]?.[q] ?? 0) > 0));
  if (!hasAnyDamage) {
    return <p className="muted">No combat damage recorded between players yet.</p>;
  }

  return (
    <div className="threat-matrix-wrap">
      <table className="deck-stats-table threat-matrix-table">
        <thead>
          <tr>
            <th>Attacker \ Target</th>
            {players.map((p) => (
              <th key={p}>{shortName(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((attacker) => (
            <tr key={attacker}>
              <th scope="row">{shortName(attacker)}</th>
              {players.map((defender) => {
                const amount = matrix[attacker]?.[defender] ?? 0;
                return (
                  <td key={defender} className={attacker === defender ? "threat-matrix-diagonal" : undefined}>
                    {attacker === defender ? "—" : amount > 0 ? amount : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
