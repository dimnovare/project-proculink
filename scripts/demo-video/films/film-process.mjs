import { spawnSync } from "node:child_process";

const DEFAULT_PROCESS_TIMEOUT_MS = 20 * 60 * 1000;

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
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  };
}

export function runFilmProcess(command, args, options = {}) {
  const timeoutMs =
    options.timeoutMs ?? resolveProcessTimeoutMs(options.env ?? process.env);
  const result = spawnSync(
    command,
    args,
    buildProcessOptions({ timeoutMs }),
  );

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`${command} timed out after ${timeoutMs} ms.`);
    }
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`${command} was terminated by ${result.signal}.`);
  }

  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} exited ${status}: ` +
        `${(stderr || stdout || "no diagnostic output").trim()}`,
    );
  }
  return { status, stdout, stderr };
}
