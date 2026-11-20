import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { EventEmitter } from "node:events";

export async function findCodex() {
  const candidates = [
    join(homedir(), ".local/bin/codex"),
    join(homedir(), ".npm-global/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((p) =>
        join(p, process.platform === "win32" ? "codex.exe" : "codex"),
      ),
  ];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      /* Try the next installed CLI. */
    }
  }
  throw new Error(
    "ไม่พบ Codex CLI · ติดตั้ง Codex และใช้ codex login ด้วยบัญชี ChatGPT ก่อน",
  );
}
/** Only the installed Codex CLI owns authentication. Dobby never reads auth.json. */
export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  async start(executable: string, textOnly = false) {
    if (this.child) return;
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
    const args = ["app-server", "--stdio"];
    if (textOnly) {
      for (const feature of [
        "shell_tool",
        "unified_exec",
        "apps",
        "plugins",
        "multi_agent",
        "browser_use",
        "computer_use",
        "image_generation",
        "hooks",
        "view_image",
      ]) {
        args.push("--config", `features.${feature}=false`);
      }
      args.push(
        "--config",
        'web_search="disabled"',
        "--config",
        "project_doc_max_bytes=0",
      );
    }
    const child = spawn(executable, args, {
      env,
      stdio: "pipe",
      windowsHide: true,
    });
    this.child = child;
    child.stdin.on("error", () => {
      if (this.child === child) this.failed("ส่งคำสั่งให้ Codex ไม่สำเร็จ");
    });
    child.stderr.resume(); // Do not collect auth, transcript or debug logs.
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      if (line.length > 2_000_000) return;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof message.id === "number" && !message.method) {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id);
        clearTimeout(p.timer);
        if (message.error)
          p.reject(
            new Error(String(message.error.message ?? "Codex request failed")),
          );
        else p.resolve(message.result);
      } else if (message.method && message.id != null) {
        // Speech-only client has no tool execution or approval UI.
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            error: {
              code: -32601,
              message:
                "Dobby speech mode does not execute tools or approve actions",
            },
          }) + "\n",
        );
      } else if (typeof message.method === "string")
        this.emit("notification", message.method, message.params);
    });
    child.on("error", () => this.failed("เปิด Codex CLI ไม่สำเร็จ"));
    child.on("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.failed("การเชื่อมต่อ Codex สิ้นสุดแล้ว");
      }
    });
    await this.call("initialize", {
      clientInfo: {
        name: "dobby_voice",
        title: "Dobby voice",
        version: "0.8.2",
      },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }
  private failed(message: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
    this.emit("disconnected", message);
  }
  notify(method: string, params?: unknown) {
    this.child?.stdin.write(
      JSON.stringify({ method, ...(params ? { params } : {}) }) + "\n",
    );
  }
  call(method: string, params: unknown = {}, timeout = 30_000): Promise<any> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("Codex ยังไม่ได้เชื่อมต่อ"));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex ตอบกลับช้าเกินไป ลองเชื่อมใหม่"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  close() {
    const child = this.child;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    this.failed("หยุดการเชื่อมต่อเสียงแล้ว");
    child?.kill();
  }
}
