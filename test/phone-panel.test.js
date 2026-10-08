import { test } from "node:test";
import assert from "node:assert/strict";
import { phonePanelHtml } from "../public/phone-panel.js";

test("off: says what phones can do and offers Turn on; on: the steps, the QR, today's PIN", () => {
  const off = phonePanelHtml({ status: "off" });
  assert.match(off, /phone-enable/);
  assert.match(off, /A phone never moves slides/);
  const on = phonePanelHtml({ status: "active", urls: ["http://192.168.1.5:9997/"], qrSvg: "<svg></svg>", pinMode: "daily", pin: "4821", phones: [], activity: [] });
  assert.match(on, /same Wi-Fi as this Mac/);
  assert.match(on, /http:\/\/192\.168\.1\.5:9997\//);
  assert.match(on, /<svg><\/svg>/);
  assert.match(on, /today's PIN.*4821/s);
  assert.match(on, /No phones yet/);
});

test("phones: allow alerts, stop them, remove; never Allow alerts without a PIN", () => {
  const phones = [
    { id: "a", name: "Sam <b>", approved: false, lastSeen: Date.now() },
    { id: "b", name: "Lee", approved: true, lastSeen: Date.now() },
  ];
  const html = phonePanelHtml({ status: "active", urls: ["http://x:9997/"], pinMode: "daily", pin: "1", phones, activity: [{ at: new Date().toISOString(), phone: "Lee", label: "Stage: \"Killing it!\"", ok: true }] });
  assert.match(html, /Sam &lt;b&gt;/);
  assert.match(html, /data-action="approve"/);
  assert.match(html, /data-action="unapprove"/);
  assert.match(html, /Lee: Stage: &quot;Killing it!&quot;/);
  const noPin = phonePanelHtml({ status: "active", urls: ["http://x:9997/"], pinMode: "none", phones: [phones[0]], activity: [] });
  assert.doesNotMatch(noPin, /data-action="approve"/);
  assert.match(noPin, /no phone can send alerts/);
});
