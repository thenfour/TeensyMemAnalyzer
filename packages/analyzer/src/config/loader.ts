import { readFile } from 'fs/promises';
import path from 'path';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import { MemoryMapConfig } from '../model';

export interface LoadMemoryMapOptions {
  /**
   * Directory containing target memory-map JSON files. Defaults to the repo-level `config/` folder.
   */
  baseDir?: string;
  /**
   * Explicit path to the JSON schema file. Defaults to `<baseDir>/schema/memory-map.schema.json`.
   */
  schemaPath?: string;
}

const DEFAULT_CONFIG_DIR = path.resolve(__dirname, '../../../config');

const validatorCache = new Map<string, ValidateFunction>();

const getDefaultSchemaPath = (configDir: string): string =>
  path.join(configDir, 'schema', 'memory-map.schema.json');

const formatValidationErrors = (errors: ErrorObject[] | null | undefined): string =>
  (errors ?? [])
    .map((err) => {
      const location = err.instancePath.length > 0 ? err.instancePath : '(root)';
      return `${location} ${err.message ?? ''}`.trim();
    })
    .join('\n');

const getValidator = async (schemaPath: string): Promise<ValidateFunction> => {
  const cached = validatorCache.get(schemaPath);
  if (cached) {
    return cached;
  }

  const schemaRaw = await readFile(schemaPath, 'utf8');
  const schemaJson = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validator = ajv.compile(schemaJson);
  validatorCache.set(schemaPath, validator);
  return validator;
};

const parseJsonFile = async (filePath: string): Promise<unknown> => {
  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${(error as Error).message}`);
  }
};

export const loadMemoryMapFromFile = async (
  filePath: string,
  options: LoadMemoryMapOptions = {},
): Promise<MemoryMapConfig> => {
  const configDir = options.baseDir ?? DEFAULT_CONFIG_DIR;
  const schemaPath = options.schemaPath ?? getDefaultSchemaPath(configDir);

  const validator = await getValidator(schemaPath);
  const data = await parseJsonFile(filePath);

  if (!validator(data)) {
    const details = formatValidationErrors(validator.errors);
    throw new Error(`Memory map config at ${filePath} failed validation:\n${details}`.trim());
  }

  return data as MemoryMapConfig;
};

export const loadMemoryMap = async (
  targetId: string,
  options: LoadMemoryMapOptions = {},
): Promise<MemoryMapConfig> => {
  const configDir = options.baseDir ?? DEFAULT_CONFIG_DIR;
  const configPath = path.join(configDir, `${targetId}.json`);
  return loadMemoryMapFromFile(configPath, {
    ...options,
    baseDir: configDir,
  });
};

export const getMemoryMapConfigPath = (
  targetId: string,
  options: LoadMemoryMapOptions = {},
): string => {
  const configDir = options.baseDir ?? DEFAULT_CONFIG_DIR;
  return path.join(configDir, `${targetId}.json`);
};
