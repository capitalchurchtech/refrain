import { test } from "node:test";
import assert from "node:assert/strict";
import { phonePanelHtml } from "../public/phone-panel.js";
import { livePreviewHtml } from "../public/live.js";

test("off: says what phones can do and offers Turn on; on: the steps, the QR, today's PIN", () => {
  const off = phonePanelHtml({ status: "off" });
  assert.match(off, /phone-enable/);
  assert.match(off, /can't change the screens unless you approve them/);
  const on = phonePanelHtml({ status: "active", urls: ["http://192.168.1.5:9997/"], qrSvg: "<svg></svg>", pinMode: "daily", pin: "4821", phones: [], activity: [] });
  assert.match(on, /same Wi-Fi as this Mac/);
  assert.match(on, /http:\/\/192\.168\.1\.5:9997\//);
  assert.match(on, /<svg><\/svg>/);
  assert.match(on, /today's PIN.*4821/s);
  assert.match(on, /No phones yet/);
});

test("phones: approve for control, take it back, remove; never Allow control without a PIN", () => {
  const phones = [
    { id: "a", name: "Sam <b>", approved: false, lastSeen: Date.now() },
    { id: "b", name: "Lee", approved: true, lastSeen: Date.now() },
  ];
  const html = phonePanelHtml({ status: "active", urls: ["http://x:9997/"], pinMode: "daily", pin: "1", phones, activity: [{ at: new Date().toISOString(), phone: "Lee", label: "Next slide", ok: true }] });
  assert.match(html, /Sam &lt;b&gt;/);
  assert.match(html, /data-action="approve"/);
  assert.match(html, /data-action="unapprove"/);
  assert.match(html, /Lee: Next slide/);
  const noPin = phonePanelHtml({ status: "active", urls: ["http://x:9997/"], pinMode: "none", phones: [phones[0]], activity: [] });
  assert.doesNotMatch(noPin, /data-action="approve"/);
  assert.match(noPin, /no phone can control ProPresenter/);
});

test("Live's preview: Now and Next pictures, the end of a presentation, and the last phone press", () => {
  const html = livePreviewHtml({ current: { slideNumber: 3, image: "/i/3", text: "now" }, next: null, atEnd: true, lastPhoneAction: { phone: "Lee", label: "Next slide", at: new Date().toISOString(), ok: true } });
  assert.match(html, /Now · slide 3/);
  assert.match(html, /End of this presentation/);
  assert.match(html, /Phone: Lee pressed Next slide/);
  assert.equal(livePreviewHtml({ current: null }), "");
});
