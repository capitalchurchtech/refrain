/**
 * The current slide and the next one, as pictures and words (owner request).
 *
 * Words come from the search index, free. Pictures come from ProPresenter's
 * thumbnail API (about 50ms, 25KB each), so they're cached, fetched only for
 * the current and next slide, and only when someone is looking. "Next" is the
 * next slide in the same presentation; ProPresenter doesn't say what the
 * next playlist item is, so the last slide says "end of this presentation".
 */

/** What to preview for what's live now. Pure. */
export function previewTargets(slide, textOf = () => null) {
  if (!slide?.presentationId || !Number.isInteger(slide.slideIndex)) return { current: null, next: null, atEnd: false };
  const count = Number.isInteger(slide.slideCount) ? slide.slideCount : null;
  const current = { presentationId: slide.presentationId, slideIndex: slide.slideIndex, text: slide.text ?? textOf(slide.presentationId, slide.slideIndex) };
  const atEnd = count !== null && slide.slideIndex + 1 >= count;
  const next = atEnd ? null : { presentationId: slide.presentationId, slideIndex: slide.slideIndex + 1, text: textOf(slide.presentationId, slide.slideIndex + 1) };
  return { presentationName: slide.presentationName ?? slide.name ?? null, current, next, atEnd };
}

/**
 * A small cache of slide pictures, oldest dropped first, with one fetch at a
 * time per slide so two screens asking at once cost one request.
 *
 * **At most `concurrency` pictures are asked of ProPresenter at once**, the
 * rest wait their turn. Each miss is a render on the live machine, and a
 * phone scrolling the tray (up to 300 slides) could otherwise ask for dozens
 * together mid-service. `max` holds a whole tray, so scrolling back doesn't
 * render again. A wait that grows past `maxQueued` refuses new misses (null,
 * the same as "no picture") rather than piling up work nobody will see.
 * `stored(presentationId, slideIndex)`, when given, is asked first and outside
 * the limit: a picture already on disk costs ProPresenter nothing.
 */
export function createThumbCache(fetchThumb, { max = 300, concurrency = 2, maxQueued = 60, stored = null } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      running++;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  const limited = (run) =>
    new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      pump();
    });
  return async function get(presentationId, slideIndex) {
    const key = `${presentationId}:${slideIndex}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit); // most recently used last
      return hit;
    }
    if (inflight.has(key)) return inflight.get(key);
    // A picture already on disk is a local read: taken before the queue, so
    // it never waits for a render slot or counts toward maxQueued.
    const fromDisk = stored ? await stored(presentationId, slideIndex) : null;
    if (fromDisk) {
      cache.set(key, fromDisk);
      while (cache.size > max) cache.delete(cache.keys().next().value);
      return fromDisk;
    }
    if (inflight.has(key)) return inflight.get(key);
    if (queue.length >= maxQueued) return null;
    const p = limited(() => fetchThumb(presentationId, slideIndex))
      .then((img) => {
        if (img) {
          cache.set(key, img);
          while (cache.size > max) cache.delete(cache.keys().next().value);
        }
        return img;
      })
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
