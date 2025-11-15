import path from 'path';
import { access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { AnalyzeBuildParams } from '../model';

export interface ToolchainCommands {
  nm: string;
  objdump: string;
  size: string;
  readelf: string;
  strings: string;
}

const DEFAULT_PREFIX = 'arm-none-eabi-';

const candidateCommands = ['nm', 'objdump', 'size', 'readelf', 'strings'] as const;

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveCommandPath = async (
  commandName: string,
  toolchainDir?: string,
): Promise<string | undefined> => {
  if (!toolchainDir) {
    return undefined;
  }

  const candidate = path.join(toolchainDir, commandName);
  if (await fileExists(candidate)) {
    return candidate;
  }

  // Windows executables often include .exe
  const windowsCandidate = `${candidate}.exe`;
  if (await fileExists(windowsCandidate)) {
    return windowsCandidate;
  }

  return undefined;
};

const formatCommandName = (prefix: string, executable: string): string => `${prefix}${executable}`;

export const resolveToolchain = async (
  params: AnalyzeBuildParams,
): Promise<ToolchainCommands> => {
  const {
    toolchainPrefix = DEFAULT_PREFIX,
    toolchainDir,
  } = params;

  const resolved: Partial<ToolchainCommands> = {};

  for (const executable of candidateCommands) {
    const commandName = formatCommandName(toolchainPrefix, executable);
    const resolvedPath = await resolveCommandPath(commandName, toolchainDir);

    if (resolvedPath) {
      resolved[executable] = resolvedPath;
      continue;
    }

    // Fall back to the command name itself (PATH resolution at runtime)
    resolved[executable] = commandName;
  }

  return resolved as ToolchainCommands;
};
