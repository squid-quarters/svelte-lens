import { connect, type AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SESSIONS, SESSION_IDLE_TTL_MS } from "./constants.js";

const stdioTransports = vi.hoisted(
  () =>
    [] as Array<{
      onmessage?: (message: unknown) => void;
      sent: Array<{ id?: number; result?: unknown }>;
    }>,
);

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  // Stand-in transport so the stdio test never reads the worker's real stdin.
  StdioServerTransport: class {
    onclose?: () => void;
    onmessage?: (message: unknown) => void;
    sent: Array<{ id?: number; result?: unknown }> = [];
    constructor() {
      stdioTransports.push(this);
    }
    async start() {}
    async send(message: { id?: number; result?: unknown }) {
      this.sent.push(message);
    }
    async close() {
      this.onclose?.();
    }
  },
}));

type ServerModule = typeof import("./server.js");

const loadServer = async (): Promise<ServerModule> => {
  vi.resetModules();
  return import("./server.js");
};

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });

const send = (
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });

const initialize = (port: number) =>
  send(
    port,
    "POST",
    "/mcp",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }),
    { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  );

let server: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  }
});

describe("MCP HTTP server", () => {
  it("survives a client aborting a POST /context upload mid-body", async () => {
    const { createHttpServer } = await loadServer();
    server = createHttpServer(0);
    const port = await listen(server);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    await new Promise<void>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "POST /context HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n",
        );
        socket.write('{"content":');
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 50);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    const health = await send(port, "GET", "/health");
    expect(health.status).toBe(200);
  });

  it("reports the package version in serverInfo", async () => {
    // tsup defines this as the package version; dist is checked in package-e2e.
    vi.stubEnv("SVELTE_LENS_MCP_VERSION", "9.8.7");
    const { createHttpServer } = await loadServer();
    server = createHttpServer(0);
    const port = await listen(server);

    const res = await initialize(port);
    expect(res.status).toBe(200);
    // Streamable HTTP may answer as SSE: take the JSON from the data line.
    const json = res.body.match(/^data: (.*)$/m)?.[1] ?? res.body;
    const { result } = JSON.parse(json) as { result: { serverInfo: unknown } };
    expect(result.serverInfo).toEqual({ name: "svelte-lens-mcp", version: "9.8.7" });
  });

  it("evicts idle sessions so abandoned clients cannot exhaust MAX_SESSIONS", async () => {
    const { createHttpServer, sweepIdleSessions } = await loadServer();
    server = createHttpServer(0);
    const port = await listen(server);

    for (let i = 0; i < MAX_SESSIONS; i++) {
      expect((await initialize(port)).status).toBe(200);
    }
    expect((await initialize(port)).status).toBe(503);

    // Still within the TTL: nothing is evicted.
    sweepIdleSessions(Date.now() + SESSION_IDLE_TTL_MS / 2);
    expect((await initialize(port)).status).toBe(503);

    sweepIdleSessions(Date.now() + SESSION_IDLE_TTL_MS + 1);
    expect((await initialize(port)).status).toBe(200);
  });

  it("returns 404 for an unknown session id so clients re-initialize", async () => {
    const { createHttpServer } = await loadServer();
    server = createHttpServer(0);
    const port = await listen(server);

    const res = await send(port, "POST", "/mcp", "{}", {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": "does-not-exist",
    });
    expect(res.status).toBe(404);
  });

  it("accepts POST /context from loopback origins, including IPv6, and rejects others", async () => {
    const { createHttpServer } = await loadServer();
    server = createHttpServer(0);
    const port = await listen(server);
    const post = (origin: string) =>
      send(port, "POST", "/context", JSON.stringify({ content: ["x"] }), {
        "Content-Type": "application/json",
        Origin: origin,
      });

    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
      "http://[::ffff:127.0.0.1]:5173",
    ]) {
      expect((await post(origin)).status, origin).toBe(200);
    }
    for (const origin of [
      "http://example.com",
      "http://[::2]:5173",
      "http://[::ffff:10.0.0.1]:5173",
    ]) {
      expect((await post(origin)).status, origin).toBe(403);
    }
  });
});

describe("startMcpServer --stdio", () => {
  it("shuts down when the agent closes stdin and never writes to stdout", async () => {
    const { startMcpServer } = await loadServer();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const stdoutWrite = vi.spyOn(process.stdout, "write");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = {
      end: process.stdin.listenerCount("end"),
      sigterm: process.listenerCount("SIGTERM"),
    };

    // Port 0 lets the OS pick a free port; the health probe on :0 fails fast.
    await startMcpServer({ port: 0, stdio: true });
    expect(process.stdin.listenerCount("end")).toBe(before.end + 1);
    await vi.waitFor(() => expect(process.listenerCount("SIGTERM")).toBe(before.sigterm + 1));

    process.stdin.emit("end");
    expect(exit).toHaveBeenCalledWith(0);
    expect(stdoutWrite).not.toHaveBeenCalled();

    // Clean up handlers registered on the shared worker process.
    process.stdin.removeAllListeners("close");
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      const listeners = process.listeners(signal);
      process.off(signal, listeners[listeners.length - 1]!);
    }
  });

  it("tells the agent when the context server cannot listen", async () => {
    // Occupy a port with something that is not svelte-lens.
    server = (await import("node:http")).createServer((_req, res) => res.writeHead(500).end());
    const busyPort = await listen(server);
    const { startMcpServer } = await loadServer();
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdinListeners = {
      end: process.stdin.listeners("end"),
      close: process.stdin.listeners("close"),
    };

    await startMcpServer({ port: busyPort, stdio: true });
    // Call the tool at once: the answer must still reflect the failed start.

    const transport = stdioTransports[stdioTransports.length - 1]!;
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    });
    transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_element_context", arguments: {} },
    });
    await vi.waitFor(() => expect(transport.sent.some((m) => m.id === 2)).toBe(true));

    const reply = transport.sent.find((m) => m.id === 2)!.result as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(reply.isError).toBe(true);
    expect(reply.content[0]!.text).toContain(`127.0.0.1:${busyPort}`);
    expect(reply.content[0]!.text).toContain("EADDRINUSE");
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/could not start/));

    // Remove only the shutdown handlers this server added to the shared stdin.
    for (const event of ["end", "close"] as const) {
      for (const listener of process.stdin.listeners(event)) {
        if (!stdinListeners[event].includes(listener)) {
          process.stdin.off(event, listener as (...args: unknown[]) => void);
        }
      }
    }
  });
});
