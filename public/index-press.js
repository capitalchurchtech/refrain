import { askToConfirm } from "./notice.js";

/**
 * Starts an index run the person asked for (a Refresh or a Rebuild). If the
 * server says a service is starting or running and wants a yes first, asks
 * "Run anyway?" and, on yes, sends it again with `{ confirm: true }`. A
 * `extra` fields ride along on both sends (the Deep reindex flag). Cancel answers with the same kind of 409 a refusal would, so each caller's
 * existing "it didn't run" handling says so.
 */
export async function postIndexRun(url, { ask = askToConfirm, send = fetch, extra = {} } = {}) {
  const post = (body) => send(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...extra, ...body }) });
  const first = await post({});
  if (first.status !== 409) return first;
  const data = await first.clone().json().catch(() => ({}));
  if (!data.needsConfirm) return first;
  if (!(await ask(data.error, "Run anyway"))) {
    return new Response(JSON.stringify({ error: "Left as it was." }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  return post({ confirm: true });
}
