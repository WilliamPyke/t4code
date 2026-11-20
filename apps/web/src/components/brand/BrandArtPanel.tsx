import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { ART_AGENTS, type ArtAgent } from "./agentArt";
import bluePaint from "./blue-paint.jpg";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const ROTATE_MS = 2600;

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
}

/** One agent in a white pill. Several take turns; under reduced motion the first stays. */
function AgentPill({ agents }: { readonly agents: ReadonlyArray<ArtAgent> }) {
  const reduced = useReducedMotion();
  const [turn, setTurn] = useState(0);
  const rotates = !reduced && agents.length > 1;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: the pill's agent takes turns while it shows
  useEffect(() => {
    if (!rotates) return;
    const timer = setInterval(() => setTurn((current) => current + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotates]);
  const agent = agents[rotates ? turn % agents.length : 0];
  if (agent === undefined) return null;
  return (
    <span key={rotates ? turn : 0} className="brand-art-pill motion-safe:animate-page-fade">
      <img src={agent.icon} alt="" />
      {agent.name}
    </span>
  );
}

const TEAMMATES = [
  { initial: "P", tone: "bg-brand-forest text-white" },
  { initial: "S", tone: "bg-brand-raspberry text-white" },
  { initial: "M", tone: "bg-brand-claude text-white" },
  { initial: "+4", tone: "bg-brand-sun text-brand-ink" },
];

function Teammates() {
  return (
    <span className="brand-art-people">
      {TEAMMATES.map((person) => (
        <span key={person.initial} className={cn("brand-art-person", person.tone)}>
          {person.initial}
        </span>
      ))}
    </span>
  );
}

const Line = ({ children }: { readonly children: ReactNode }) => (
  <span className="brand-art-line">{children}</span>
);

type ArtHeadline =
  | { readonly kind: "build" }
  | { readonly kind: "bring" }
  /** Rotates through the agents really ready on the person's computer. */
  | { readonly kind: "on"; readonly agents: ReadonlyArray<ArtAgent> };

function headlineLabel(headline: ArtHeadline): string {
  switch (headline.kind) {
    case "build":
      return "build beautiful things with your AI agent and your teammates";
    case "bring":
      return "bring your AI agent to your team's board";
    case "on": {
      const names = headline.agents.map((agent) => agent.name);
      return `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} on your team's board`;
    }
  }
}

/**
 * The cobalt art half of sign-in and connecting a computer: the paint photo, the headline and,
 * on a wide screen, floating cards. It is artwork, so it stays cobalt in every theme. Everything
 * but the headline's one static name is hidden from assistive tech.
 */
export function BrandArtPanel({
  headline,
  children,
}: {
  readonly headline: ArtHeadline;
  /** Floating cards, placed by the caller; shown only where there is room, from 1280px. */
  readonly children?: ReactNode;
}) {
  return (
    <aside className="relative isolate m-4 mt-0 overflow-hidden rounded-3xl bg-brand-cobalt-deep min-[900px]:mt-4">
      <img
        src={bluePaint}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 -z-10 size-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-linear-165 from-brand-cobalt-deep to-brand-cobalt opacity-50"
      />
      <p className="sr-only">{headlineLabel(headline)}</p>
      <div
        aria-hidden
        className="brand-art-headline flex flex-col font-brand font-semibold text-white select-none max-[899px]:p-6 max-[899px]:sm:p-10 min-[900px]:absolute min-[900px]:top-24 min-[900px]:left-13"
      >
        {headline.kind === "build" ? (
          <>
            <Line>build beautiful</Line>
            <Line>
              things with <AgentPill agents={ART_AGENTS} />
            </Line>
            <Line>
              and <Teammates />
            </Line>
          </>
        ) : headline.kind === "bring" ? (
          <>
            <Line>
              bring <AgentPill agents={ART_AGENTS} />
            </Line>
            <Line>to your team's</Line>
            <Line>board</Line>
          </>
        ) : (
          <>
            <Line>
              <AgentPill agents={headline.agents} /> is on
            </Line>
            <Line>your team's</Line>
            <Line>board</Line>
          </>
        )}
      </div>
      {children ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden min-[1280px]:block">
          {children}
        </div>
      ) : null}
    </aside>
  );
}

/** A white card floating on the art, as the board's own cards look. */
export function ArtCard({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <div className={cn("brand-art-card", className)}>{children}</div>;
}

/** The line from a computer card to its agent card. */
export function ArtConnector({ tone }: { readonly tone: "waiting" | "sun" | "connected" }) {
  return <div className="brand-art-connector" data-tone={tone} />;
}

/** The laptop outline the computer cards share. */
export function LaptopGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 34 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="5" y="2" width="24" height="17" rx="2.5" />
      <path d="M1 25h32" />
    </svg>
  );
}
