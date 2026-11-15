// ==============================|| API - UPLOAD SESSIONS ||============================== //

/**
 * Sends one file to a Cloud Storage *resumable upload session*: the URL the API
 * hands out per file when a flight is created (backend/app/storage.py). File
 * bytes go straight from the browser to the bucket and never through the API.
 *
 *   PUT <url>   Content-Range: bytes 0-8388607/TOTAL      the first 8 MiB
 *     ← 308     Range: bytes=0-8388607                    what storage has kept
 *   …
 *   PUT <url>   Content-Range: bytes N-(TOTAL-1)/TOTAL    the rest
 *     ← 200                                               the object exists
 *
 * After any failure it asks storage how much it has (`Content-Range: bytes *∕TOTAL`)
 * and carries on from that answer, never from its own count: a chunk can be
 * partly kept, or kept with its reply lost. So resuming after a dropped
 * connection, a sleeping laptop or a reloaded page is the same operation.
 *
 * No React and no app imports here. The transport is passed in: XHR in the
 * browser (it reports upload progress, which fetch can't), anything with the
 * same shape in tests (see uploadSession.test.js).
 *
 *   transport(url, { method, headers, body, onProgress(sentBytes), signal })
 *     → Promise<{ status, header(name) }> for any HTTP answer; rejects on a
 *       network failure (and with an UploadError of kind 'cancelled' on abort).
 */

// Storage needs every chunk but the last to be a multiple of 256 KiB. 8 MiB keeps
// a retried chunk cheap and progress lively on a slow field connection.
export const CHUNK_BYTES = 8 * 1024 * 1024;

// Consecutive failures before giving up and asking the user. The backoff doubles
// from 1 s to 30 s, so this is about two and a half minutes of trying.
const MAX_CONSECUTIVE_FAILURES = 8;

// Answers worth retrying: timeouts, throttling, storage's own hiccups — and 0,
// which is what a dropped connection looks like.
const TRANSIENT = new Set([0, 408, 429, 500, 502, 503, 504]);

/**
 * kind: 'expired'   the session is gone (about a week old, or cancelled elsewhere)
 *       'refused'   storage said no and retrying won't change that
 *       'offline'   too many failures in a row; resume once the connection is back
 *       'cancelled' the caller aborted
 */
export class UploadError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
  }
}

const cancelled = () => new UploadError('cancelled', 'The upload was cancelled.');

class Transient extends Error {}

/** "bytes=0-12345" → 12346 bytes kept. No header means nothing kept yet. */
function keptBytes(range) {
  const match = /bytes=0-(\d+)/.exec(range || '');
  return match ? Number(match[1]) + 1 : 0;
}

/** One answer from storage → { done } or { offset }; anything else throws. */
function interpret(response) {
  const { status } = response;
  if (status === 200 || status === 201) return { done: true, offset: null };
  if (status === 308) return { done: false, offset: keptBytes(response.header('range')) };
  if (status === 404 || status === 410) throw new UploadError('expired', 'This upload link has expired.');
  if (status === 499) throw cancelled();
  if (TRANSIENT.has(status)) throw new Transient(`HTTP ${status}`);
  throw new UploadError('refused', `Storage refused the upload (HTTP ${status}).`);
}

function backoff(failures) {
  const base = Math.min(30000, 1000 * 2 ** (failures - 1));
  return base * (0.75 + Math.random() * 0.5); // jitter, so many tabs don't retry in step
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(cancelled());
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** The transport's own failures are the network's: worth retrying. Errors in our code are not. */
async function call(transport, url, options) {
  try {
    return await transport(url, options);
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new Transient(error?.message || 'network error');
  }
}

/** Asks storage how much of the file it has: { done: true } or { done: false, offset }. */
export async function probeSession(url, size, { transport, signal } = {}) {
  return interpret(await call(transport, url, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, body: null, signal }));
}

/**
 * Uploads `file` (a File or Blob) to the session at `url`, resuming wherever
 * storage says it stands. Resolves when the object exists. `onProgress(bytes)`
 * reports how much of the file has been sent; it can move back after a failure,
 * to what storage actually kept.
 */
export async function sendToSession(url, file, { transport, onProgress, signal, chunkBytes = CHUNK_BYTES, wait = sleep } = {}) {
  const size = file.size;
  let failures = 0;
  let state = null; // null = ask storage first

  for (;;) {
    if (signal?.aborted) throw cancelled();
    try {
      if (!state) state = await probeSession(url, size, { transport, signal });
      if (state.done) {
        onProgress?.(size);
        return;
      }
      onProgress?.(state.offset);

      const start = state.offset;
      const end = Math.min(start + chunkBytes, size);
      const response = await call(transport, url, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
        body: file.slice(start, end),
        signal,
        onProgress: (sent) => onProgress?.(start + Math.min(sent, end - start))
      });
      state = interpret(response);
      // A 308 that kept nothing new would otherwise loop forever.
      if (!state.done && state.offset <= start) throw new Transient('no progress');
      failures = 0;
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (!(error instanceof Transient)) throw error;
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        throw new UploadError(
          'offline',
          'The connection to storage keeps dropping. The upload is paused; resume it when you’re back online.'
        );
      }
      await wait(backoff(failures), signal);
      state = null; // where to carry on is storage's answer, not ours
    }
  }
}

/** Abandons a session so storage drops what it kept. Best effort: an error changes nothing for the caller. */
export async function cancelSession(url, { transport } = {}) {
  try {
    await transport(url, { method: 'DELETE', headers: {}, body: null });
  } catch {
    // already gone, or offline: it expires on its own within a week
  }
}

/**
 * XMLHttpRequest, because fetch still can't report upload progress. A 308 with
 * no Location header is not a redirect, so XHR hands it back like any status.
 * The session URL is the whole credential: no Authorization header goes with it.
 */
export function xhrTransport(url, { method, headers = {}, body = null, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = (fn, value) => {
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    xhr.open(method, url);
    xhr.timeout = 10 * 60 * 1000; // one 8 MiB chunk on a crawling uplink, with room to spare
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    if (onProgress) xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => settle(resolve, { status: xhr.status, header: (name) => xhr.getResponseHeader(name) });
    xhr.onerror = () => settle(reject, new Error('network error'));
    xhr.ontimeout = () => settle(reject, new Error('timed out'));
    xhr.onabort = () => settle(reject, cancelled());
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

/**
 * The name the API stores a file under — backend/app/ids.py `safe_filename`,
 * line for line — so a file picked again after a reload can be matched to the
 * flight's record of it.
 */
export function safeFilename(name) {
  const base = String(name).replace(/\\/g, '/').split('/').pop();
  const cleaned = base.replace(/[^A-Za-z0-9._()-]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'file';
  return cleaned.slice(0, 120);
}
