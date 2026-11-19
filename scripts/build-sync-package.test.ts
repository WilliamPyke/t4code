import { describe, expect, it } from "vite-plus/test";

import { packagesWithoutIntegrity, readWorkspaceCatalog } from "./build-sync-package.ts";

describe("readWorkspaceCatalog", () => {
  it("reads only the catalog block, with quoted and scoped names", () => {
    const yaml = [
      "packages:",
      "  - apps/*",
      "catalog:",
      "  undici: 8.12.4",
      '  "@effect/platform-node": "4.1.2"',
      "  effect: 4.1.2 # pinned",
      "overrides:",
      "  undici: 7.0.0",
    ].join("\n");
    expect(readWorkspaceCatalog(yaml)).toEqual({
      undici: "8.12.4",
      "@effect/platform-node": "4.1.2",
      effect: "4.1.2",
    });
  });
});

describe("packagesWithoutIntegrity", () => {
  it("names each downloaded package the lock does not pin by hash", () => {
    expect(
      packagesWithoutIntegrity({
        packages: {
          "": {},
          "node_modules/node-pty": { integrity: "sha512-abc" },
          "node_modules/zod": {},
          "node_modules/linked": { link: true },
          "node_modules/a/node_modules/bundled": { inBundle: true },
        },
      }),
    ).toEqual(["node_modules/zod"]);
  });
});
