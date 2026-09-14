// Mirrors spec.json#data_model.GameEvent / TurningPoint.

export type EventType =
  | "GAME_OUTCOME"
  | "MATCH_RESULTS"
  | "TURN"
  | "MULLIGAN"
  | "ANTE"
  | "DRAFT"
  | "ZONE_CHANGE"
  | "PLAYER_CONTROL"
  | "DAMAGE"
  | "LIFE"
  | "LAND"
  | "DISCARD"
  | "COMBAT"
  | "INFORMATION"
  | "STACK_RESOLVE"
  | "STACK_ADD"
  | "EFFECT_REPLACED"
  | "MANA"
  | "PHASE"
  | "UNCLASSIFIED";

export interface GameEvent {
  turn: number;
  index: number;
  type: EventType;
  raw: string;
  playersInvolved: string[];
}

// Keep in sync with spec.json#turning_point_signals[].id.
export type TurningPointSignalId =
  | "board_wipe"
  | "large_life_swing"
  | "player_elimination"
  | "commander_cast_or_recast"
  | "extra_turn"
  | "mass_land_destruction"
  | "combo_loop_detected"
  | "lethal_combat"
  | "key_counterspell";
// "big_card_draw" from spec.json is intentionally not a member here - see
// turningPoints.ts's top-of-file note on why it can't be detected from
// Forge's default log output.

export interface TurningPoint {
  signalId: TurningPointSignalId;
  eventIndex: number;
  description: string;
}

// Structured events from Forge's internal typed event bus (see
// engine/forge/forge-gui-desktop/.../AnalyticsEventLogger.java), captured
// alongside the free-text game log above rather than parsed from it. Phase 1
// subset (see mtg-sim-analytics-spec.md) - loosely typed since the schema is
// still being validated against real output; tighten once it settles.
export interface AnalyticsEvent {
  type: string;
  [field: string]: unknown;
}
