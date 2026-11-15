// Run with `npm test` (node --test). No browser, no server: the transport is a
// fake Cloud Storage session that keeps what it is sent, and can drop
// connections, lose replies or keep only part of a chunk, the way the real one can.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { probeSession, safeFilename, sendToSession, UploadError } from './uploadSession.js';

const KiB = 1024;
const CHUNK = 256 * KiB; // the smallest chunk storage accepts
const noWait = async () => {};

function fileOf(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 251;
  return new Blob([bytes]);
}

/**
 * A resumable session as Cloud Storage runs one. `faults` is a list of what to
 * do to the Nth chunk PUT (0-based): 'drop' (no reply, nothing kept), 'lose-reply'
 * (kept, reply lost), 'half' (keeps half the chunk, answers 308), or an HTTP status.
 * A request Cloud Storage would refuse gets its 400, and is noted in `violations`.
 */
function fakeSession(size, faults = {}) {
  const kept = new Uint8Array(size);
  let keptLength = 0;
  let finished = false;
  let chunkPuts = 0;
  const violations = [];
  const reply = (status, range = null) => ({ status, header: (name) => (name.toLowerCase() === 'range' ? range : null) });
  const keptRange = () => (keptLength ? `bytes=0-${keptLength - 1}` : null);
  const refuse = (why) => {
    violations.push(why);
    return reply(400);
  };

  async function transport(url, { method, headers, body, onProgress }) {
    if (method !== 'PUT') return refuse(`unexpected ${method}`);
    const match = /^bytes (\*|(\d+)-(\d+))\/(\d+)$/.exec(headers['Content-Range'] || '');
    if (!match) return refuse(`bad Content-Range ${headers['Content-Range']}`);
    if (Number(match[4]) !== size) return refuse('the total changed');
    if (match[1] === '*') return finished ? reply(200) : reply(308, keptRange());

    const first = Number(match[2]);
    const last = Number(match[3]);
    const data = new Uint8Array(await body.arrayBuffer());
    if (data.length !== last - first + 1) return refuse('body length differs from its Content-Range');
    if (first !== keptLength) return refuse(`chunk starts at ${first}, storage has ${keptLength}`);
    if (last + 1 < size && data.length % CHUNK) return refuse('a chunk that is not the last must be a multiple of 256 KiB');
    onProgress?.(data.length);

    const fault = faults[chunkPuts];
    chunkPuts += 1;
    if (fault === 'drop') throw new TypeError('network error');
    if (typeof fault === 'number') return reply(fault);
    const keep = fault === 'half' ? data.subarray(0, CHUNK / 2) : data;
    kept.set(keep, keptLength);
    keptLength += keep.length;
    if (keptLength === size) finished = true;
    if (fault === 'lose-reply') throw new TypeError('network error');
    return finished ? reply(200) : reply(308, keptRange());
  }
  return { transport, kept: () => kept.slice(0, keptLength), finished: () => finished, violations };
}

async function expectSame(session, file) {
  assert.deepEqual(session.violations, []);
  assert.ok(session.finished());
  assert.deepEqual(session.kept(), new Uint8Array(await file.arrayBuffer()));
}

test('sends a file in chunks and reports progress up to its size', async () => {
  const file = fileOf(4 * CHUNK + 1000);
  const session = fakeSession(file.size);
  const progress = [];
  await sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, onProgress: (n) => progress.push(n), wait: noWait });
  await expectSame(session, file);
  assert.equal(progress.at(-1), file.size);
  assert.ok(
    progress.every((n, i) => i === 0 || n >= progress[i - 1] - CHUNK),
    'progress only steps back to what storage kept'
  );
});

test('a dropped connection resumes from what storage kept', async () => {
  const file = fileOf(3 * CHUNK);
  const session = fakeSession(file.size, { 1: 'drop' });
  await sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, wait: noWait });
  await expectSame(session, file);
});

test('a chunk storage kept only half of is resent from the half', async () => {
  const file = fileOf(3 * CHUNK);
  const session = fakeSession(file.size, { 0: 'half' });
  await sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, wait: noWait });
  await expectSame(session, file);
});

test('a lost reply to the last chunk ends in success, not a resend', async () => {
  const file = fileOf(2 * CHUNK);
  const session = fakeSession(file.size, { 1: 'lose-reply' });
  await sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, wait: noWait });
  await expectSame(session, file);
});

test('storage hiccups (503, 429) are retried', async () => {
  const file = fileOf(2 * CHUNK);
  const session = fakeSession(file.size, { 0: 503, 1: 429 });
  await sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, wait: noWait });
  await expectSame(session, file);
});

test('an expired session says so', async () => {
  const file = fileOf(CHUNK);
  const session = fakeSession(file.size, { 0: 404 });
  await assert.rejects(sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, wait: noWait }), {
    name: 'UploadError',
    kind: 'expired'
  });
});

test('a refusal is not retried', async () => {
  const file = fileOf(CHUNK);
  const session = fakeSession(file.size, { 0: 403 });
  await assert.rejects(sendToSession('u', file, { transport: session.transport, wait: noWait }), { kind: 'refused' });
});

test('a connection that keeps dropping pauses the upload', async () => {
  const file = fileOf(2 * CHUNK);
  const faults = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, 'drop']));
  const session = fakeSession(file.size, faults);
  await assert.rejects(sendToSession('u', file, { transport: session.transport, chunkBytes: CHUNK, wait: noWait }), {
    kind: 'offline'
  });
});

test('aborting stops it with kind cancelled', async () => {
  const file = fileOf(4 * CHUNK);
  const session = fakeSession(file.size);
  const controller = new AbortController();
  const transport = async (url, options) => {
    const response = await session.transport(url, options);
    if (session.kept().length >= 2 * CHUNK) controller.abort();
    return response;
  };
  await assert.rejects(sendToSession('u', file, { transport, chunkBytes: CHUNK, signal: controller.signal, wait: noWait }), {
    kind: 'cancelled'
  });
  assert.ok(!session.finished());
});

test('a finished session probes as done', async () => {
  const file = fileOf(CHUNK);
  const session = fakeSession(file.size);
  await sendToSession('u', file, { transport: session.transport, wait: noWait });
  assert.deepEqual(await probeSession('u', file.size, { transport: session.transport }), { done: true, offset: null });
  assert.ok(new UploadError('expired', 'x') instanceof Error);
});

test('safeFilename matches the API', () => {
  // the same cases as backend/app/ids.py safe_filename
  assert.equal(safeFilename('../../etc/passwd.tif'), 'passwd.tif');
  assert.equal(safeFilename('C:\\Users\\jake\\Roujol A 12-12-24.tif'), 'Roujol_A_12-12-24.tif');
  assert.equal(safeFilename('parcelles (v2).shp'), 'parcelles_(v2).shp');
  assert.equal(safeFilename('été_ortho.tif'), 't__ortho.tif');
  assert.equal(safeFilename('...'), 'file');
  assert.equal(safeFilename(`${'a'.repeat(200)}.tif`).length, 120);
});
