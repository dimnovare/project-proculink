import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_PROCESS_TIMEOUT_MS = 20 * 60 * 1000;
const WORKER_GRACE_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const workerPath = fileURLToPath(import.meta.url);

export function resolveProcessTimeoutMs(env = process.env) {
  const timeoutMs = Number(
    env.FILM_PROCESS_TIMEOUT_MS ?? DEFAULT_PROCESS_TIMEOUT_MS,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Invalid film process timeout: ${env.FILM_PROCESS_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

export function buildProcessOptions({ timeoutMs }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid film process timeout: ${timeoutMs}.`);
  }
  return {
    encoding: "utf8",
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  };
}

export function buildWindowsTreeKillCommand(processId) {
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error(`Invalid process id for tree termination: ${processId}.`);
  }
  return {
    command: "taskkill",
    args: ["/PID", String(processId), "/T", "/F"],
  };
}

export function terminateProcessTree(processId, options = {}) {
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error(`Invalid process id for tree termination: ${processId}.`);
  }
  const platform = options.platform ?? process.platform;
  const killImpl =
    options.killImpl ??
    ((pid, signal) => {
      process.kill(pid, signal);
    });

  if (platform !== "win32") {
    killImpl(processId, "SIGKILL");
    return;
  }

  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const treeKill = buildWindowsTreeKillCommand(processId);
  const result = spawnSyncImpl(treeKill.command, treeKill.args, {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    killImpl(processId, "SIGKILL");
  }
}

function appendOutput(current, chunk) {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error("Film process output exceeded 64 MiB.");
  }
  return next;
}

async function runWorker(encodedPayload) {
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64").toString("utf8"),
  );
  const child = spawn(payload.command, payload.args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child.pid, {
      killImpl: () => child.kill("SIGKILL"),
    });
  }, payload.timeoutMs);
  timeout.unref?.();

  const result = await new Promise((resolveResult) => {
    child.once("error", (error) => {
      resolveResult({
        error: error.message,
        status: 1,
        stderr,
        stdout,
        timedOut,
      });
    });
    child.once("close", (status, signal) => {
      resolveResult({
        signal,
        status: status ?? 1,
        stderr,
        stdout,
        timedOut,
      });
    });
  });
  clearTimeout(timeout);
  process.stdout.write(JSON.stringify(result));
}

export function runFilmProcess(command, args, options = {}) {
  const timeoutMs =
    options.timeoutMs ?? resolveProcessTimeoutMs(options.env ?? process.env);
  const payload = Buffer.from(
    JSON.stringify({ command, args, timeoutMs }),
    "utf8",
  ).toString("base64");
  const workerResult = spawnSync(
    process.execPath,
    [workerPath, "--film-process-worker", payload],
    buildProcessOptions({ timeoutMs: timeoutMs + WORKER_GRACE_MS }),
  );

  if (workerResult.error) {
    if (workerResult.error.code === "ETIMEDOUT") {
      throw new Error(
        `${command} process supervisor timed out after ` +
          `${timeoutMs + WORKER_GRACE_MS} ms.`,
      );
    }
    throw new Error(
      `${command} process supervisor failed: ${workerResult.error.message}`,
    );
  }
  if (workerResult.status !== 0) {
    throw new Error(
      `${command} process supervisor exited ${workerResult.status}: ` +
        `${(workerResult.stderr || "no diagnostic output").trim()}`,
    );
  }

  let result;
  try {
    result = JSON.parse(workerResult.stdout);
  } catch {
    throw new Error(
      `${command} process supervisor returned invalid output: ` +
        `${workerResult.stdout || workerResult.stderr}`,
    );
  }
  if (result.timedOut) {
    throw new Error(`${command} timed out after ${timeoutMs} ms.`);
  }
  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error}`);
  }
  if (result.signal) {
    throw new Error(`${command} was terminated by ${result.signal}.`);
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} exited ${result.status}: ` +
        `${(result.stderr || result.stdout || "no diagnostic output").trim()}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

if (process.argv[2] === "--film-process-worker") {
  runWorker(process.argv[3]).catch((error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
