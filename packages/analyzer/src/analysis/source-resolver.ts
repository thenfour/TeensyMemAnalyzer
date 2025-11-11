import path from 'path';
import { Analysis, SourceLocation, Symbol } from '../model';
import { resolveToolchain } from '../toolchain/resolver';
import { runCommand } from '../utils/exec';

export interface ResolveSymbolSourceParams {
  analysis: Analysis;
  symbol: Symbol;
  toolchainDir?: string;
  toolchainPrefix?: string;
}

const isUnknownLocation = (location: string): boolean => {
  const trimmed = location.trim();
  return trimmed === '??:0' || trimmed === '??:?';
};

const parseAddr2lineLocation = (output: string): SourceLocation | undefined => {
  const lines = output.trim().split(/\r?\n/);
  if (lines.length === 0) {
    return undefined;
  }

  const locationLine = lines[lines.length - 1];
  if (!locationLine || isUnknownLocation(locationLine)) {
    return undefined;
  }

  const lastColonIndex = locationLine.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return undefined;
  }

  const filePart = locationLine.slice(0, lastColonIndex).trim();
  const linePart = locationLine.slice(lastColonIndex + 1).trim();
  const lineNumber = Number.parseInt(linePart, 10);

  if (!filePart || Number.isNaN(lineNumber) || lineNumber < 0) {
    return undefined;
  }

  return {
    file: path.normalize(filePart),
    line: lineNumber,
  };
};

export const resolveSymbolSource = async (
  params: ResolveSymbolSourceParams,
): Promise<SourceLocation | undefined> => {
  const { analysis, symbol, toolchainDir, toolchainPrefix } = params;

  if (!analysis.build?.elfPath) {
    throw new Error('Analysis build information is missing an ELF path.');
  }

  if (symbol.addr === undefined) {
    return undefined;
  }

  const toolchain = await resolveToolchain({
    elfPath: analysis.build.elfPath,
    targetId: params.analysis.config.targetId ?? 'unknown',
    toolchainDir,
    toolchainPrefix,
  });

  const resolvedAddr = symbol.kind === 'func' ? symbol.addr & ~1 : symbol.addr;

  const addressHex = `0x${resolvedAddr.toString(16)}`;
  const result = await runCommand(toolchain.addr2line, [
    '-e',
    analysis.build.elfPath,
    '-C',
    '-f',
    addressHex,
  ]);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return parseAddr2lineLocation(result.stdout);
};
