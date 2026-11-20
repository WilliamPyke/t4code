import claudeIcon from "./agents/claude-icon.svg";
import cursorIcon from "./agents/cursor-icon.svg";
import grokIcon from "./agents/grok-icon.svg";
import openaiIcon from "./agents/openai-icon.svg";

export interface ArtAgent {
  readonly driver: string;
  readonly name: string;
  readonly icon: string;
}

/** The agents the art names, by the driver that runs each. The only place all four always show. */
export const ART_AGENTS: ReadonlyArray<ArtAgent> = [
  { driver: "claudeAgent", name: "Claude", icon: claudeIcon },
  { driver: "codex", name: "Codex", icon: openaiIcon },
  { driver: "grok", name: "Grok", icon: grokIcon },
  { driver: "cursor", name: "Cursor", icon: cursorIcon },
];

export const artAgentFor = (driver: string): ArtAgent | null =>
  ART_AGENTS.find((agent) => agent.driver === driver) ?? null;
