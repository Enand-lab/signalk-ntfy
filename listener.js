// listener.js
// Escucha topics de ntfy (respuestas y comandos) mediante WebSocket
// Soporta autenticación con token en ntfy.sh y en instancias locales

const WebSocket = require('ws');

/**
 * Construye la URL del WebSocket con autenticación (si aplica)
 */
function buildWsUrl(ntfyUrl, topic, token) {
  // VALIDACIÓN ROBUSTA
  if (!ntfyUrl) {
    throw new Error('ntfyUrl no está definido');
  }
  if (!topic) {
    throw new Error('topic no está definido');
  }
  
  // Eliminar espacios al inicio y al final
  const baseUrl = ntfyUrl.toString().trim().replace(/\/$/, '');
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `/${encodeURIComponent(topic)}/ws`;

  if (token) {
    const authHeader = `Authorization: Bearer ${token.toString().trim()}`;
    const authB64 = Buffer.from(authHeader).toString('base64');
    return `${wsUrl}?auth=${encodeURIComponent(authB64)}`;
  }
  return wsUrl;
}

/**
 * Maneja un mensaje entrante y lo publica en SignalK
 */
function handleIncomingMessage(app, config, topicType, rawData) {
  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch (e) {
    parsed = { rawMessage: rawData };
  }

  //  Path único sin timestamp
  const path = topicType === 'response' 
    ? 'communications.ntfy.responses'
    : 'communications.ntfy.commands';

  app.handleMessage('signalk-ntfy', {
    updates: [{
      values: [{
        path: path,
        value: {
          ...parsed,
          receivedAt: new Date().toISOString(),
          sourceTopic: topicType === 'response' ? config.responsesTopic : config.commandsTopic
        }
      }]
    }]
  });
  
  app.debug(`[ntfy] Mensaje publicado en ${path}`);
}

/**
 * Inicia los listeners de WebSocket
 */
function startListener(app, config) {
  // USAR CONFIGURACIÓN MULTI-SERVIDOR
  const activeServer = config.servers.find(s => s.id === config.activeServerId);
  if (!activeServer) {
    app.error('[ntfy] No hay servidor activo para el listener');
    return { stop: () => {} };
  }
  
  const ntfyUrl = activeServer.url;
  const token = activeServer.token;
  
  app.debug('[ntfy] Listener usando servidor:', ntfyUrl);
    
  if (!config.responsesTopic && !config.commandsTopic) {
    app.debug('[ntfy] Listener no iniciado: no hay topics definidos.');
    return { stop: () => {} };
  }
  
  const sockets = [];

  function connect(topic, topicType) {
    //  USAR VARIABLES DEL SERVIDOR ACTIVO
    const url = buildWsUrl(ntfyUrl, topic, token);
    const ws = new WebSocket(url);

    ws.on('open', () => {
      app.debug(`[ntfy] WebSocket conectado a ${topicType}: ${topic}`);
    });
    // MONITOR DE VIDA DEL WEBSOCKET
    let lastMessageTime = Date.now();
    const heartbeatInterval = setInterval(() => {
        if (Date.now() - lastMessageTime > 60000) { // 60 segundos sin mensajes
            app.debug(`[ntfy] ⚠️ WebSocket inactivo por 60s. Forzando reconexión...`);
            ws.close();
            clearInterval(heartbeatInterval);
        }
    }, 10000); // chequear cada 10s

    ws.on('message', (data) => {
        const msg = data.toString();
        app.debug(`[ntfy] RAW Mensaje recibido (${topicType}): ${msg}`);
        
        // ACTUALIZAR INMEDIATAMENTE: cualquier mensaje = conexión viva-- keepalive ntfy.sh
        lastMessageTime = Date.now();
        
        try {
            const json = JSON.parse(msg);
            
            //  FILTRAR EVENTOS DE CONEXIÓN
            if (json.event === 'open' || json.event === 'keepalive') {
            app.debug(`[ntfy] Evento WebSocket de conexión: ${json.event}`);
            return;
            }
            
            //  PROCESAR MENSAJES CON CONTENIDO
            if (json.message || json.title || (json.event === 'message' && json.id)) {
            app.debug(`[ntfy] Procesando mensaje ${topicType}:`, JSON.stringify(json, null, 2));
            
            const payload = {
                id: json.id || `msg_${Date.now()}`,
                time: json.time || Math.floor(Date.now() / 1000),
                topic: json.topic || topic,
                message: json.message || '',
                title: json.title,
                tags: json.tags,
                priority: json.priority,
                event: json.event
            };
            
            handleIncomingMessage(app, config, topicType, JSON.stringify(payload));
            } else {
            app.debug(`[ntfy] Mensaje sin contenido útil, ignorado`);
            }
            
        } catch (e) {
            //  PROCESAR MENSAJES DE TEXTO PLANO
            app.debug(`[ntfy] Mensaje texto plano: ${msg}`);
            if (msg && msg.trim().length > 0) {
            const payload = {
                id: `text_${Date.now()}`,
                time: Math.floor(Date.now() / 1000),
                topic: topic,
                message: msg.trim(),
                receivedAt: new Date().toISOString()
            };
            handleIncomingMessage(app, config, topicType, JSON.stringify(payload));
            }
        }
    });

    ws.on('error', (err) => {
      app.error(`[ntfy] WebSocket error (${topicType} ${topic}): ${err.message}`);
    });

    ws.on('close', () => {
      app.debug(`[ntfy] WebSocket cerrado (${topicType} ${topic}). Reintentando en 5s...`);
      setTimeout(() => connect(topic, topicType), 5000);
    });

    sockets.push(ws);
  }

  if (config.responsesTopic) {
    connect(config.responsesTopic, 'response');
  }
  if (config.commandsTopic) {
    connect(config.commandsTopic, 'command');
  }

  return {
    stop: () => {
      sockets.forEach(ws => {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      });
    }
  };
}

function stopListener(instance) {
  if (instance && typeof instance.stop === 'function') {
    instance.stop();
  }
}

module.exports = { startListener, stopListener };
