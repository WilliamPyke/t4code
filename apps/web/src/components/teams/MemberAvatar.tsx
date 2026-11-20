import { useState } from "react";

/** A person's account picture, or the first letter of their name when it has none or fails. */
export function MemberAvatar({
  name,
  avatarUrl,
}: {
  readonly name: string;
  readonly avatarUrl: string | null | undefined;
}) {
  const [failed, setFailed] = useState(false);
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        className="size-5 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-3xs text-muted-foreground"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
