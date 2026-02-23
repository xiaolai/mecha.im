import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerChannelCommand } from "../../src/commands/channel.js";

const mockOpenStore = vi.fn();
const mockChannelAdd = vi.fn();
const mockChannelRm = vi.fn();
const mockChannelLs = vi.fn();
const mockChannelLink = vi.fn();
const mockChannelUnlink = vi.fn();
const mockChannelLinks = vi.fn();
const mockCreateGatewayServer = vi.fn();
const mockStoreClose = vi.fn();

vi.mock("@mecha/channels", () => ({
  openStore: (...args: unknown[]) => mockOpenStore(...args),
  channelAdd: (...args: unknown[]) => mockChannelAdd(...args),
  channelRm: (...args: unknown[]) => mockChannelRm(...args),
  channelLs: (...args: unknown[]) => mockChannelLs(...args),
  channelLink: (...args: unknown[]) => mockChannelLink(...args),
  channelUnlink: (...args: unknown[]) => mockChannelUnlink(...args),
  channelLinks: (...args: unknown[]) => mockChannelLinks(...args),
  createGatewayServer: (...args: unknown[]) => mockCreateGatewayServer(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

function mockStore() {
  const store = { close: mockStoreClose };
  mockOpenStore.mockReturnValue(store);
  return store;
}

describe("mecha channel", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  // --- channel add ---

  it("channel add creates a channel with --bot-token and shows success", async () => {
    const store = mockStore();
    mockChannelAdd.mockReturnValue({ id: "ch-abc12345", type: "telegram", config: "{}", enabled: 1 });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "add", "telegram", "--bot-token", "tok123"], { from: "user" });

    expect(mockOpenStore).toHaveBeenCalled();
    expect(mockChannelAdd).toHaveBeenCalledWith(store, "telegram", "tok123");
    expect(formatter.success).toHaveBeenCalledWith("Channel added: ch-abc12345");
    expect(mockStoreClose).toHaveBeenCalled();
  });

  it("channel add reads token from MECHA_BOT_TOKEN env var", async () => {
    const store = mockStore();
    mockChannelAdd.mockReturnValue({ id: "ch-env", type: "telegram", config: "{}", enabled: 1 });
    const prev = process.env.MECHA_BOT_TOKEN;
    process.env.MECHA_BOT_TOKEN = "env-token";

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "add", "telegram"], { from: "user" });

    expect(mockChannelAdd).toHaveBeenCalledWith(store, "telegram", "env-token");
    if (prev === undefined) delete process.env.MECHA_BOT_TOKEN;
    else process.env.MECHA_BOT_TOKEN = prev;
  });

  it("channel add rejects invalid channel type", async () => {
    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "add", "discord", "--bot-token", "tok"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid channel type: discord"));
    expect(process.exitCode).toBe(1);
  });

  it("channel add requires bot token", async () => {
    const prev = process.env.MECHA_BOT_TOKEN;
    delete process.env.MECHA_BOT_TOKEN;

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "add", "telegram"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("Bot token required"));
    expect(process.exitCode).toBe(1);
    if (prev !== undefined) process.env.MECHA_BOT_TOKEN = prev;
  });

  it("channel add reports error on failure", async () => {
    mockOpenStore.mockImplementation(() => { throw new Error("db error"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "add", "telegram", "--bot-token", "tok"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("db error"));
    expect(process.exitCode).toBe(1);
  });

  // --- channel rm ---

  it("channel rm removes a channel and shows success", async () => {
    const store = mockStore();

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "rm", "ch-abc"], { from: "user" });

    expect(mockChannelRm).toHaveBeenCalledWith(store, "ch-abc");
    expect(formatter.success).toHaveBeenCalledWith("Channel ch-abc removed");
    expect(mockStoreClose).toHaveBeenCalled();
  });

  it("channel rm reports error on failure", async () => {
    mockStore();
    mockChannelRm.mockImplementation(() => { throw new Error("not found"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "rm", "ch-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  // --- channel ls ---

  it("channel ls lists channels as table", async () => {
    mockStore();
    mockChannelLs.mockReturnValue([
      { id: "ch-1", type: "telegram", enabled: 1, created_at: "2026-01-01" },
      { id: "ch-2", type: "telegram", enabled: 0, created_at: "2026-01-02" },
    ]);

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "ls"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledWith(
      [
        { ID: "ch-1", TYPE: "telegram", ENABLED: "yes", CREATED: "2026-01-01" },
        { ID: "ch-2", TYPE: "telegram", ENABLED: "no", CREATED: "2026-01-02" },
      ],
      ["ID", "TYPE", "ENABLED", "CREATED"],
    );
  });

  it("channel ls reports error on failure", async () => {
    mockOpenStore.mockImplementation(() => { throw new Error("db fail"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "ls"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("db fail"));
    expect(process.exitCode).toBe(1);
  });

  // --- channel link ---

  it("channel link creates a link and shows success", async () => {
    const store = mockStore();
    mockChannelLink.mockReturnValue({ id: "cl-xyz", channel_id: "ch-1", chat_id: "999", mecha_id: "mx-1" });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "link", "ch-1", "999", "mx-1"], { from: "user" });

    expect(mockChannelLink).toHaveBeenCalledWith(store, "ch-1", "999", "mx-1");
    expect(formatter.success).toHaveBeenCalledWith("Linked: cl-xyz (ch-1 / 999 → mx-1)");
  });

  it("channel link reports error on failure", async () => {
    mockStore();
    mockChannelLink.mockImplementation(() => { throw new Error("link fail"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "link", "ch-1", "999", "mx-1"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("link fail"));
    expect(process.exitCode).toBe(1);
  });

  // --- channel unlink ---

  it("channel unlink removes a link and shows success", async () => {
    const store = mockStore();

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "unlink", "ch-1", "999"], { from: "user" });

    expect(mockChannelUnlink).toHaveBeenCalledWith(store, "ch-1", "999");
    expect(formatter.success).toHaveBeenCalledWith("Unlinked: ch-1 / 999");
  });

  it("channel unlink reports error on failure", async () => {
    mockStore();
    mockChannelUnlink.mockImplementation(() => { throw new Error("unlink fail"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "unlink", "ch-1", "999"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("unlink fail"));
    expect(process.exitCode).toBe(1);
  });

  // --- channel links ---

  it("channel links lists all links as table", async () => {
    mockStore();
    mockChannelLinks.mockReturnValue([
      { id: "cl-1", channel_id: "ch-1", chat_id: "100", mecha_id: "mx-1", session_id: "sess-1" },
      { id: "cl-2", channel_id: "ch-1", chat_id: "200", mecha_id: "mx-2", session_id: null },
    ]);

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "links"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledWith(
      [
        { ID: "cl-1", CHANNEL: "ch-1", CHAT: "100", MECHA: "mx-1", SESSION: "sess-1" },
        { ID: "cl-2", CHANNEL: "ch-1", CHAT: "200", MECHA: "mx-2", SESSION: "-" },
      ],
      ["ID", "CHANNEL", "CHAT", "MECHA", "SESSION"],
    );
  });

  it("channel links filters by channelId argument", async () => {
    const store = mockStore();
    mockChannelLinks.mockReturnValue([]);

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "links", "ch-1"], { from: "user" });

    expect(mockChannelLinks).toHaveBeenCalledWith(store, "ch-1");
  });

  it("channel links passes undefined when no channelId", async () => {
    const store = mockStore();
    mockChannelLinks.mockReturnValue([]);

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "links"], { from: "user" });

    expect(mockChannelLinks).toHaveBeenCalledWith(store, undefined);
  });

  it("channel links reports error on failure", async () => {
    mockOpenStore.mockImplementation(() => { throw new Error("links fail"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "links"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("links fail"));
    expect(process.exitCode).toBe(1);
  });

  // --- channel serve ---

  it("channel serve starts gateway and shows info", async () => {
    const store = mockStore();
    const mockServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateGatewayServer.mockResolvedValue(mockServer);

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "serve"], { from: "user" });

    expect(store.close).toHaveBeenCalled();
    expect(mockCreateGatewayServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7650 }),
    );
    expect(mockServer.start).toHaveBeenCalled();
    expect(formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Channel gateway listening"),
    );
  });

  it("channel serve accepts custom port", async () => {
    mockStore();
    const mockServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateGatewayServer.mockResolvedValue(mockServer);

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "serve", "-p", "8080"], { from: "user" });

    expect(mockCreateGatewayServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8080 }),
    );
  });

  it("channel serve rejects invalid port", async () => {
    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "serve", "-p", "abc"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    expect(process.exitCode).toBe(1);
  });

  it("channel serve reports error on failure", async () => {
    mockOpenStore.mockImplementation(() => { throw new Error("serve fail"); });

    const program = new Command();
    registerChannelCommand(program, deps);
    await program.parseAsync(["channel", "serve"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("serve fail"));
    expect(process.exitCode).toBe(1);
  });
});
