import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; onStdout?: (text: string) => void; onStderr?: (text: string) => void } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      options.onStdout?.(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      options.onStderr?.(chunk.toString("utf8"));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      const error = new Error(
        `${command} ${args.join(" ")} failed with exit code ${code}\n${result.stderr || result.stdout}`,
      );
      reject(error);
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}
