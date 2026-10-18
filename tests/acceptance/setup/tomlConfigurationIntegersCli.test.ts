import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const layout of ["table", "inline"] as const)
  cliTest(
    `Codex ${layout} doctor and refresh retain exact positive Int64 timeouts`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-codex-int64-timeout-");
      const directory = join(home, ".codex");
      const config = join(directory, "config.toml");
      const history = `[history]
max_bytes = 9_223_372_036_854_775_807 # Preserve history units.
`;
      const original = `# Preserve unrelated client settings.
${
  layout === "inline"
    ? `mcp_servers = { rea = { command = "npx", args = ["-y", "rea-agents@6.5.0", "mcp"], startup_timeout_sec = 9007199254740993, tool_timeout_sec = 9007199254740995 }, other = { command = "other-local-control" } }
${history}`
    : `${history}
[mcp_servers.rea]
command = "npx"
args = ["-y", "rea-agents@6.5.0", "mcp"]
startup_timeout_sec = 9007199254740993
tool_timeout_sec = 9007199254740995
[mcp_servers.other]
command = "other-local-control"
`
}
`;
      await mkdir(directory, { recursive: true });
      await writeFile(config, original);
      const environment = {
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: directory,
        XDG_CONFIG_HOME: join(home, ".config"),
        TMPDIR: home,
      };
      const run = (arguments_: readonly string[]) =>
        cli.run({ arguments: arguments_, cwd: home, environment });
      const doctorArguments = ["doctor", "--client", "codex", "--json"];
      const before = await run(doctorArguments);
      expect(before.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({ client: "codex", state: "aligned" }),
          ]),
        },
      });
      const setup = ["setup", "--client", "codex", "--skill=false", "--json"];
      const planned = await run([...setup, "--dry-run"]);
      expect(planned.exitCode, planned.stdout).toBe(0);
      expect(await readFile(config, "utf8")).toBe(original);
      const applied = await run([...setup, "--yes"]);
      expect(applied.exitCode, applied.stdout).toBe(0);
      const configured = await readFile(config, "utf8");
      expect(
        parseToml(configured, { integersAsBigInt: "asNeeded" }),
      ).toMatchObject({
        history: { max_bytes: 9_223_372_036_854_775_807n },
        mcp_servers: {
          other: { command: "other-local-control" },
          rea: {
            startup_timeout_sec: 9_007_199_254_740_993n,
            tool_timeout_sec: 9_007_199_254_740_995n,
          },
        },
      });
      expect(configured).toContain("# Preserve unrelated client settings.");
      expect(configured).toContain(history);
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
      const after = await run(doctorArguments);
      expect(after.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "codex",
              state: "aligned",
              remediation: null,
            }),
          ]),
        },
      });
      const repeated = await run([...setup, "--yes"]);
      expect(repeated.exitCode, repeated.stdout).toBe(0);
      expect(repeated.json).toMatchObject({ appliedActions: [] });
      expect(await readFile(config, "utf8")).toBe(configured);
    },
  );

for (const scenario of [
  { client: "codex", directory: ".codex" },
  { client: "grok_build", directory: ".grok" },
] as const)
  cliTest(
    `${scenario.client} setup and uninstall preserve valid Int64 configuration`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-toml-int64-cli-");
      const directory = join(home, scenario.directory);
      const config = join(directory, "config.toml");
      const original = `# Keep the configured history limit exactly.
[history]
max_bytes = 9_223_372_036_854_775_807 # bytes
[mcp_servers.other]
command = "other-local-control"
`;
      await mkdir(directory, { recursive: true });
      await writeFile(config, original);
      const environment = {
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: join(home, ".codex"),
        GROK_HOME: join(home, ".grok"),
        XDG_CONFIG_HOME: join(home, ".config"),
        TMPDIR: home,
      };
      const run = (arguments_: readonly string[]) =>
        cli.run({ arguments: arguments_, cwd: home, environment });
      const setup = [
        "setup",
        "--client",
        scenario.client,
        "--skill=false",
        "--json",
      ];
      const planned = await run([...setup, "--dry-run"]);
      expect(planned.exitCode, planned.stdout).toBe(0);
      expect(planned.json).toMatchObject({
        status: "planned",
        appliedActions: [],
      });
      expect(await readFile(config, "utf8")).toBe(original);

      const applied = await run([...setup, "--yes"]);
      expect(applied.exitCode, applied.stdout).toBe(0);
      expect(applied.json).toMatchObject({
        status: "ready",
        clients: { [scenario.client]: { status: "configured" } },
      });
      const configured = await readFile(config, "utf8");
      expect(configured.startsWith(original)).toBe(true);
      expect(
        parseToml(configured, { integersAsBigInt: "asNeeded" }),
      ).toMatchObject({
        history: { max_bytes: 9_223_372_036_854_775_807n },
        mcp_servers: { other: { command: "other-local-control" }, rea: {} },
      });
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);

      const doctor = await run([
        "doctor",
        "--client",
        scenario.client,
        "--json",
      ]);
      expect(doctor.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: scenario.client,
              state: "aligned",
            }),
          ]),
        },
      });

      const repeated = await run([...setup, "--yes"]);
      expect(repeated.exitCode, repeated.stdout).toBe(0);
      expect(repeated.json).toMatchObject({
        status: "ready",
        appliedActions: [],
      });
      expect(await readFile(config, "utf8")).toBe(configured);

      const removed = await run(["uninstall", "--json"]);
      expect(removed.exitCode, removed.stdout).toBe(0);
      expect(removed.json).toMatchObject({ status: "complete" });
      const remaining = await readFile(config, "utf8");
      expect(remaining.startsWith(original.trimEnd())).toBe(true);
      expect(parseToml(remaining, { integersAsBigInt: "asNeeded" })).toEqual(
        parseToml(original, { integersAsBigInt: "asNeeded" }),
      );
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    },
  );

for (const client of ["codex", "grok_build"])
  for (const [label, value] of [
    ["out-of-range", "9223372036854775808"],
    ["malformed", "1__000"],
  ])
    cliTest(
      `${client} refuses ${label} TOML before configuration writes`,
      async ({ cli }) => {
        const home = await createTestTempDirectory("rea-toml-invalid-integer-");
        const directory = join(home, client === "codex" ? ".codex" : ".grok");
        const config = join(directory, "config.toml");
        const original = `[history]\nmax_bytes = ${value}\n`;
        await mkdir(directory, { recursive: true });
        await writeFile(config, original);
        const environment = {
          HOME: home,
          USERPROFILE: home,
          CODEX_HOME: join(home, ".codex"),
          GROK_HOME: join(home, ".grok"),
          XDG_CONFIG_HOME: join(home, ".config"),
          TMPDIR: home,
        };
        for (const option of ["--dry-run", "--yes"]) {
          const result = await cli.run({
            arguments: [
              "setup",
              "--client",
              client,
              "--skill=false",
              "--json",
              option,
            ],
            cwd: home,
            environment,
          });
          expect(result.exitCode, result.stdout).toBe(1);
          expect(result.json).toMatchObject({
            status: "needs_human",
            plannedActions: [],
            appliedActions: [],
            remediation: expect.stringContaining("malformed"),
          });
          expect(await readFile(config, "utf8")).toBe(original);
          await expect(access(`${config}.rea.backup`)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      },
    );
