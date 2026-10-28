import assert from "node:assert/strict";
import {
  isScoring360ConfigManager,
  isScoring360CycleForDate,
  parseScoring360LaunchDays,
  scoring360CycleForLaunchDate,
} from "../server/scoring360-policy.mjs";

assert.deepEqual(parseScoring360LaunchDays("", 25), [25]);
assert.deepEqual(parseScoring360LaunchDays("25", 25), [25]);
assert.deepEqual(parseScoring360LaunchDays("25, bad, 32, 25", 25), [25]);
assert.deepEqual(parseScoring360LaunchDays("1,15", 1), [25]);
assert.deepEqual(parseScoring360LaunchDays("26", 25), [26]);

const monthlyCycle = scoring360CycleForLaunchDate(new Date("2026-08-25T10:00:00+08:00"));
assert.equal(monthlyCycle.id, "2026-08-360");
assert.equal(monthlyCycle.label, "2026年8月协同360评分");
assert.equal(monthlyCycle.startDate, "2026-08-01");
assert.equal(monthlyCycle.endDate, "2026-08-31");
assert.equal(monthlyCycle.round, 1);
assert.equal(isScoring360CycleForDate(monthlyCycle, new Date("2026-08-31T23:59:00+08:00")), true);
assert.equal(isScoring360CycleForDate(monthlyCycle, new Date("2026-09-01T00:01:00+08:00")), false);
assert.equal(isScoring360CycleForDate({ id: "2026-07-round2-360" }, new Date("2026-08-24T20:00:00+08:00")), false);

assert.equal(isScoring360ConfigManager({ userId: "mock_manager", name: "Demo Manager" }), false);
assert.equal(isScoring360ConfigManager({ userId: "mock_manager", name: "Demo Manager" }, [{userId:"mock_manager"}]), true, "only explicit configuration grants access");
assert.equal(isScoring360ConfigManager({ userId: "", name: "Demo Manager" }), false);
assert.equal(isScoring360ConfigManager({ userId: "", name: "Demo" }), false);
assert.equal(isScoring360ConfigManager({ userId: "", name: "Manager" }), false);
assert.equal(isScoring360ConfigManager({ userId: "", name: "普通同事" }), false);

console.log("scoring360 policy checks passed");
