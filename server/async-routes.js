/**
 * Express 4 doesn't catch an error thrown by an async route handler: the
 * request is never answered and the caller waits until it gives up, while
 * only the log hears about it (stress test, 2026-10-04: /api/slides/split hung
 * for 10s on a non-string `text`). These make every route's error reach the
 * error handler instead, so the caller always gets an answer.
 */

/** A route handler whose thrown errors and rejections go to `next`. */
export function catchAsync(fn) {
  if (typeof fn !== "function" || fn.length === 4) return fn; // error handlers stay as they are
  return function caught(req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === "function") out.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Wraps app.get/post/put/patch/delete so every route registered after this
 * is caught. `app.get(name)` with one argument (Express's settings getter) is
 * left alone.
 */
export function catchAsyncRoutes(app) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const original = app[method].bind(app);
    app[method] = (path, ...handlers) => (handlers.length ? original(path, ...handlers.map(catchAsync)) : original(path));
  }
  return app;
}

/** The last handler: one plain sentence, never a stack trace or a hang. */
export function routeErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`${req.method} ${req.path} failed:`, err?.stack ?? err);
  res.status(status).json({ error: status < 500 ? (err?.expose === false ? "Bad request." : err?.message ?? "Bad request.") : `Something went wrong: ${err?.message ?? "unknown error"}` });
}
