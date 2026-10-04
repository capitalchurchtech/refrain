/**
 * Base interface for summary delivery backends (issue #4): where End's day
 * summary goes once someone presses Send. See CONTRIBUTING.md.
 *
 * Drop a file in delivery/ and it's discovered; nothing lists them.
 */
export class DeliveryBackend {
  /** Human-readable name for the Service screen ("Send by Email"). */
  static get displayName() {
    return this.backendId
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }

  /**
   * True when delivering sends data off this machine. The Service screen
   * says so beside the Send button, because that's the one promise the
   * README makes most plainly: nothing leaves unless you connect it.
   */
  static sendsOffMachine = false;

  /**
   * Whether this backend sends to a list of addresses
   * (`reportModule.recipients`), which Settings › Features › Day summary
   * then lets the church edit. A backend without one (a folder) is set up
   * in config.json and left alone by that screen.
   */
  static takesRecipients = false;

  /** Environment variables it needs, as { name, roles? } (same shape as providers). */
  static requiredEnv = [];

  /** Problems with its configuration, as sentences. Empty means ready. */
  static problems(_moduleConfig, _env) {
    return [];
  }

  /**
   * @param {{ day: string, subject: string, markdown: string, moduleConfig: object, env: object }} summary
   * @returns {Promise<{ ok: true, detail: string }>} throws with a sentence on failure
   */
  async deliver(_summary) {
    throw new Error("Not implemented");
  }
}
