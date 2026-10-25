"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyScanResult } = require("../electron/defender.cjs");

test("only successful scan exit code zero can report clear", () => {
  assert.equal(classifyScanResult({ code: 0 }).status, "clear");
  for (const code of [1, 2, -1, 0x80070005])
    assert.equal(classifyScanResult({ code }).status, "attention");
});

test("exit two preserves ambiguity between threats and scan errors", () => {
  const result = classifyScanResult({ code: 2, output: "provider output" });
  assert.equal(result.status, "attention");
  assert.match(result.message, /detection or a scan error/);
  assert.equal(result.details, "provider output");
});

test("missing executable and execution failures cannot claim a clean result", () => {
  assert.equal(
    classifyScanResult({ code: null, output: "ENOENT" }).status,
    "unavailable",
  );
  assert.equal(classifyScanResult({}).status, "unavailable");
  assert.equal(classifyScanResult({ code: "0" }).status, "unavailable");
});

test("cancellation overrides zero exit and report text remains bounded", () => {
  const result = classifyScanResult({
    code: 0,
    aborted: true,
    output: "x".repeat(20_000),
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.details.length, 12_000);
});
