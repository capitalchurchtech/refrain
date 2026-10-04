/**
 * Express 4 doesn't catch an error thrown by an async route handler: the
 * request is never answered and the caller waits until it gives up, while
 * only the log hears about it (stress test, 2026-10-04: /api/slides/split hung
 * for 10s on a non-string `text`).
 *
 * The fix is at the level where Express runs every handler (Layer), not per
 * route or per `app.get`: that covers both of Refrain's listeners, every way a
 * route can be registered (app.all, app.route, express.Router, a module's own
 * router), and anything added later (code review, 2026-10-04).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Layer = require("express/lib/router/layer.js");

/** The error a falsy rejection becomes, so it can't read as "no route here". */
const asError = (err) => err ?? new Error("The route failed without saying why.");

/** A handler whose thrown errors and rejections go to `next`, as an Error. */
export function catchAsync(fn) {
  if (typeof fn !== "function" || fn.length === 4) return fn; // error handlers stay as they are
  return function caught(req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === "function") out.then(undefined, (err) => next(asError(err)));
    } catch (err) {
      next(asError(err));
    }
  };
}

let installed = false;
/** Makes every Express handler in this process answer when it throws. Once. */
export function installAsyncErrorCatching() {
  if (installed) return;
  installed = true;
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // an error handler, not a request handler
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === "function") out.then(undefined, (err) => next(asError(err)));
    } catch (err) {
      next(asError(err));
    }
  };
}

/**
 * The last handler: a status and one plain sentence, never a hang. A request
 * error (a body that wasn't JSON) says what was wrong; a fault in Refrain is
 * logged in full and answered generically, so no file path or internal
 * detail reaches the screen.
 */
export function routeErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) {
    console.error(`${req.method} ${req.path} failed:`, err?.stack ?? err);
    return res.status(status).json({ error: "Something went wrong in Refrain. Its log has the details." });
  }
  res.status(status).json({ error: err?.expose !== false && err?.message ? err.message : "Bad request." });
}
