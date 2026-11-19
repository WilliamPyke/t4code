import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { linkMachineId, OsMachineId, parseOsMachineId } from "./linkMachineId.ts";

describe("parseOsMachineId", () => {
  it.each([
    {
      platform: "win32" as const,
      output:
        "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    1F2E3D4C-0000-4abc-9def-001122334455\r\n\r\n",
      expected: "1f2e3d4c-0000-4abc-9def-001122334455",
    },
    {
      platform: "darwin" as const,
      output:
        '+-o J314sAP  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformSerialNumber" = "C02XXXXXXX"\n      "IOPlatformUUID" = "ABCDEF01-2345-6789-ABCD-EF0123456789"\n    }\n',
      expected: "abcdef01-2345-6789-abcd-ef0123456789",
    },
    {
      platform: "linux" as const,
      output: "0123456789abcdef0123456789abcdef\n",
      expected: "0123456789abcdef0123456789abcdef",
    },
    { platform: "linux" as const, output: "\n", expected: null },
    {
      platform: "win32" as const,
      output: "ERROR: The system was unable to find it.",
      expected: null,
    },
    { platform: "darwin" as const, output: null, expected: null },
  ])("reads the $platform id from its probe output", ({ platform, output, expected }) => {
    expect(parseOsMachineId(platform, output)).toBe(expected);
  });
});

describe("linkMachineId", () => {
  const idFor = (input: {
    readonly osMachineId: string | null;
    readonly stateDir: string;
    readonly platform?: NodeJS.Platform;
  }) =>
    linkMachineId(input.stateDir).pipe(
      Effect.provideService(OsMachineId, Effect.succeed(input.osMachineId)),
      Effect.provideService(HostProcess.Platform, input.platform ?? "darwin"),
    );

  it.effect("is the same after a reinstall, and differs per computer and per folder", () =>
    Effect.gen(function* () {
      const first = yield* idFor({
        osMachineId: "machine-a",
        stateDir: "/Users/a/.tinkjam/userdata",
      });
      expect(first).toMatch(/^[0-9a-f]{64}$/u);
      expect(first).not.toContain("machine-a");
      expect(
        yield* idFor({ osMachineId: "machine-a", stateDir: "/Users/a/.tinkjam/userdata" }),
      ).toBe(first);
      expect(
        yield* idFor({ osMachineId: "machine-b", stateDir: "/Users/a/.tinkjam/userdata" }),
      ).not.toBe(first);
      expect(yield* idFor({ osMachineId: "machine-a", stateDir: "/Users/a/.t3/dev" })).not.toBe(
        first,
      );
      expect(
        yield* idFor({ osMachineId: null, stateDir: "/Users/a/.tinkjam/userdata" }),
      ).toBeNull();
      expect(
        yield* idFor({ osMachineId: "m", stateDir: "C:\\Users\\A\\.tinkjam", platform: "win32" }),
      ).toBe(
        yield* idFor({ osMachineId: "m", stateDir: "c:\\users\\a\\.tinkjam", platform: "win32" }),
      );
    }),
  );
});
