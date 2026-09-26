/**
 * A small SMTP client for the day summary (issue #4), on Node's own net and
 * tls, so sending a summary adds no dependency.
 *
 * Deliberately narrow: one message, plain text, to a short list of
 * recipients, through the church's own mail server. It supports what that
 * needs and nothing more: implicit TLS (port 465) or STARTTLS when the server
 * offers it, AUTH PLAIN or LOGIN, and a UTF-8 body sent as base64 so no line
 * length or 8-bit rule can mangle it. It refuses to send a password over a
 * connection that never became encrypted, unless `allowInsecure` is set
 * (for a test server on localhost).
 *
 * **This is the first thing in Refrain that sends data off the machine.** It
 * only runs when a church has turned on the report module, filled in its own
 * SMTP settings, and someone presses Send. See server/index.js.
 */

import net from "node:net";
import tls from "node:tls";
import { hostname } from "node:os";

const TIMEOUT_MS = 20_000;

/** RFC 2047 encoded-word, only when the text isn't plain ASCII. */
export function encodeHeader(text) {
  const s = String(text ?? "");
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** An address list that's safe to put in a header: no newlines, no injection. */
export function cleanAddress(a) {
  const s = String(a ?? "").trim();
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s) ? s : null;
}

/** The whole message, headers and base64 body, with CRLF line ends. */
export function buildMessage({ from, to, subject, text, date = new Date(), messageId }) {
  const body = Buffer.from(String(text ?? ""), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId ?? `${Date.now()}.${Math.random().toString(36).slice(2)}@refrain`}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Reads SMTP replies line by line; resolves each complete (possibly multi-line) reply. */
function replyReader(socket) {
  let buffer = "";
  const waiting = [];
  const ready = [];
  let failed = null;
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    let lines = [];
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines };
        lines = [];
        const w = waiting.shift();
        if (w) w.resolve(reply);
        else ready.push(reply);
      }
    }
    if (lines.length) buffer = `${lines.join("\n")}\n${buffer}`;
  };
  const fail = (err) => {
    failed = err;
    while (waiting.length) waiting.shift().reject(err);
  };
  socket.on("data", onData);
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("The mail server closed the connection.")));
  return {
    next() {
      if (ready.length) return Promise.resolve(ready.shift());
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    detach() {
      socket.off("data", onData);
    },
  };
}

/**
 * Sends one message. Resolves `{ accepted: [...] }`; rejects with an Error
 * whose message says which step the server refused, in words an admin can
 * act on.
 */
export async function sendMail({ host, port = 587, secure = port === 465, user, pass, from, to, subject, text, allowInsecure = false, timeoutMs = TIMEOUT_MS }) {
  const recipients = (to ?? []).map(cleanAddress).filter(Boolean);
  const sender = cleanAddress(from);
  if (!host) throw new Error("No mail server is set (SMTP_HOST).");
  if (!sender) throw new Error("The From address isn't a valid email address (SMTP_FROM).");
  if (!recipients.length) throw new Error("There's no valid recipient address.");

  let socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    s.setTimeout(timeoutMs, () => s.destroy(new Error("The mail server stopped answering.")));
    s.once(secure ? "secureConnect" : "connect", () => resolve(s));
    s.once("error", reject);
  });
  let encrypted = secure;
  let reader = replyReader(socket);
  const write = (line) => socket.write(`${line}\r\n`);
  const expect = async (codes, step) => {
    const reply = await reader.next();
    if (!codes.includes(reply.code)) {
      throw new Error(`The mail server refused ${step}: ${reply.lines.join(" ").slice(0, 200)}`);
    }
    return reply;
  };

  try {
    await expect([220], "the connection");
    const helo = `EHLO ${hostname().replace(/[^A-Za-z0-9.-]/g, "") || "refrain"}`;
    write(helo);
    let ehlo = await expect([250], "EHLO");
    const offers = (word) => ehlo.lines.some((l) => l.slice(4).toUpperCase().startsWith(word));

    if (!encrypted && offers("STARTTLS")) {
      write("STARTTLS");
      await expect([220], "STARTTLS");
      reader.detach();
      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host }, () => resolve(t));
        t.once("error", reject);
      });
      encrypted = true;
      reader = replyReader(socket);
      write(helo);
      ehlo = await expect([250], "EHLO after STARTTLS");
    }

    if (user) {
      if (!encrypted && !allowInsecure) {
        throw new Error("The mail server didn't offer an encrypted connection, so Refrain won't send the password. Use port 465, or a server that supports STARTTLS.");
      }
      const auth = ehlo.lines.find((l) => l.slice(4).toUpperCase().startsWith("AUTH"))?.toUpperCase() ?? "";
      if (auth.includes("PLAIN") || !auth.includes("LOGIN")) {
        write(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass ?? ""}`).toString("base64")}`);
        await expect([235], "the username or password");
      } else {
        write("AUTH LOGIN");
        await expect([334], "AUTH LOGIN");
        write(Buffer.from(user).toString("base64"));
        await expect([334], "the username");
        write(Buffer.from(pass ?? "").toString("base64"));
        await expect([235], "the password");
      }
    }

    write(`MAIL FROM:<${sender}>`);
    await expect([250], "the From address");
    const accepted = [];
    for (const r of recipients) {
      write(`RCPT TO:<${r}>`);
      const reply = await reader.next();
      if (reply.code === 250 || reply.code === 251) accepted.push(r);
    }
    if (!accepted.length) throw new Error("The mail server refused every recipient.");
    write("DATA");
    await expect([354], "the message");
    // Dot-stuffing: a line starting with "." would otherwise end the message early.
    const message = buildMessage({ from: sender, to: accepted, subject, text }).replace(/^\./gm, "..");
    socket.write(`${message}\r\n.\r\n`);
    await expect([250], "the message");
    write("QUIT");
    return { accepted };
  } finally {
    socket.end();
  }
}
