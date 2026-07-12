/**
 * Autodetects a ProPresenter Network API on the network so first-run
 * setup doesn't need the user to know the host and port.
 *
 * Strategy, fastest first:
 *   1. Same machine: on macOS, ask `lsof` which TCP ports ProPresenter is
 *      listening on (it listens on several — stage display, remote, API),
 *      then confirm which one answers the API. No port guessing needed,
 *      and it's the overwhelmingly common case (Refrain is a sidecar on
 *      the ProPresenter Mac). A couple of common ports are also probed on
 *      localhost as a fallback for non-macOS or odd setups.
 *   2. Only if nothing's local: scan each private /24 for the common
 *      ports, checking the TCP port is open before the HTTP confirm so
 *      empty addresses don't each cost a full timeout.
 *
 * A host:port is confirmed as ProPresenter by GET /v1/status/layers (the
 * same call the client's testConnection uses, known to 200 on a real
 * instance). /version, if present, provides a friendly name.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import { networkInterfaces, platform } from "node:os";

const execFileAsync = promisify(execFile);
const HTTP_TIMEOUT_MS = 1500;
const TCP_TIMEOUT_MS = 400;

async function identify(host, port) {
  try {
    const res = await fetch(`http://${host}:${port}/v1/status/layers`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;
  } catch {
    return null; // refused, timed out, or not HTTP
  }
  let name = "ProPresenter";
  try {
    const v = await fetch(`http://${host}:${port}/version`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (v.ok) {
      const j = await v.json();
      name = j.name || j.host_description || name;
    }
  } catch {
    // /version may not exist on every version — the name just stays generic.
  }
  return { host, port, name };
}

// macOS only: the TCP ports ProPresenter is currently listening on.
async function proPresenterListeningPorts() {
  if (platform() !== "darwin") return [];
  try {
    const { stdout } = await execFileAsync("lsof", ["+c", "0", "-iTCP", "-sTCP:LISTEN", "-nP"], { timeout: 5000 });
    const ports = new Set();
    for (const line of stdout.split("\n")) {
      if (!/propresenter/i.test(line)) continue;
      const m = line.match(/:(\d+)\s*\(LISTEN\)/);
      if (m) ports.add(Number(m[1]));
    }
    return [...ports];
  } catch {
    return [];
  }
}

function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const finish = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

// Run `fn` over `items` with a bounded number in flight at once.
async function pool(items, size, fn) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

function privateSubnets() {
  const subnets = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      subnets.push({ base: ni.address.split(".").slice(0, 3).join("."), own: Number(ni.address.split(".")[3]) });
    }
  }
  return subnets;
}

/**
 * @returns {Promise<{host: string, port: number, name: string}[]>}
 */
export async function scanForProPresenter({ configuredPort = null } = {}) {
  const commonPorts = [...new Set([configuredPort, 1025].filter((p) => Number.isInteger(p) && p > 0))];

  // 1. Same machine.
  const localPorts = [...new Set([...(await proPresenterListeningPorts()), ...commonPorts])];
  const local = (await pool(localPorts, 16, (port) => identify("127.0.0.1", port))).filter(Boolean);
  if (local.length) return dedupe(local);

  // 2. LAN fallback.
  const targets = [];
  for (const { base, own } of privateSubnets()) {
    for (let h = 1; h <= 254; h++) {
      if (h === own) continue;
      for (const port of commonPorts) targets.push({ host: `${base}.${h}`, port });
    }
  }
  const open = (await pool(targets, 64, async (t) => ((await tcpOpen(t.host, t.port)) ? t : null))).filter(Boolean);
  const remote = (await pool(open, 16, (t) => identify(t.host, t.port))).filter(Boolean);
  return dedupe(remote);
}

function dedupe(hits) {
  const seen = new Set();
  return hits.filter((h) => {
    const key = `${h.host}:${h.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
