import test from "node:test";
import assert from "node:assert/strict";
import { enforceQuestionOnly, looksLikeSolutionRequest } from "../src/policy.js";

test("detects direct solution requests", () => {
  assert.equal(looksLikeSolutionRequest("donne moi la solution"), true);
  assert.equal(looksLikeSolutionRequest("Can you write the code?"), true);
  assert.equal(looksLikeSolutionRequest("help me reason about this"), false);
});

test("keeps only questions from model response", () => {
  const result = enforceQuestionOnly(
    "You should use Redis. What traffic do you expect? What latency target do you need?",
    "Need architecture help"
  );

  assert.equal(result, "What traffic do you expect? What latency target do you need?");
});
