import { spawn } from "node:child_process";

const processes = [];

function run(name, args, color) {
  const child = spawn("npm", args, {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: process.env,
  });

  const prefix = `${color}[${name}]\x1b[0m`;
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`${prefix} ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`${prefix} ${chunk}`);
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${prefix} exited with code ${code}`);
      shutdown(code);
    }
  });

  processes.push(child);
}

function shutdown(exitCode = 0) {
  while (processes.length > 0) {
    const child = processes.pop();
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("api", ["run", "dev:api"], "\x1b[36m");
run("web", ["run", "dev:web"], "\x1b[33m");