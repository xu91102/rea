import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const environmentFor = (home: string) => ({
  HOME: home,
  USERPROFILE: home,
  CLAUDE_CONFIG_DIR: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  TMPDIR: home,
});

const ownedServers = {
  mcpServers: {
    rea: { command: "npx", args: ["-y", "rea-agents@6.5.0", "mcp"] },
    other: { command: "other-local-control" },
  },
};

for (const [name, original] of [
  [
    "comments",
    `{ // Invalid in native Claude Code\n${JSON.stringify(ownedServers).slice(1)}`,
  ],
  ["trailing comma", `${JSON.stringify(ownedServers).slice(0, -1)},}`],
  ["empty file", ""],
  ["whitespace only", " \t\n"],
  ["BOM only", "\uFEFF"],
  ["comment only", "// Invalid empty native configuration\n"],
] as const)
  cliTest(
    `Claude Code rejects ${name} in setup, doctor and uninstall without mutation`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-claude-json-invalid-");
      const config = join(home, ".claude.json");
      const peer = join(home, ".codex", "config.toml");
      const otherClient =
        '[mcp_servers.rea]\ncommand = "npx"\nargs = ["-y", "rea-agents@6.5.0", "mcp"]\n';
      await mkdir(join(home, ".codex"));
      await writeFile(peer, otherClient);
      await writeFile(config, original);
      const run = (arguments_: readonly string[]) =>
        cli.run({
          arguments: arguments_,
          cwd: home,
          environment: environmentFor(home),
        });
      const setup = [
        "setup",
        "--client",
        "claude_code",
        "--skill=false",
        "--json",
      ];
      for (const mode of ["--dry-run", "--yes"]) {
        const result = await run([...setup, mode]);
        expect(result.exitCode, result.stdout).toBe(1);
        expect(result.json).toMatchObject({
          status: "needs_human",
          appliedActions: [],
        });
        expect(await readFile(config, "utf8")).toBe(original);
      }
      const doctor = await run(["doctor", "--client", "claude_code", "--json"]);
      expect(doctor.exitCode, doctor.stdout).toBe(1);
      expect(doctor.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "claude_code",
              state: "invalid",
            }),
          ]),
        },
      });
      const removed = await run(["uninstall", "--json"]);
      expect(removed.exitCode, removed.stdout).toBe(1);
      expect(removed.json).toMatchObject({
        status: "failed",
        items: expect.arrayContaining([
          expect.objectContaining({ name: "claude_code", status: "failed" }),
        ]),
      });
      expect(await readFile(config, "utf8")).toBe(original);
      expect(await readFile(peer, "utf8")).toBe(otherClient);
      for (const path of [config, peer])
        await expect(readFile(`${path}.rea.backup`)).rejects.toMatchObject({
          code: "ENOENT",
        });
    },
  );

for (const layout of ["plain", "BOM", "missing"] as const)
  cliTest(
    `Claude Code ${layout} JSON lifecycle retains peers, exact backups and repeat bytes`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-claude-json-valid-");
      const config = join(home, ".claude.json");
      const original = `${layout === "BOM" ? "\uFEFF" : ""}{"keep":"// a string", "mcpServers":{"other":{"command":"other-local-control"}}}\n`;
      if (layout !== "missing") await writeFile(config, original);
      const run = (arguments_: readonly string[]) =>
        cli.run({
          arguments: arguments_,
          cwd: home,
          environment: environmentFor(home),
        });
      const setup = [
        "setup",
        "--client",
        "claude_code",
        "--skill=false",
        "--yes",
        "--json",
      ];
      const applied = await run(setup);
      expect(applied.exitCode, applied.stdout).toBe(0);
      expect(applied.json).toMatchObject({ status: "ready" });
      const configured = await readFile(config, "utf8");
      const read = (text: string) => JSON.parse(text.replace(/^\uFEFF/u, ""));
      expect(read(configured).mcpServers.rea.command).toBeTypeOf("string");
      if (layout !== "missing") {
        expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
        expect(read(configured)).toMatchObject({
          keep: "// a string",
          mcpServers: { other: { command: "other-local-control" } },
        });
      }
      expect(configured.startsWith("\uFEFF")).toBe(layout === "BOM");
      const doctor = await run(["doctor", "--client", "claude_code", "--json"]);
      expect(doctor.exitCode, doctor.stdout).toBe(0);
      expect(doctor.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "claude_code",
              state: "aligned",
            }),
          ]),
        },
      });
      const repeated = await run(setup);
      expect(repeated.exitCode, repeated.stdout).toBe(0);
      expect(repeated.json).toMatchObject({
        plannedActions: [],
        appliedActions: [],
      });
      expect(await readFile(config, "utf8")).toBe(configured);
      const removed = await run(["uninstall", "--json"]);
      expect(removed.exitCode, removed.stdout).toBe(0);
      const final = await readFile(config, "utf8");
      expect(read(final).mcpServers?.rea).toBeUndefined();
      if (layout !== "missing")
        expect(read(final)).toMatchObject({
          keep: "// a string",
          mcpServers: { other: { command: "other-local-control" } },
        });
      const again = await run(["uninstall", "--json"]);
      expect(again.exitCode, again.stdout).toBe(0);
      expect(await readFile(config, "utf8")).toBe(final);
    },
  );

cliTest(
  "Cursor JSONC and malformed owned Claude fields remain independently removable",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-json-client-syntax-");
    const cursor = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"));
    const original =
      '{ // Cursor accepts JSONC\n"mcpServers": {"other":{"command":"other-local-control"}},}\n';
    await writeFile(cursor, original);
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: environmentFor(home),
      });
    const configured = await run([
      "setup",
      "--client",
      "cursor",
      "--skill=false",
      "--yes",
      "--json",
    ]);
    expect(configured.exitCode, configured.stdout).toBe(0);
    expect(await readFile(`${cursor}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(cursor, "utf8")).toContain("// Cursor accepts JSONC");
    const claude = join(home, ".claude.json");
    await writeFile(
      claude,
      JSON.stringify({
        mcpServers: {
          ...ownedServers.mcpServers,
          rea: {
            ...ownedServers.mcpServers.rea,
            tool_timeout_sec: "invalid field, valid JSON",
          },
        },
      }),
    );
    const removed = await run(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(0);
    expect(JSON.parse(await readFile(claude, "utf8")).mcpServers).toEqual({
      other: { command: "other-local-control" },
    });
    expect(await readFile(cursor, "utf8")).toContain("// Cursor accepts JSONC");
  },
);
