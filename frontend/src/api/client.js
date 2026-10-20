// project imports
import { expireSession, getIdToken } from './auth';

// ==============================|| API CLIENT ||============================== //

/**
 * The one place that knows how to talk to the backend.
 *
 * Paths are relative (`/api/...`) on purpose. In development Vite proxies `/api`
 * to the local backend (see vite.config.mjs); in production nginx proxies it to
 * the Cloud Run service (see nginx.conf.template). The page never learns the
 * API's real address, so one build runs anywhere and CORS never enters the picture.
 *
 * It is also where the session meets the API: every request carries the Identity
 * Platform ID token from api/auth.js, and a 401 that survives one fresh-token retry ends
 * the session so the route guard can send the user to sign in again and back to the
 * page they were on.
 */

async function authHeader(forceRefresh = false) {
  const token = await getIdToken(forceRefresh);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function send(path, buildInit, forceRefresh) {
  try {
    return await fetch(path, buildInit(await authHeader(forceRefresh)));
  } catch {
    throw new ApiError(0, 'Could not reach the API — is the backend running?');
  }
}

/**
 * fetch with the session's token. A 401 gets exactly one retry with a freshly minted
 * token, which covers a token that expired in flight or a clock running fast; a second
 * 401 means the API really refuses this session, so it ends.
 */
async function fetchWithToken(path, buildInit) {
  let response = await send(path, buildInit, false);
  if (response.status === 401 && (await getIdToken())) response = await send(path, buildInit, true);
  if (response.status === 401) expireSession();
  return response;
}

export class ApiError extends Error {
  constructor(status, detail, body = null) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** FastAPI puts its message in `detail` — a string for HTTPException, a list for validation errors. */
function detailOf(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((d) => `${(d.loc || []).slice(-1)[0] || 'field'}: ${d.msg}`).join('; ');
  return null;
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch(path, { method = 'GET', json, headers, ...rest } = {}) {
  const buildInit = (auth) => ({
    method,
    headers: { ...(json !== undefined && { 'content-type': 'application/json' }), ...auth, ...headers },
    ...(json !== undefined && { body: JSON.stringify(json) }),
    ...rest
  });
  const response = await fetchWithToken(path, buildInit);
  const body = parseBody(await response.text());
  if (!response.ok) throw new ApiError(response.status, detailOf(body) || `HTTP ${response.status}`, body);
  return body;
}

/**
 * Save a stored file. A plain link can't carry the Authorization header, so the file is
 * fetched with the token and handed to the browser as a download. It passes through
 * memory, which is fine for today's ≤ 30 MB inputs; multi-GB orthos will get short-lived
 * download URLs from the API instead.
 */
export async function apiDownload(path, filename) {
  const response = await fetchWithToken(path, (auth) => ({ headers: auth }));
  if (!response.ok) {
    const body = parseBody(await response.text());
    throw new ApiError(response.status, detailOf(body) || `HTTP ${response.status}`, body);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** For `useSWR(key, fetcher)` — the key is the path. */
export const fetcher = (path) => apiFetch(path);

/**
 * Multipart upload with a progress callback. `fetch` still cannot report upload
 * progress, so this one call uses XMLHttpRequest; everything else uses fetch.
 */
export async function apiUpload(path, formData, { onProgress } = {}) {
  const token = await getIdToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const body = parseBody(xhr.responseText);
      if (xhr.status === 401) expireSession();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, detailOf(body) || `HTTP ${xhr.status}`, body));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — could not reach the API.'));
    xhr.send(formData);
  });
}
