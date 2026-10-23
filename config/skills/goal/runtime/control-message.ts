/**
 * H2H control envelopes: application-level JSON carried inside one ACP prompt.
 *
 * This module owns only the envelope contract. It imports neither the ACP SDK
 * nor the store, so the control wire stays independent of transport and
 * persistence. Only an explicit, complete JSON object is accepted as a reply;
 * token streams and prose are never parsed.
 */

export const CONTROL_SCHEMA_VERSION = 1 as const;
export const CONTROL_KIND_ACK = "ack" as const;

export const DEFAULT_CONTROL_ENVELOPE_MAX_BYTES = 12 * 1024;
export const DEFAULT_CONTROL_PROMPT_MAX_BYTES = 16 * 1024;
export const DEFAULT_CONTROL_REPLY_MAX_BYTES = 16 * 1024;

const MAX_ID_BYTES = 128;
const MAX_ATTEMPT = 1_000_000;
const ID_RE = /^[A-Za-z0-9][-A-Za-z0-9._:]*$/;

const ENVELOPE_KEYS = [
  "schema_version",
  "goal_id",
  "plan_id",
  "revision",
  "attempt",
  "request_id",
  "kind",
  "payload",
] as const;

export interface ControlBinding {
  readonly goal_id: string;
  readonly plan_id: string;
  readonly revision: string;
  readonly attempt: number;
}

/**
 * The only control envelope currently accepted. `payload` is required on the
 * wire but must be the empty object for an ACK; the ACK is a no-work prompt.
 */
export interface ControlAckEnvelope extends ControlBinding {
  readonly schema_version: typeof CONTROL_SCHEMA_VERSION;
  readonly request_id: string;
  readonly kind: typeof CONTROL_KIND_ACK;
  readonly payload: Readonly<Record<string, never>>;
}

export type ControlEnvelope = ControlAckEnvelope;

export type ControlErrorCode =
  | "not_plain_object"
  | "missing_field"
  | "unexpected_field"
  | "invalid_schema_version"
  | "invalid_id"
  | "invalid_attempt"
  | "unsupported_kind"
  | "invalid_payload"
  | "envelope_too_large"
  | "prompt_too_large"
  | "reply_empty"
  | "reply_too_large"
  | "reply_not_json"
  | "reply_binding_mismatch";

export class ControlValidationError extends Error {
  readonly code: ControlErrorCode;
  readonly detail: string;

  constructor(code: ControlErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ControlValidationError";
    this.code = code;
    this.detail = detail;
  }
}

export type ControlValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ControlValidationError };

export interface ControlValidationOptions {
  readonly maxEnvelopeBytes?: number;
}

export interface ControlPromptOptions extends ControlValidationOptions {
  readonly maxPromptBytes?: number;
}

export interface ControlReplyOptions {
  readonly maxReplyBytes?: number;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code: ControlErrorCode, detail: string): never {
  throw new ControlValidationError(code, detail);
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= MAX_ID_BYTES &&
    ID_RE.test(value)
  );
}

function serializeValidated(envelope: ControlEnvelope): string {
  return JSON.stringify({
    schema_version: envelope.schema_version,
    goal_id: envelope.goal_id,
    plan_id: envelope.plan_id,
    revision: envelope.revision,
    attempt: envelope.attempt,
    request_id: envelope.request_id,
    kind: envelope.kind,
    payload: envelope.payload,
  } satisfies ControlAckEnvelope);
}

/**
 * Validate a wire envelope strictly: exact field set, exact types, bounded
 * identifiers, integer attempt, ACK-only kind, empty payload, bounded size.
 */
export function validateControlEnvelope(
  value: unknown,
  options: ControlValidationOptions = {},
): ControlValidation<ControlEnvelope> {
  try {
    if (!isPlainObject(value)) fail("not_plain_object", "control envelope must be a plain object");

    const keys = Object.keys(value);
    for (const key of keys) {
      if (!(ENVELOPE_KEYS as readonly string[]).includes(key)) {
        fail("unexpected_field", `unexpected '${key}'`);
      }
    }
    for (const key of ENVELOPE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        fail("missing_field", `missing '${key}'`);
      }
    }

    if (value.schema_version !== CONTROL_SCHEMA_VERSION) {
      fail(
        "invalid_schema_version",
        `expected ${CONTROL_SCHEMA_VERSION}, got ${JSON.stringify(value.schema_version)}`,
      );
    }
    if (!validId(value.goal_id)) fail("invalid_id", "invalid 'goal_id'");
    if (!validId(value.plan_id)) fail("invalid_id", "invalid 'plan_id'");
    if (!validId(value.revision)) fail("invalid_id", "invalid 'revision'");
    if (
      typeof value.attempt !== "number" ||
      !Number.isSafeInteger(value.attempt) ||
      value.attempt < 1 ||
      value.attempt > MAX_ATTEMPT
    ) {
      fail("invalid_attempt", `'attempt' must be an integer in 1..${MAX_ATTEMPT}`);
    }
    if (!validId(value.request_id)) fail("invalid_id", "invalid 'request_id'");
    if (value.kind !== CONTROL_KIND_ACK) {
      fail("unsupported_kind", `unsupported control kind ${JSON.stringify(value.kind)}`);
    }
    if (!isPlainObject(value.payload) || Object.keys(value.payload).length !== 0) {
      fail("invalid_payload", "ACK payload must be the empty object");
    }

    const envelope: ControlEnvelope = Object.freeze({
      schema_version: CONTROL_SCHEMA_VERSION,
      goal_id: value.goal_id,
      plan_id: value.plan_id,
      revision: value.revision,
      attempt: value.attempt,
      request_id: value.request_id,
      kind: CONTROL_KIND_ACK,
      payload: Object.freeze({}) as Readonly<Record<string, never>>,
    });

    const maxEnvelopeBytes = options.maxEnvelopeBytes ?? DEFAULT_CONTROL_ENVELOPE_MAX_BYTES;
    if (byteLength(serializeValidated(envelope)) > maxEnvelopeBytes) {
      fail("envelope_too_large", `envelope exceeds ${maxEnvelopeBytes} bytes`);
    }
    return { ok: true, value: envelope };
  } catch (error) {
    if (error instanceof ControlValidationError) return { ok: false, error };
    throw error;
  }
}

/** Build a validated ACK envelope. Invalid bindings throw. */
export function createAckEnvelope(
  binding: ControlBinding,
  requestId: string,
  options: ControlValidationOptions = {},
): ControlAckEnvelope {
  const result = validateControlEnvelope(
    {
      schema_version: CONTROL_SCHEMA_VERSION,
      goal_id: binding.goal_id,
      plan_id: binding.plan_id,
      revision: binding.revision,
      attempt: binding.attempt,
      request_id: requestId,
      kind: CONTROL_KIND_ACK,
      payload: {},
    },
    options,
  );
  if (!result.ok) throw result.error;
  return result.value;
}

/** Serialize a validated envelope in stable field order (compact JSON). */
export function serializeControlEnvelope(
  envelope: ControlEnvelope,
  options: ControlValidationOptions = {},
): string {
  const result = validateControlEnvelope(envelope, options);
  if (!result.ok) throw result.error;
  return serializeValidated(result.value);
}

/**
 * Build the separate no-work ACK prompt. It never asks the agent to execute
 * approved work; the reply must be the exact envelope.
 */
export function buildControlPrompt(
  envelope: ControlEnvelope,
  options: ControlPromptOptions = {},
): string {
  const serialized = serializeControlEnvelope(envelope, options);
  const prompt =
    "Protocol-only test. Do not call tools, read or write files, launch agents, or perform any work. Return only this exact JSON object, with no markdown or explanation: " +
    serialized;
  const maxPromptBytes = options.maxPromptBytes ?? DEFAULT_CONTROL_PROMPT_MAX_BYTES;
  if (byteLength(prompt) > maxPromptBytes) {
    throw new ControlValidationError("prompt_too_large", `prompt exceeds ${maxPromptBytes} bytes`);
  }
  return prompt;
}

/**
 * Parse a reply as one explicit JSON object and require it to echo the exact
 * binding. Markdown fences, surrounding prose, and partial objects are errors,
 * never scraped.
 */
export function parseControlReply(
  reply: unknown,
  expected: ControlEnvelope,
  options: ControlReplyOptions = {},
): ControlValidation<ControlAckEnvelope> {
  try {
    if (typeof reply !== "string") fail("reply_empty", "control reply must be a string");
    const trimmed = reply.trim();
    if (trimmed.length === 0) fail("reply_empty", "control reply is empty");

    const maxReplyBytes = options.maxReplyBytes ?? DEFAULT_CONTROL_REPLY_MAX_BYTES;
    if (byteLength(trimmed) > maxReplyBytes) {
      fail("reply_too_large", `reply exceeds ${maxReplyBytes} bytes`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fail("reply_not_json", "control reply is not one JSON value");
    }

    const validated = validateControlEnvelope(parsed);
    if (!validated.ok) {
      const error = validated.error;
      throw new ControlValidationError(error.code, `reply ${error.detail}`);
    }

    const actual = validated.value;
    for (const key of ["schema_version", "goal_id", "plan_id", "revision", "attempt", "request_id", "kind"] as const) {
      if (actual[key] !== expected[key]) {
        fail("reply_binding_mismatch", `reply '${key}' does not match the request`);
      }
    }
    return { ok: true, value: actual };
  } catch (error) {
    if (error instanceof ControlValidationError) return { ok: false, error };
    throw error;
  }
}
