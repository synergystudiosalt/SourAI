import { SourError } from '../../contracts/errors';
import { workspacePath, workspaceRoot, type WorkspacePath } from '../../filesystem';
import { TOOL_PROTOCOL_VERSION, type StructuredToolCall } from './types';

export const MAX_TOOL_CALL_BYTES = 512 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_TOOL_NAME_LENGTH = 80;
const MAX_ARGUMENT_DEPTH = 12;
const encoder = new TextEncoder();

function invalid(reason: string, details?: Record<string, unknown>): never {
  throw new SourError({
    code: 'tool_call_invalid',
    message: 'The provider returned an invalid structured tool call.',
    causeCategory: 'validation',
    retryable: false,
    details: { reason, ...details },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function safeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid('expected_object');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) invalid('accessor_property', { key });
  }
  return value;
}

export function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys
): Record<string, unknown> {
  const record = safeRecord(value);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) invalid('accessor_property', { key });
    if (!allowed.has(key)) invalid('additional_property', { key });
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) invalid('missing_property', { key });
  }
  return record;
}

export function requiredString(
  value: unknown,
  field: string,
  maximumLength: number,
  allowEmpty = false
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    invalid('invalid_string', { field, maximumLength });
  }
  return value;
}

export function optionalString(
  value: unknown,
  field: string,
  maximumLength: number
): string | undefined {
  return value === undefined ? undefined : requiredString(value, field, maximumLength);
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid('invalid_boolean', { field });
  return value;
}

export function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid('invalid_integer', { field, minimum, maximum });
  }
  return value as number;
}

export function validPath(value: unknown, field = 'path', allowRoot = false): WorkspacePath {
  if (typeof value !== 'string') invalid('invalid_path', { field });
  try {
    return value === '' && allowRoot ? workspaceRoot() : workspacePath(value);
  } catch {
    invalid('invalid_path', { field });
  }
}

export function optionalPath(value: unknown, field = 'path'): WorkspacePath | undefined {
  return value === undefined ? undefined : validPath(value, field, true);
}

function countSafeValue(value: unknown, depth: number, active: WeakSet<object>): number {
  if (depth > MAX_ARGUMENT_DEPTH) invalid('maximum_depth_exceeded');
  if (value === null) return 4;
  if (typeof value === 'string') return encoder.encode(value).byteLength + 2;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('non_finite_number');
    return String(value).length;
  }
  if (Array.isArray(value)) {
    if (active.has(value)) invalid('cyclic_arguments');
    active.add(value);
    let size = 2;
    for (const entry of value) size += countSafeValue(entry, depth + 1, active) + 1;
    active.delete(value);
    return size;
  }
  if (!isRecord(value)) invalid('non_json_value');
  if (active.has(value)) invalid('cyclic_arguments');
  active.add(value);
  let size = 2;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) invalid('accessor_property', { key });
    size += encoder.encode(key).byteLength + countSafeValue(descriptor.value, depth + 1, active) + 4;
  }
  active.delete(value);
  return size;
}

export function validateStructuredToolCall(value: unknown): StructuredToolCall {
  const record = exactRecord(value, ['version', 'id', 'name', 'arguments']);
  if (record.version !== TOOL_PROTOCOL_VERSION) {
    invalid('unsupported_version', { supported: TOOL_PROTOCOL_VERSION });
  }
  const id = requiredString(record.id, 'id', MAX_ID_LENGTH);
  const name = requiredString(record.name, 'name', MAX_TOOL_NAME_LENGTH);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) invalid('invalid_tool_name');
  const rawArguments = safeRecord(record.arguments);
  const bytes =
    countSafeValue({ version: record.version, id, name, arguments: rawArguments }, 0, new WeakSet());
  if (bytes > MAX_TOOL_CALL_BYTES) invalid('tool_call_too_large', { maximumBytes: MAX_TOOL_CALL_BYTES });
  return Object.freeze({
    version: TOOL_PROTOCOL_VERSION,
    id,
    name,
    arguments: Object.freeze({ ...rawArguments }),
  });
}

export function toolValidationError(reason: string, details?: Record<string, unknown>): never {
  return invalid(reason, details);
}
