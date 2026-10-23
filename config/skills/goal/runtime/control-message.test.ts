import { describe, expect, test } from "bun:test";

import {
  ControlValidationError,
  type ControlValidation,
  buildControlPrompt,
  createAckEnvelope,
  parseControlReply,
  validateControlEnvelope,
} from "./control-message";

const BINDING = {
  goal_id: "goal-1",
  plan_id: "plan-1",
  revision: "r1",
  attempt: 1,
} as const;

const ENVELOPE = createAckEnvelope(BINDING, "ack-1");

function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...ENVELOPE, ...overrides };
}

function expectError(result: ControlValidation<unknown>, code: string): void {
  if (result.ok) throw new Error(`expected error ${code}, got success`);
  expect(result.error.code).toBe(code);
}

describe("control-message envelope", () => {
  test("accepts whitespace around the one JSON object", () => {
    const parsed = parseControlReply(`\n\t ${JSON.stringify(ENVELOPE)} \n`, ENVELOPE);
    expect(parsed.ok).toBe(true);
  });

  test("rejects extra fields", () => {
    expectError(validateControlEnvelope(wire({ extra: true })), "unexpected_field");
  });

  test("rejects missing fields", () => {
    const missing = wire();
    delete missing.goal_id;
    expectError(validateControlEnvelope(missing), "missing_field");
  });

  test("rejects the wrong schema version", () => {
    expectError(validateControlEnvelope(wire({ schema_version: 2 })), "invalid_schema_version");
    expectError(validateControlEnvelope(wire({ schema_version: "1" })), "invalid_schema_version");
  });

  test("rejects unbounded or unsafe identifiers", () => {
    expectError(validateControlEnvelope(wire({ goal_id: "" })), "invalid_id");
    expectError(validateControlEnvelope(wire({ goal_id: "goal 1" })), "invalid_id");
    expectError(validateControlEnvelope(wire({ plan_id: "plan/1" })), "invalid_id");
    expectError(validateControlEnvelope(wire({ request_id: "x".repeat(129) })), "invalid_id");
    expectError(validateControlEnvelope(wire({ revision: "-r1" })), "invalid_id");
  });

  test("accepts underscore, colon, dot, and hyphen inside identifiers", () => {
    const result = validateControlEnvelope(
      wire({ goal_id: "goal_1", plan_id: "plan:1", revision: "r1.attempt_2", request_id: "req-3" }),
    );
    expect(result.ok).toBe(true);
  });

  test("requires a bounded integer attempt", () => {
    expectError(validateControlEnvelope(wire({ attempt: 0 })), "invalid_attempt");
    expectError(validateControlEnvelope(wire({ attempt: 1.5 })), "invalid_attempt");
    expectError(validateControlEnvelope(wire({ attempt: "1" })), "invalid_attempt");
    expectError(validateControlEnvelope(wire({ attempt: 1_000_001 })), "invalid_attempt");
  });

  test("rejects any kind other than ack", () => {
    expectError(validateControlEnvelope(wire({ kind: "dispatch" })), "unsupported_kind");
  });

  test("requires an empty ACK payload", () => {
    expectError(validateControlEnvelope(wire({ payload: { work: true } })), "invalid_payload");
    expectError(validateControlEnvelope(wire({ payload: [] })), "invalid_payload");
  });

  test("rejects prose, fences, arrays, and trailing text", () => {
    expectError(parseControlReply("sure: " + JSON.stringify(ENVELOPE), ENVELOPE), "reply_not_json");
    expectError(parseControlReply("```json\n" + JSON.stringify(ENVELOPE) + "\n```", ENVELOPE), "reply_not_json");
    expectError(parseControlReply("[1,2]", ENVELOPE), "not_plain_object");
    expectError(parseControlReply(JSON.stringify(ENVELOPE) + " done", ENVELOPE), "reply_not_json");
    expectError(parseControlReply("", ENVELOPE), "reply_empty");
  });

  test("rejects a mismatched binding", () => {
    expectError(
      parseControlReply(JSON.stringify(wire({ request_id: "ack-2" })), ENVELOPE),
      "reply_binding_mismatch",
    );
    expectError(
      parseControlReply(JSON.stringify(wire({ goal_id: "other-goal" })), ENVELOPE),
      "reply_binding_mismatch",
    );
    expectError(
      parseControlReply(JSON.stringify(wire({ attempt: 2 })), ENVELOPE),
      "reply_binding_mismatch",
    );
  });

  test("rejects replies and envelopes over their byte bounds", () => {
    expectError(parseControlReply(JSON.stringify(ENVELOPE), ENVELOPE, { maxReplyBytes: 10 }), "reply_too_large");
    expectError(validateControlEnvelope(ENVELOPE, { maxEnvelopeBytes: 10 }), "envelope_too_large");
    expect(() => buildControlPrompt(ENVELOPE, { maxPromptBytes: 10 })).toThrow(ControlValidationError);
  });

  test("createAckEnvelope fails closed on an invalid binding", () => {
    expect(() => createAckEnvelope({ ...BINDING, attempt: 0 }, "ack-1")).toThrow(ControlValidationError);
    expect(() => createAckEnvelope(BINDING, "bad request id")).toThrow(ControlValidationError);
  });
});
