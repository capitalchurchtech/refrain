/**
 * Email the day summary through the church's own mail server.
 *
 * Settings: `reportModule.recipients` in config.json; the server and
 * credentials in .env (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD,
 * SMTP_FROM). The body is the summary's Markdown as plain text, which reads
 * cleanly in any mail client; an HTML version is not built.
 */
import { DeliveryBackend } from "./base.js";
import { sendMail, cleanAddress } from "../server/smtp.js";

export default class EmailDelivery extends DeliveryBackend {
  static backendId = "email";
  static displayName = "Email";
  static sendsOffMachine = true;
  static requiredEnv = [{ name: "SMTP_HOST" }, { name: "SMTP_FROM" }];

  static problems(moduleConfig, env) {
    const out = [];
    if (!env.SMTP_HOST) out.push("SMTP_HOST isn't set in .env.");
    if (!cleanAddress(env.SMTP_FROM)) out.push("SMTP_FROM in .env isn't a valid email address.");
    const good = (moduleConfig?.recipients ?? []).filter((r) => cleanAddress(r));
    if (!good.length) out.push("reportModule.recipients has no valid addresses.");
    return out;
  }

  async deliver({ subject, markdown, moduleConfig, env }) {
    const port = Number(env.SMTP_PORT) || 587;
    const { accepted } = await sendMail({
      host: env.SMTP_HOST,
      port,
      user: env.SMTP_USERNAME || undefined,
      pass: env.SMTP_PASSWORD || undefined,
      from: env.SMTP_FROM,
      to: moduleConfig?.recipients ?? [],
      subject,
      text: markdown,
    });
    return { ok: true, detail: `Sent to ${accepted.length} recipient${accepted.length === 1 ? "" : "s"}.` };
  }
}
