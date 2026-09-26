import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { sendMail, buildMessage, encodeHeader, cleanAddress } from "../server/smtp.js";

// A fake mail server: plain TCP, records the dialogue, accepts AUTH PLAIN.
function fakeServer({ offerStartTls = false, refuseRcpt = [] } = {}) {
  const log = [];
  let data = null;
  const server = net.createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            sock.write("250 queued\r\n");
          } else data.push(line);
          continue;
        }
        log.push(line);
        if (line.startsWith("EHLO")) sock.write(`250-fake\r\n250-AUTH PLAIN LOGIN\r\n${offerStartTls ? "250-STARTTLS\r\n" : ""}250 8BITMIME\r\n`);
        else if (line.startsWith("AUTH PLAIN")) sock.write("235 ok\r\n");
        else if (line.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
        else if (line.startsWith("RCPT TO")) sock.write(refuseRcpt.some((r) => line.includes(r)) ? "550 no\r\n" : "250 ok\r\n");
        else if (line === "DATA") {
          inData = true;
          data = [];
          sock.write("354 go\r\n");
        } else if (line === "QUIT") sock.end("221 bye\r\n");
        else if (line === "STARTTLS") sock.write("454 not today\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, log, message: () => data })));
}

test("a summary is sent: auth, envelope, every accepted recipient, a base64 UTF-8 body", async () => {
  const s = await fakeServer({ refuseRcpt: ["gone@"] });
  try {
    const r = await sendMail({
      host: "127.0.0.1", port: s.port, secure: false, allowInsecure: true,
      user: "booth", pass: "pw", from: "booth@example.org",
      to: ["team@example.org", "gone@example.org", "not an address"],
      subject: "Sunday — summary", text: "Line one\n.leading dot\nÉmilie",
    });
    assert.deepEqual(r.accepted, ["team@example.org"]);
    assert.ok(s.log.includes(`AUTH PLAIN ${Buffer.from("\0booth\0pw").toString("base64")}`));
    assert.ok(s.log.includes("MAIL FROM:<booth@example.org>"));
    const msg = s.message();
    assert.ok(msg.includes("Subject: =?UTF-8?B?" + Buffer.from("Sunday — summary").toString("base64") + "?="));
    const body = Buffer.from(msg.slice(msg.indexOf("") + 1).join(""), "base64").toString("utf8");
    assert.equal(body, "Line one\n.leading dot\nÉmilie");
  } finally {
    s.server.close();
  }
});

test("a password is never sent over a connection that didn't become encrypted", async () => {
  const s = await fakeServer();
  try {
    await assert.rejects(
      sendMail({ host: "127.0.0.1", port: s.port, secure: false, user: "booth", pass: "pw", from: "a@example.org", to: ["b@example.org"], subject: "x", text: "y" }),
      /won't send the password/
    );
    assert.ok(!s.log.some((l) => l.startsWith("AUTH")));
  } finally {
    s.server.close();
  }
});

test("bad settings are refused before connecting, and headers can't be injected", async () => {
  await assert.rejects(sendMail({ host: "", from: "a@example.org", to: ["b@example.org"] }), /SMTP_HOST/);
  await assert.rejects(sendMail({ host: "x", from: "nope", to: ["b@example.org"] }), /SMTP_FROM/);
  await assert.rejects(sendMail({ host: "x", from: "a@example.org", to: ["bad\r\nBcc: evil@example.org"] }), /no valid recipient/);
  assert.equal(cleanAddress("x@y.org\r\nBcc: z@q.org"), null);
  assert.equal(encodeHeader("Plain"), "Plain");
  const m = buildMessage({ from: "a@example.org", to: ["b@example.org"], subject: "Hi", text: "Body", date: new Date(0), messageId: "id@x" });
  assert.match(m, /^From: a@example.org\r\nTo: b@example.org\r\nSubject: Hi\r\n/);
});
