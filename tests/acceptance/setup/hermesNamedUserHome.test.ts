import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "Hermes named-user setup, doctor and uninstall own the same account directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-hermes-named-home-");
    const home = join(root, "fake-home");
    const profile = join(root, "selected");
    const config = join(profile, "config.yaml");
    const skill = join(profile, "skills/reverse-engineer-anything/SKILL.md");
    await mkdir(home);
    await mkdir(profile);
    const original =
      "model: custom\nmcp_servers:\n  other:\n    command: other-server\n";
    await writeFile(config, original);
    const account = userInfo();
    const named = `~${account.username}/${relative(account.homedir, profile)}`;
    const run = (args: readonly string[], override = named) =>
      cli.run({
        arguments: args,
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, HERMES_HOME: override },
        timeoutMs: 20_000,
      });
    const setupArgs = ["setup", "--client", "hermes", "--yes", "--json"];
    const absolute = await run(setupArgs, profile);
    expect(absolute.exitCode, absolute.stdout + absolute.stderr).toBe(0);
    const configured = await readFile(config, "utf8");
    const doctor = await run([
      "doctor",
      "--client",
      "hermes",
      "--skill",
      "--json",
    ]);
    expect(doctor.exitCode, doctor.stdout + doctor.stderr).toBe(0);
    expect(doctor.json).toMatchObject({
      healthy: true,
      identity: {
        registrations: [{ client: "hermes", state: "aligned" }],
        skill: { state: "aligned" },
      },
    });
    const planned = await run([
      "setup",
      "--client",
      "hermes",
      "--dry-run",
      "--json",
    ]);
    expect(planned.exitCode, planned.stdout + planned.stderr).toBe(0);
    expect(planned.json).toMatchObject({
      status: "planned",
      plannedActions: [],
    });
    const repeated = await run(setupArgs);
    expect(repeated.exitCode, repeated.stdout + repeated.stderr).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(configured);
    expect(await readFile(skill, "utf8")).toContain(
      "reverse-engineer-anything",
    );
    await expect(
      access(join(home, `~${account.username}`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const uninstalled = await run(["uninstall", "--json"]);
    expect(uninstalled.exitCode, uninstalled.stdout + uninstalled.stderr).toBe(
      0,
    );
    expect(parse(await readFile(config, "utf8"))).toEqual(parse(original));
    await expect(access(skill)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

cliTest(
  "Hermes unresolved named-user setup refuses writes and leaves unrelated clients usable",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-hermes-unresolved-home-");
    const otherAccount = `${userInfo().username}-other-account`;
    const override = `~${otherAccount}/profile`;
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: args,
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, HERMES_HOME: override },
        timeoutMs: 20_000,
      });
    const rejected = await run([
      "setup",
      "--client",
      "hermes",
      "--yes",
      "--json",
    ]);
    expect(rejected.exitCode, rejected.stdout + rejected.stderr).not.toBe(0);
    expect(rejected.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      appliedActions: [],
      remediation: expect.stringContaining("absolute HERMES_HOME"),
    });
    await expect(access(join(home, `~${otherAccount}`))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const unrelated = await run([
      "setup",
      "--client",
      "codex",
      "--yes",
      "--json",
    ]);
    expect(unrelated.exitCode, unrelated.stdout + unrelated.stderr).toBe(0);
  },
);
