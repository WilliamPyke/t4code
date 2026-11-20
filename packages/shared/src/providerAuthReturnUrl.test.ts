import { describe, expect, it } from "vite-plus/test";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each(["t3code", "t3code-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it.each(["https://app.tinkjam.com", "https://app.trellium.org"])(
    "returns to the hosted app on %s",
    (origin) => {
      expect(providerAuthReturnUrl(`${origin}/welcome#agents:machine-id`)).toBe(
        `${origin}/welcome#agents:machine-id`,
      );
    },
  );
  it.each([
    "https://app.tinkjam.com.attacker.example/welcome",
    "t3code://attacker/welcome",
    "t3code://app/welcome/../evil",
    "https://attacker.example/welcome",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
