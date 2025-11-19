// sender.js
const fetch = require('node-fetch');

/**
 * Envía una notificación a ntfy.
 */
async function sendNotification(app, config, opts) {
  const { message, title, actions, topic, server } = opts; // ← 'server' en lugar de 'serverId'
  
  //  Determinar qué servidor usar (lógica corregida)
  const targetServer = server || config.servers.find(s => s.id === config.activeServerId);
  
  if (!targetServer) {
    app.error('[ntfy] No se pudo determinar el servidor objetivo');
    app.error(`[ntfy] Servidores disponibles: ${JSON.stringify(config.servers?.map(s => s.id))}`);
    app.error(`[ntfy] Servidor activo: ${config.activeServerId}`);
    throw new Error('No hay servidor ntfy configurado o activo');
  }
  
  const targetTopic = topic || config.topic;
  let fullUrl = targetServer.url.trim();
  
  // Asegurar que tenga el protocolo
  if (!fullUrl.startsWith('http')) {
    fullUrl = 'https://' + fullUrl;
  }
  
  // Eliminar slash final si existe y añadir el endpoint correcto
  fullUrl = fullUrl.replace(/\/$/, '') + '/';
  
  app.debug(`[ntfy] Enviando a servidor: ${targetServer.name} (${targetServer.id})`);
  app.debug(`[ntfy] URL: ${fullUrl}`);
  app.debug(`[ntfy] Topic: ${targetTopic}`);

  const body = {
    topic: targetTopic,
    message: message || '',
    title: title
  };

  //  CONFIGURACIÓN DE ACCIONES
  if (actions && Array.isArray(actions)) {
    body.actions = actions.map(action => {
      if (action.action === 'broadcast') {
        const actionId = action.actionId || `action_${Date.now()}`;
        
        //USAR EL SERVIDOR ACTIVO PARA LAS ACCIONES
        let actionUrl = targetServer.url.trim(); // ← Usar targetServer, no config.ntfyUrl
        
        // Determinar protocolo automáticamente
        if (actionUrl.includes('ntfy.sh')) {
          actionUrl = actionUrl.replace(/^http:/, 'https:');
          if (!actionUrl.startsWith('http')) {
            actionUrl = 'https://' + actionUrl;
          }
        } else if (!actionUrl.startsWith('http')) {
          actionUrl = 'http://' + actionUrl;
        }
        
        // Siempre usar el topic de respuestas configurado
        actionUrl = actionUrl.replace(/\/$/, '') + `/${encodeURIComponent(config.responsesTopic)}`;
        
        return {
          action: "http",
          label: action.label,
          url: actionUrl,
          method: "POST",
          headers: {
            "Content-Type": "text/plain"
          },
          body: `${action.message}, actionId:${actionId}`
        };
      }
      return null;
    }).filter(a => a);
  }

  // HEADERS CON TOKEN DEL SERVIDOR CORRECTO
  const headers = { 'Content-Type': 'application/json' };
  if (targetServer.token) { // ← Usar token del servidor específico
    headers['Authorization'] = `Bearer ${targetServer.token}`;
    app.debug('[ntfy] Usando token de autenticación');
  }

  app.debug(`[ntfy] Body:`, JSON.stringify(body, null, 2));
  
  try {
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${res.statusText} - ${text}`);
    }
    
    app.debug('[ntfy] Notificación enviada correctamente');
    
  } catch (error) {
    app.error(`[ntfy] Error en fetch: ${error.message}`);
    throw error;
  }
}

module.exports = { sendNotification };
