import { test } from "node:test";
import assert from "node:assert/strict";
import { phonePanelHtml } from "../public/phone-panel.js";

test("off: says what phones can do and offers Turn on; on: the steps, the QR, today's PIN", () => {
  const off = phonePanelHtml({ status: "off" });
  assert.match(off, /phone-enable/);
  assert.match(off, /can't put a slide on the screens unless you switch that on/);
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

test("the device code shows whenever phones are on, and going live is off by default with nothing about it shown", () => {
  const base = { status: "active", urls: ["http://x:9997/"], pinMode: "daily", pin: "1", phones: [], activity: [] };
  const off = phonePanelHtml({ ...base, goLive: { enabled: false, code: "4821", takeovers: [] } });
  assert.match(off, /id="phone-device-code">4821</, "the code is how a phone gets to search and send alerts, so it shows with go-live off");
  assert.match(off, /Search and Alerts/);
  assert.match(off, /id="phone-golive"/);
  assert.doesNotMatch(off, /checked/);
  assert.match(off, /none can go live/);
  const noPin = phonePanelHtml({ ...base, pinMode: "none", goLive: { enabled: false, code: "4821", takeovers: [] } });
  assert.doesNotMatch(noPin, /phone-device-code/, "without a PIN a phone has no identity to allow, so no code is offered");
  const noCode = phonePanelHtml({ ...base, goLive: { enabled: false, code: null, takeovers: [] } });
  assert.doesNotMatch(noCode, /phone-device-code/);
});

test("going live: on shows the take-over log, escaped, and says a PIN is needed without one", () => {
  const base = { status: "active", urls: ["http://x:9997/"], pinMode: "daily", pin: "1", phones: [], activity: [] };
  const on = phonePanelHtml({
    ...base,
    goLive: { enabled: true, code: "4821", takeovers: [{ at: new Date().toISOString(), phone: "Sam <b>", slide: "Amazing Grace, slide 4", replaced: "Welcome Loop, slide 1", ok: true }, { at: new Date().toISOString(), phone: "Lee", slide: "Offering, slide 1", ok: false, error: "ProPresenter isn't answering." }] },
  });
  assert.match(on, /checked/);
  assert.match(on, /Sam &lt;b&gt; put up Amazing Grace, slide 4, replacing Welcome Loop, slide 1/);
  assert.match(on, /Lee put up Offering, slide 1.*didn't work: ProPresenter isn&#39;t answering/);
  const noPin = phonePanelHtml({ ...base, pinMode: "none", goLive: { enabled: true, code: "4821", takeovers: [] } });
  assert.match(noPin, /Turn on a PIN first/);
});
