import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePlay } from "../src/plays.ts";

const now = Date.UTC(2026, 10, 18, 12);
const base = { id: "CfE5wDUKWhc", title: "Solid Jackson", artist: "Brad Mehldau", duration: 491, end: "finished", device: "pc" };

describe("parsePlay", () => {
  it("keeps a normal line", () => {
    const p = parsePlay({ ...base, startedAt: now - 500_000, endedAt: now, heard: 480.4 }, now);
    assert.equal(p?.heard, 480);
    assert.equal(p?.source, "youtube");
  });

  it("can't claim more seconds heard than the track was on", () => {
    const p = parsePlay({ ...base, startedAt: now - 60_000, endedAt: now, heard: 9000 }, now);
    assert.equal(p?.heard, 65);
  });

  it("drops lines from a drifting clock or without an id", () => {
    assert.equal(parsePlay({ ...base, startedAt: now, endedAt: now + 3_600_000, heard: 10 }, now), null);
    assert.equal(parsePlay({ ...base, startedAt: now - 30 * 86_400_000, endedAt: now - 30 * 86_400_000 + 1000, heard: 1 }, now), null);
    assert.equal(parsePlay({ ...base, id: "", startedAt: now - 1000, endedAt: now, heard: 1 }, now), null);
  });
});
