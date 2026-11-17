import type { ClerkProviderProps } from "@clerk/react";

// Scoped to auth flows: UserProfile reuses formButtonPrimary for destructive confirmations.
const authFlowElements = {
  formButtonPrimary:
    "border-primary bg-primary bg-none text-primary-foreground shadow-xs shadow-primary/24 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
};

export const clerkAppearance = {
  // index.css orders this layer below components and utilities so the element classes below win.
  cssLayerName: "clerk",
  options: {
    shimmer: false,
    logoImageUrl: "/tinkjam-mark.svg",
    logoPlacement: "inside",
    // One clear button per way in reads better than a row of bare icons.
    socialButtonsVariant: "blockButton",
    showOptionalFields: false,
  },
  variables: {
    borderRadius: "0.5rem",
    // Clerk reuses its primary color for filled buttons and bare links.
    colorPrimary: "var(--update-foreground)",
    colorPrimaryForeground: "var(--card)",
    colorDanger: "var(--error)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorNeutral: "var(--contrast-foreground)",
    colorForeground: "var(--contrast-foreground)",
    // Clerk's muted token fills the footer; derive an opaque surface instead of stock dark translucency.
    colorMuted: "color-mix(in srgb, var(--card) 98%, var(--contrast-foreground))",
    colorMutedForeground: "var(--contrast-muted-foreground)",
    colorBackground: "var(--card)",
    colorInputForeground: "var(--contrast-foreground)",
    colorInput: "var(--secondary)",
    colorRing: "var(--ring)",
  },
  elements: {
    // The board's dotted canvas behind the sign-in, as on the welcome and join pages.
    modalBackdrop:
      "dialog-backdrop z-50 bg-[radial-gradient(var(--color-board-dot)_1px,transparent_1px)] bg-size-[24px_24px]",
    cardBox: "dialog-glass rounded-2xl border",
    // "Last used" means nothing to someone on a new browser, or to two people sharing one.
    lastAuthenticationStrategyBadge: "hidden",
    card: "border-0 bg-transparent shadow-none",
    footer: "bg-transparent bg-none",
    header: "items-start text-start",
    headerTitle: "text-xl font-semibold",
    headerSubtitle: "text-sm text-muted-foreground",
    buttonArrowIcon: "hidden",
    formFieldErrorText: { color: "var(--error-foreground)" },
    formFieldWarningText: { color: "var(--warning-foreground)" },
    formFieldSuccessText: { color: "var(--success-foreground)" },
    otpCodeFieldErrorText: { color: "var(--error-foreground)" },
    otpCodeFieldSuccessText: { color: "var(--success-foreground)" },
  },
  signIn: { elements: authFlowElements },
  signUp: { elements: authFlowElements },
} satisfies NonNullable<ClerkProviderProps["appearance"]>;

const TO_CONTINUE = "to continue to Tinkjam";
// The one line of what Tinkjam is, under every first step.
const VALUE = "Your team and your agents on one board, on every device.";

/**
 * Clerk names the product with its dashboard's application name; every line that would show it
 * says Tinkjam instead.
 */
export const clerkLocalization = {
  signIn: {
    start: {
      title: "Sign in to Tinkjam",
      subtitle: VALUE,
      titleCombined: "Continue to Tinkjam",
      subtitleCombined: `${VALUE} New here? The same email makes your account.`,
      actionText: "New to Tinkjam?",
      actionLink: "Create an account",
    },
    password: { subtitle: TO_CONTINUE },
    passkey: { subtitle: TO_CONTINUE },
    emailCode: { subtitle: TO_CONTINUE },
    emailLink: { subtitle: TO_CONTINUE },
    phoneCode: { subtitle: TO_CONTINUE },
  },
  signUp: {
    start: {
      title: "Create your Tinkjam account",
      titleCombined: "Create your Tinkjam account",
      subtitle: VALUE,
      subtitleCombined: VALUE,
      actionText: "Already use Tinkjam?",
      actionLink: "Sign in",
    },
    emailCode: { subtitle: TO_CONTINUE },
    emailLink: { subtitle: TO_CONTINUE },
    phoneCode: { subtitle: TO_CONTINUE },
    continue: { subtitle: TO_CONTINUE },
  },
} satisfies NonNullable<ClerkProviderProps["localization"]>;
