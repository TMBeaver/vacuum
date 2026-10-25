"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { isDue, nextRun } = require("../electron/schedule.cjs");

const date = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);

test("runs at the local scheduled minute and suppresses a second same-day round", () => {
  assert.equal(
    isDue({ enabled: true, hour: "10:00", now: date(25, 9, 59) }),
    false,
  );
  assert.equal(
    isDue({ enabled: true, hour: "10:00", now: date(25, 10) }),
    true,
  );
  assert.equal(
    isDue({
      enabled: true,
      hour: "10:00",
      lastRun: date(25, 8).toISOString(),
      now: date(25, 14),
    }),
    false,
  );
});

test("catches up after the scheduled time if the last round was yesterday or missing", () => {
  assert.equal(
    isDue({
      enabled: true,
      hour: "10:00",
      lastRun: date(24, 12),
      now: date(25, 15),
    }),
    true,
  );
  const now = date(25, 15);
  assert.equal(
    nextRun({ enabled: true, hour: "10:00", now }).getTime(),
    now.getTime(),
  );
});

test("midnight starts a new local calendar day", () => {
  const lastRun = date(24, 23, 59);
  assert.equal(
    isDue({ enabled: true, hour: "00:00", lastRun, now: date(25, 0) }),
    true,
  );
  const next = nextRun({
    enabled: true,
    hour: "00:00",
    lastRun: date(25, 0),
    now: date(25, 12),
  });
  assert.equal(next.getDate(), 26);
  assert.equal(next.getHours(), 0);
});

test("future schedule is today before its time and tomorrow after a completed round", () => {
  assert.equal(
    nextRun({ enabled: true, hour: "18:30", now: date(25, 10) }).getTime(),
    date(25, 18, 30).getTime(),
  );
  assert.equal(
    nextRun({
      enabled: true,
      hour: "10:00",
      lastRun: date(25, 11),
      now: date(25, 12),
    }).getTime(),
    date(26, 10).getTime(),
  );
  assert.equal(
    isDue({
      enabled: true,
      hour: "10:00",
      lastRun: date(26, 11),
      now: date(25, 12),
    }),
    false,
  );
});

test("disabled or invalid settings never trigger a round", () => {
  for (const hour of ["24:00", "10:60", "9:00", "", null, undefined]) {
    assert.equal(isDue({ enabled: true, hour, now: date(25, 14) }), false);
    assert.equal(nextRun({ enabled: true, hour, now: date(25, 14) }), null);
  }
  assert.equal(
    isDue({ enabled: false, hour: "10:00", now: date(25, 14) }),
    false,
  );
  assert.equal(nextRun({ enabled: false, hour: "10:00" }), null);
  assert.equal(
    isDue({ enabled: "true", hour: "10:00", now: date(25, 14) }),
    false,
  );
  assert.equal(
    isDue({ enabled: true, hour: "10:00", now: new Date("invalid") }),
    false,
  );
  assert.equal(
    isDue({
      enabled: true,
      hour: "10:00",
      lastRun: "invalid",
      now: date(25, 14),
    }),
    true,
  );
});

test("local calendar scheduling survives Vilnius spring and autumn DST changes", () => {
  const modulePath = path.resolve(__dirname, "../electron/schedule.cjs");
  const script = `
    const assert=require('node:assert/strict');
    const {isDue,nextRun}=require(${JSON.stringify(modulePath)});
    const spring=new Date(2026,2,28,10);
    const springNext=nextRun({enabled:true,hour:'10:00',lastRun:spring,now:spring});
    assert.equal(springNext.getDate(),29);assert.equal(springNext.getHours(),10);
    assert.equal((springNext-spring)/3600000,23);
    const autumn=new Date(2026,9,24,10);
    const autumnNext=nextRun({enabled:true,hour:'10:00',lastRun:autumn,now:autumn});
    assert.equal(autumnNext.getDate(),25);assert.equal(autumnNext.getHours(),10);
    assert.equal((autumnNext-autumn)/3600000,25);
    assert.equal(isDue({enabled:true,hour:'03:00',lastRun:new Date('2026-10-25T00:10:00Z'),now:new Date('2026-10-25T01:15:00Z')}),false);
  `;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: "Europe/Vilnius" },
    windowsHide: true,
  });
});
