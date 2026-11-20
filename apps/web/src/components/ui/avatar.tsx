import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const avatarVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none ring-2 ring-[var(--avatar-ring,var(--color-page))]",
  {
    defaultVariants: { size: "md", tone: "person" },
    variants: {
      size: {
        xs: "size-5 text-3xs",
        sm: "size-6 text-3xs",
        md: "size-7.5 text-xs",
        lg: "size-10 text-[0.9375rem]",
      },
      tone: {
        // A teammate's own colour, passed as `color`; white initials keep 4.5:1 on every one.
        person: "text-white",
        forest: "bg-forest text-white",
        raspberry: "bg-raspberry text-white",
        accent: "bg-primary text-primary-foreground",
        // Ink initials on the light fills: white on them falls under 3.1:1.
        claude: "bg-claude text-brand-ink",
        sun: "bg-sun text-brand-ink",
        more: "bg-panel text-body",
      },
    },
  },
);

/** A person's initials from their name: first and last word, or the one word's first letter. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0]];
  return letters.join("").toUpperCase();
}

/** A person: initials on their colour, with a page-coloured ring so stacked avatars separate. */
export function Avatar({
  name,
  color,
  size,
  tone,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> &
  VariantProps<typeof avatarVariants> & {
    readonly name: string;
    /** The person's colour, for the default `person` tone. */
    readonly color?: string;
  }) {
  return (
    <span
      className={cn(avatarVariants({ size, tone }), className)}
      style={color === undefined ? style : { backgroundColor: color, ...style }}
      data-slot="avatar"
      {...props}
    >
      <span aria-hidden>{initialsOf(name)}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Overlapping avatars, 6px apart, with the rest counted as +N. */
export function AvatarStack({
  people,
  max = 4,
  size,
  label,
  className,
}: {
  readonly people: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly color?: string;
  }>;
  readonly max?: number;
  readonly size?: VariantProps<typeof avatarVariants>["size"];
  /** The list's accessible name, such as "People on this board". */
  readonly label: string;
  readonly className?: string;
}) {
  const shown = people.length > max ? people.slice(0, max - 1) : people;
  const rest = people.length - shown.length;
  return (
    <ul
      aria-label={label}
      className={cn("flex items-center ps-1.5 *:-ms-1.5", className)}
      data-slot="avatar-stack"
    >
      {shown.map((person) => (
        <li key={person.key} className="flex">
          <Avatar
            name={person.name}
            size={size}
            {...(person.color === undefined
              ? { tone: "accent" as const }
              : { color: person.color })}
          />
        </li>
      ))}
      {rest > 0 ? (
        <li className="flex">
          <span
            className={avatarVariants({ size, tone: "more" })}
            aria-label={`${rest} more`}
            data-slot="avatar"
          >
            +{rest}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
