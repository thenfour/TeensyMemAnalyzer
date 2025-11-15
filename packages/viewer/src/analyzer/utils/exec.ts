import { spawn } from 'child_process';

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const bufferFromString = (value: string | undefined): Buffer | undefined =>
  value !== undefined ? Buffer.from(value, 'utf8') : undefined;

export const runCommand = (
  command: string,
  args: readonly string[] = [],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> =>
  new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let killed = false;
    let timeout: NodeJS.Timeout | undefined;

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        killed = true;
        child.kill();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (killed) {
        return;
      }

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? -1,
      });
    });

    const inputBuffer = bufferFromString(options.input);
    if (inputBuffer) {
      child.stdin.write(inputBuffer);
    }
    child.stdin.end();
  });
