// sender.js
const fetch = require('node-fetch');

// Memoria para el filtro de duplicados: guarda la última marca de tiempo por path
const lastNotificationTime = {};

const DEFAULT_STATE_PRIORITY_MAP = {
  'normal': 2,
  'alert': 3,
  'warn': 3,
  'alarm': 4,
  'emergency': 5
};

async function sendNotification(app, config, opts) {
  const { message, title, actions, topic, server, state, value, path } = opts;
  
  const targetServer = server || config.servers.find(s => s.id === config.activeServerId);
  if (!targetServer) {
    app.error('[ntfy] No se pudo determinar el servidor objetivo');
    app.error(`[ntfy] Servidores disponibles: ${JSON.stringify(config.servers?.map(s => s.id))}`);
    app.error(`[ntfy] Servidor activo configurado: ${config.activeServerId}`);
    throw new Error('No hay servidor ntfy configurado o activo');
  }
  
  const targetTopic = topic || config.topic;
  const currentPath = path || 'unknown_path';
  
  // --- LÓGICA DE FILTRADO DE DUPLICADOS (v0.0.5) ---
  if (config.filterDuplicates) {
    const now = Date.now();
    const intervalMs = (config.minIntervalMinutes || 5) * 60 * 1000;
    const lastTime = lastNotificationTime[currentPath] || 0;
    
    if (now - lastTime < intervalMs) {
      const secondsAgo = Math.floor((now - lastTime) / 1000);
      app.debug(`[ntfy] Notificación filtrada (spam): ${currentPath}. Último envío hace ${secondsAgo}s. Intervalo mínimo: ${config.minIntervalMinutes}m`);
      return; // Salir silenciosamente, no se envía nada
    }
    
    // Actualizar la última vez que se envió una notificación para este path
    lastNotificationTime[currentPath] = now;
  }
  // ----------------------------------------
  
  let fullUrl = targetServer.url.trim();
  if (!fullUrl.startsWith('http')) {
    fullUrl = 'https://' + fullUrl;
  }
  
  // CORREGIDO: Expresión regular válida y añadir el topic a la ruta
  fullUrl = fullUrl.replace(/\/$/, '') + '/' + encodeURIComponent(targetTopic);
  
  app.debug(`[ntfy] Enviando a servidor: ${targetServer.name} (${targetServer.id})`);
  app.debug(`[ntfy] URL: ${fullUrl}`);
  
  const body = {
    message: message || '',
    title: title || 'SignalK Alert'
  };
  
  const signalKState = state || (value && value.state) || 'normal';
  const priorityMap = targetServer.priorityMap || DEFAULT_STATE_PRIORITY_MAP;
  const ntfyPriority = priorityMap[signalKState] !== undefined ? priorityMap[signalKState] : 3;
  
  body.priority = ntfyPriority;
  app.debug(`[ntfy] Estado SignalK: '${signalKState}' -> prioridad ntfy: ${ntfyPriority}`);
  
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
          label: action.label,
          url: actionUrl,
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: `${action.message}, actionId:${actionId}`
        };
      }
      return null;
    }).filter(a => a);
  }
  
  const headers = { 'Content-Type': 'application/json' };
  if (targetServer.token && typeof targetServer.token === 'string' && targetServer.token.trim() !== '') {
    headers['Authorization'] = `Bearer ${targetServer.token.trim()}`;
    app.debug('[ntfy] Usando token de autenticación (Bearer)');
  } else {
    app.debug('[ntfy] AVISO: No se encontró token en la configuración de este servidor.');
  }
  
  app.debug(`[ntfy] Body a enviar:`, JSON.stringify(body, null, 2));
  
  try {
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    
    if (!res.ok) {
      const text = await res.text();
      app.error(`[ntfy] Error HTTP ${res.status}: ${res.statusText} - Respuesta del servidor: ${text}`);
      throw new Error(`HTTP ${res.status}: ${res.statusText} - ${text}`);
    }
    
    app.debug('[ntfy] Notificación enviada correctamente (2xx)');
  } catch (error) {
    app.error(`[ntfy] Excepción en fetch: ${error.message}`);
    throw error;
  }
}

module.exports = { sendNotification };
