import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

const folder =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Dobby")
    : process.platform === "win32"
      ? join(
          process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
          "Dobby",
        )
      : join(
          process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
          "Dobby",
        );
const file = join(folder, "mcp-connection.json");
try {
  const config = JSON.parse(await readFile(file, "utf8"));
  if (!isAbsolute(config.executable) || !isAbsolute(config.server))
    throw new Error("Invalid local config");
  const child = spawn(
    config.executable,
    [config.server, "--connection-file", file],
    { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  child.on("error", () => {
    process.stderr.write("Open Dobby again to refresh its local connection.\n");
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
} catch {
  process.stderr.write(
    "Open the Dobby desktop app before connecting its plugin.\n",
  );
  process.exit(1);
}
