import { useEffect, useState } from "react";

type ThemePref = "light" | "dark" | "system";
const STORAGE_KEY = "mtg-sim-theme";

function applyTheme(pref: ThemePref) {
  if (pref === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", pref);
  }
}

function readStoredPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) - fall back to system.
  }
  return "system";
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readStoredPref);

  // Applying the theme is a side effect on the document (an external
  // system), so it belongs in an effect even though the state itself is
  // initialized lazily above.
  useEffect(() => {
    applyTheme(pref);
  }, [pref]);

  function cycle() {
    // system -> dark -> light -> system, so there's always a one-click path
    // to "just make it dark" from a fresh load.
    const next: ThemePref = pref === "system" ? "dark" : pref === "dark" ? "light" : "system";
    setPref(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort - a failed save just means it reverts to system next load
    }
  }

  const label = pref === "system" ? "Theme: Auto" : pref === "dark" ? "Theme: Dark" : "Theme: Light";
  const icon = pref === "system" ? "◑" : pref === "dark" ? "\u{1F319}" : "☀️";

  return (
    <button type="button" className="secondary theme-toggle" onClick={cycle} title="Cycle theme: auto / dark / light">
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
}
