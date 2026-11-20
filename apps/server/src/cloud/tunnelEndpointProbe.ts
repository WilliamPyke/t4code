// @effect-diagnostics nodeBuiltinImport:off - Direct DNS queries and a request pinned to their answer need node:dns and node:https.
import * as NodeDns from "node:dns";
import type * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Never resolve the tunnel hostname through the OS: macOS caches an NXDOMAIN from before the
// record existed for the zone's negative TTL (~40 min). Direct c-ares queries skip that cache,
// and the request is pinned to their answer, SNI and Host unchanged so TLS still verifies.

export interface DirectResolver {
  /** Which servers it asks, for the reason when nothing answers. */
  readonly name: string;
  readonly resolve4: (hostname: string) => Promise<ReadonlyArray<string>>;
  readonly resolve6: (hostname: string) => Promise<ReadonlyArray<string>>;
}

export type TunnelHostResolution =
  | { readonly kind: "resolved"; readonly address: string; readonly family: 4 | 6 }
  | { readonly kind: "unresolved"; readonly reason: string };

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "error";

/** The first address any resolver finds, IPv4 first; otherwise what each said. */
export async function resolveTunnelHost(
  hostname: string,
  resolvers: ReadonlyArray<DirectResolver>,
): Promise<TunnelHostResolution> {
  const answers: Array<string> = [];
  for (const resolver of resolvers) {
    for (const family of [4, 6] as const) {
      try {
        const addresses = await (family === 4 ? resolver.resolve4 : resolver.resolve6)(hostname);
        if (addresses[0] !== undefined) return { kind: "resolved", address: addresses[0], family };
      } catch (error) {
        if (family === 4) answers.push(`${resolver.name}: ${errorCode(error)}`);
      }
    }
  }
  return {
    kind: "unresolved",
    reason: `${hostname} does not resolve yet (${answers.join("; ") || "no address"})`,
  };
}

const QUERY_TIMEOUT_MS = 3000;

const nodeResolver = (name: string, servers?: ReadonlyArray<string>): DirectResolver => {
  const resolver = new NodeDns.promises.Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 2 });
  if (servers !== undefined) resolver.setServers([...servers]);
  return {
    name,
    resolve4: (hostname) => resolver.resolve4(hostname),
    resolve6: (hostname) => resolver.resolve6(hostname),
  };
};

/** This computer's DNS servers, asked directly, then public ones in case those are filtered. */
const defaultResolvers = (): ReadonlyArray<DirectResolver> => [
  nodeResolver("this computer's DNS servers"),
  nodeResolver("public DNS (1.1.1.1, 8.8.8.8)", ["1.1.1.1", "8.8.8.8"]),
];

export type PinnedResponse =
  | {
      readonly kind: "status";
      readonly status: number;
      /** The body, read only when asked for; interrupting it closes the response. */
      readonly text: Effect.Effect<string>;
    }
  | { readonly kind: "timeout" | "network_error" };

const MAX_BODY_BYTES = 64 * 1024;

const readText = (response: NodeHttp.IncomingMessage) =>
  Effect.callback<string>((resume) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      if (body.length < MAX_BODY_BYTES) body += chunk;
    });
    response.once("end", () => resume(Effect.succeed(body)));
    response.once("error", () => resume(Effect.succeed(body)));
    return Effect.sync(() => response.destroy());
  });

/** GET `https://<hostname><path>` connected to `address`. */
const pinnedGet = (input: {
  readonly hostname: string;
  readonly path: string;
  readonly address: string;
  readonly family: 4 | 6;
  readonly timeoutMs: number;
}) =>
  Effect.callback<PinnedResponse>((resume) => {
    let settled = false;
    const finish = (response: PinnedResponse) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(response));
    };
    const request = NodeHttps.get(
      {
        host: input.hostname,
        servername: input.hostname,
        path: input.path,
        headers: { accept: "application/json" },
        timeout: input.timeoutMs,
        // Node asks for `all` addresses on some paths; answer both shapes with the pinned one.
        lookup: (_hostname, options, callback) => {
          const pinned = { address: input.address, family: input.family };
          if (typeof options === "object" && options.all === true) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        // Only Cloudflare's 530 page has a body worth reading; drain the rest.
        if (status !== 530) response.resume();
        finish({
          kind: "status",
          status,
          text: status === 530 ? readText(response) : Effect.succeed(""),
        });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      finish({ kind: "timeout" });
    });
    request.on("error", () => finish({ kind: "network_error" }));
    return Effect.sync(() => request.destroy());
  });

export type TunnelEndpointResponse =
  | PinnedResponse
  | { readonly kind: "unresolved"; readonly reason: string };

/** GETs a path on a tunnel hostname, resolved directly and pinned as above. */
export class TunnelEndpoint extends Context.Service<
  TunnelEndpoint,
  {
    readonly get: (input: {
      readonly hostname: string;
      readonly path: string;
      readonly timeoutMs: number;
    }) => Effect.Effect<TunnelEndpointResponse>;
  }
>()("t3/cloud/tunnelEndpointProbe/TunnelEndpoint") {}

export const layer = Layer.sync(TunnelEndpoint, () => {
  const resolvers = defaultResolvers();
  return TunnelEndpoint.of({
    get: Effect.fn("TunnelEndpoint.get")(function* ({ hostname, path, timeoutMs }) {
      const resolution = yield* Effect.promise(() => resolveTunnelHost(hostname, resolvers));
      if (resolution.kind === "unresolved") return resolution as TunnelEndpointResponse;
      const { address, family } = resolution;
      return (yield* pinnedGet({
        hostname,
        path,
        address,
        family,
        timeoutMs,
      })) as TunnelEndpointResponse;
    }),
  });
});
