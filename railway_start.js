const { spawn } = require("child_process");
const path = require("path");

// 批注 2026-08-10：Railway 默认只执行一个 start command；公开版在同一容器托管 Gateway。
// 这里统一转发退出信号，避免后台子进程悄悄死掉。
const processes = [
  ["gateway", "server.js"]
].map(([name, file]) => ({
  name,
  child: spawn(process.execPath, [path.join(__dirname, file)], {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit"
  })
}));

let stopping = false;

function stopAll(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of processes) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 800).unref();
}

for (const { name, child } of processes) {
  child.on("error", error => {
    console.error(`${name} 启动失败:`, error.message || error);
    stopAll("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${name} 意外退出: code=${code ?? ""} signal=${signal || ""}`);
    stopAll("SIGTERM", code && code > 0 ? code : 1);
  });
}

process.on("SIGTERM", () => stopAll("SIGTERM", 0));
process.on("SIGINT", () => stopAll("SIGINT", 0));
