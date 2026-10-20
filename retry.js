// retry.js
//
// Cola de reintentos de envio a ntfy (issue #5 de Enand-lab/signalk-ntfy).
//
// Una notificacion que falla se reintenta a los 5, 15 y 45 s (delays), ~65 s en
// total, y despues sale un error final en el log. Solo se reintenta cuando tiene
// sentido: error de red, timeout, HTTP 5xx y HTTP 429. Un 4xx (401, 403) es error
// de configuracion y no se repite.
//
// El estado es por path: una notificacion nueva del mismo path SUSTITUYE al
// reintento pendiente de ese path, de modo que un productor que repite cada pocos
// segundos durante una caida no acumula cola de envios.

const RETRY_DELAYS_MS = [5000, 15000, 45000];

// Decide si un error merece otro intento. El sender pone `retryable` y `status`;
// si falta el dato se deduce del status HTTP, y sin status se asume red.
function isRetryable(error) {
  if (!error) return false;
  if (typeof error.retryable === 'boolean') return error.retryable;
  const status = Number(error.status);
  if (Number.isFinite(status) && status > 0) return status >= 500 || status === 429;
  return true;
}

// Opciones:
//   app            objeto de Signal K (usa error/debug); solo para logs
//   send(job)      hace UN intento, devuelve promesa (rechaza si falla)
//   delays         milisegundos entre intentos; por defecto 5/15/45 s
//   setTimer       inyectable para las pruebas con reloj falso
//   clearTimer     idem
function createRetryQueue({ app, send, delays = RETRY_DELAYS_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map();  // path -> job en curso (intento en vuelo o esperando reintento)

  function log(level, msg) {
    if (app && typeof app[level] === 'function') app[level](msg);
  }

  function finish(job) {
    if (pending.get(job.path) === job) pending.delete(job.path);
  }

  async function attempt(job) {
    job.timer = null;
    let error = null;
    try {
      await send(job);
    } catch (err) {
      error = err || new Error('error desconocido');
    }
    // Si mientras se enviaba llego otra notificacion del mismo path, este job ya
    // no manda: el nuevo ocupa su lugar y el resultado se descarta.
    if (job.cancelled) return;
    if (!error) {
      finish(job);
      job.onSuccess();
      return;
    }
    const retryable = isRetryable(error);
    if (!retryable || job.attempt >= delays.length) {
      finish(job);
      log('error', `[ntfy] Envío fallido definitivo para ${job.path} tras ${job.attempt + 1} intento(s): ${error.message}`);
      job.onFailure(error, { attempts: job.attempt + 1, retryable });
      return;
    }
    const delay = delays[job.attempt];
    job.attempt += 1;
    log('error', `[ntfy] Fallo el envío de ${job.path} (${error.message}). Reintento ${job.attempt}/${delays.length} en ${Math.round(delay / 1000)} s`);
    job.timer = setTimer(() => { attempt(job); }, delay);
  }

  // Encola una notificacion. `path` identifica el stream: si ya habia un job para
  // ese path (esperando reintento o en vuelo) se cancela y manda el nuevo.
  function enqueue({ path, payload, onSuccess, onFailure }) {
    const previous = pending.get(path);
    if (previous) {
      previous.cancelled = true;
      if (previous.timer) clearTimer(previous.timer);
      pending.delete(path);
      log('debug', `[ntfy] Reintento pendiente de ${path} sustituido por una notificación nueva`);
    }
    const job = {
      path,
      payload,
      attempt: 0,
      timer: null,
      cancelled: false,
      onSuccess: typeof onSuccess === 'function' ? onSuccess : () => {},
      onFailure: typeof onFailure === 'function' ? onFailure : () => {}
    };
    pending.set(path, job);
    attempt(job);
    return job;
  }

  // Cuantos jobs siguen vivos (esperando reintento o en vuelo): lo usan las pruebas.
  function size() {
    return pending.size;
  }

  // Plugin detenido o reconfigurado: se tiran los reintentos pendientes.
  function cancelAll() {
    for (const job of pending.values()) {
      job.cancelled = true;
      if (job.timer) clearTimer(job.timer);
    }
    pending.clear();
  }

  return { enqueue, cancelAll, size };
}

module.exports = { createRetryQueue, isRetryable, RETRY_DELAYS_MS };
