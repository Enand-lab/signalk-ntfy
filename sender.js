// sender.js
const fetch = require('node-fetch');

// Tiempo maximo de una peticion. Un servidor que acepta la conexion y no contesta
// dejaria el envio pendiente para siempre; con esto cae y entra en el reintento.
const REQUEST_TIMEOUT_MS = 10000;

const DEFAULT_STATE_PRIORITY_MAP = {
  'normal': 2,
  'alert': 3,
  'warn': 3,
  'alarm': 4,
  'emergency': 5
};

async function sendNotification(app, config, opts) {
  const { message, title, actions, topic, server, state, value, priority: overridePriority, tags } = opts;
  
  const targetServer = server || config.servers.find(s => s.id === config.activeServerId);
  if (!targetServer) {
    app.error('[ntfy] No se pudo determinar el servidor objetivo');
    throw new Error('No hay servidor ntfy configurado o activo');
  }
  
  const targetTopic = topic || config.topic;
  
  // URL a la raíz del servidor (sin topic)
  let fullUrl = targetServer.url.trim();
  if (!fullUrl.startsWith('http')) {
    fullUrl = 'https://' + fullUrl;
  }
  fullUrl = fullUrl.replace(/\/$/, '') + '/';  // Raíz del servidor
  
  app.debug(`[ntfy] Enviando a servidor: ${targetServer.name} (${targetServer.id})`);
  app.debug(`[ntfy] URL: ${fullUrl}`);
  app.debug(`[ntfy] Topic: ${targetTopic}`);
  
  // Sanitizar message
  let safeMessage = '';
  if (typeof message === 'string') {
    safeMessage = message;
  } else if (message && typeof message === 'object') {
    safeMessage = Object.values(message)[0] || JSON.stringify(message);
  } else {
    safeMessage = String(message || 'No message');
  }
  
  const safeTitle = typeof title === 'string' ? title : 'SignalK Alert';
  
  // Determinar prioridad
  let finalPriority = 3;
  if (overridePriority !== undefined) {
    finalPriority = parseInt(overridePriority, 10);
  } else {
    const signalKState = state || (value && value.state) || 'normal';
    const priorityMap = targetServer.priorityMap || DEFAULT_STATE_PRIORITY_MAP;
    finalPriority = priorityMap[signalKState] !== undefined ? priorityMap[signalKState] : 3;
  }
  
  // Construir body JSON completo
  const body = {
    topic: targetTopic,  // Topic va en el JSON
    message: safeMessage,
    title: safeTitle,
    priority: finalPriority
  };
  
  // Añadir tags si existen
  if (tags) {
    body.tags = Array.isArray(tags) ? tags : tags.split(',');
  }
  
  // Procesar acciones
  if (actions && Array.isArray(actions)) {
    body.actions = actions.map(action => {
      if (action.action === 'broadcast') {
        const actionId = action.actionId || `action_${Date.now()}`;
        let actionUrl = targetServer.url.trim();
        
        if (actionUrl.includes('ntfy.sh')) {
          actionUrl = actionUrl.replace(/^http:/, 'https:');
          if (!actionUrl.startsWith('http')) {
            actionUrl = 'https://' + actionUrl;
          }
        } else if (!actionUrl.startsWith('http')) {
          actionUrl = 'http://' + actionUrl;
        }
        
        actionUrl = actionUrl.replace(/\/$/, '') + '/' + encodeURIComponent(config.responsesTopic);
        
        return {
          action: "http",
          label: action.label,  // UTF-8 directo en JSON
          url: actionUrl,
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: `${action.message}, actionId:${actionId}`
        };
      }
      return action;
    }).filter(a => a);
  }
  
  // Headers para JSON
  const headers = { 
    'Content-Type': 'application/json'
  };
  
  if (targetServer.token && typeof targetServer.token === 'string' && targetServer.token.trim() !== '') {
    headers['Authorization'] = `Bearer ${targetServer.token.trim()}`;
    app.debug('[ntfy] Usando token de autenticación (Bearer)');
  } else {
    app.debug('[ntfy] AVISO: No se encontró token en la configuración de este servidor.');
  }
  
  app.debug(`[ntfy] Body JSON: ${JSON.stringify(body, null, 2)}`);
  
  // El error que sale de aqui lleva dos datos que usa la cola de reintentos de
  // retry.js: `status` (HTTP, si lo hubo) y `retryable` (si tiene sentido repetir).
  // Se reintenta en error de red, timeout, HTTP 5xx y HTTP 429; un 4xx (401, 403)
  // es error de configuracion y no se repite.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let failure = null;
  
  try {
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    if (!res.ok) {
      const text = await res.text();
      app.error(`[ntfy] Error HTTP ${res.status}: ${text}`);
      failure = new Error(`HTTP ${res.status}`);
      failure.status = res.status;
      failure.retryable = res.status >= 500 || res.status === 429;
    } else {
      app.debug('[ntfy] Notificación enviada correctamente');
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      failure = new Error(`timeout tras ${REQUEST_TIMEOUT_MS} ms`);
      failure.code = 'ETIMEDOUT';
    } else {
      failure = new Error(error && error.message ? error.message : String(error));
      if (error && error.code) failure.code = error.code;
      if (error && error.type) failure.type = error.type;
    }
    // Cualquier excepcion en el fetch es de red o de tiempo: se reintenta.
    // Una URL invalida es configuracion, no red, y no se repite.
    failure.retryable = failure.code !== 'ERR_INVALID_URL';
  } finally {
    clearTimeout(timeoutHandle);
  }
  
  if (failure) {
    app.error(`[ntfy] Error: ${failure.message}`);
    throw failure;
  }
}

module.exports = { sendNotification, REQUEST_TIMEOUT_MS };
