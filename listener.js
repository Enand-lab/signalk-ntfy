// listener.js
// Listener WebSocket unificado para ntfy
// Basado en las mejores prácticas de la app oficial de Android
const WebSocket = require('ws');

/**
 * Construye la URL del WebSocket con autenticación
 */
function buildWsUrl(ntfyUrl, topics, token) {
  if (!ntfyUrl || !topics) {
    throw new Error('ntfyUrl y topics son obligatorios');
  }
  const baseUrl = ntfyUrl.toString().trim().replace(/\/$/, '');
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `/${encodeURIComponent(topics)}/ws`;
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
function handleIncomingMessage(app, config, rawData) {
  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch (e) {
    parsed = { rawMessage: rawData };
  }

  // Determinar tipo de mensaje por topic
  let topicType = 'unknown';
  if (parsed.topic === config.commandsTopic) {
    topicType = 'command';
  } else if (parsed.topic === config.responsesTopic) {
    topicType = 'response';
  }

  const path = topicType === 'response'
    ? 'communications.ntfy.responses'
    : topicType === 'command'
      ? 'communications.ntfy.commands'
      : null;

  if (path) {
    app.handleMessage('signalk-ntfy', {
      updates: [{
        values: [{
          path,
          value: {
            ...parsed,
            receivedAt: new Date().toISOString(),
            sourceTopic: parsed.topic
          }
        }]
      }]
    });
    app.debug(`[ntfy] Mensaje publicado en ${path}`);
  } else {
    app.debug(`[ntfy] Mensaje ignorado: topic no configurado (${parsed.topic})`);
  }
}

/**
 * Inicia un listener WebSocket unificado
 */
function startListener(app, config) {
  const activeServer = config.servers.find(s => s.id === config.activeServerId);
  if (!activeServer) {
    app.error('[ntfy] No hay servidor activo para el listener');
    return { stop: () => {} };
  }

  // Recopilar topics validos
  const topics = [];
  if (config.commandsTopic) topics.push(config.commandsTopic);
  if (config.responsesTopic) topics.push(config.responsesTopic);

  if (topics.length === 0) {
    app.debug('[ntfy] Listener no iniciado: no hay topics definidos.');
    return { stop: () => {} };
  }

  const combinedTopics = topics.join(',');
  const ntfyUrl = activeServer.url;
  const token = activeServer.token;
  let ws = null;
  let pingTimer = null;
  let heartbeatTimer = null;
  let reconnectAttempts = 0;

  const RETRY_SECONDS = [5, 10, 15, 20, 30, 45, 60, 120];
  const INACTIVITY_TIMEOUT = 600000; // 5 minutos

  function connect() {
    const url = buildWsUrl(ntfyUrl, combinedTopics, token);
    ws = new WebSocket(url);

    ws.on('open', () => {
      app.debug(`[ntfy] ✅ WebSocket conectado a: ${combinedTopics}`);
      reconnectAttempts = 0; // Reset al conectar

      // ✅ Enviar ping cada 45s para mantener NAT viva
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 45000);
    });

    let lastActivity = Date.now();
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        app.debug('[ntfy] ⚠️ WebSocket inactivo por 300s. Forzando reconexión...');
        ws.close();
      }
    }, 30000);

    ws.on('message', (data) => {
      lastActivity = Date.now(); // ✅ Cualquier mensaje = actividad
      const msg = data.toString();
      app.debug(`[ntfy] 📥 Mensaje recibido: ${msg}`);

      try {
        const json = JSON.parse(msg);
        if (json.event === 'open' || json.event === 'keepalive') {
          app.debug(`[ntfy] 🔄 Evento de conexión: ${json.event}`);
          return;
        }
        if (json.message || json.title || json.event === 'message') {
          handleIncomingMessage(app, config, msg);
        }
      } catch (e) {
        // Mensaje de texto plano
        if (msg.trim()) {
          const fakeJson = {
            topic: topics[0], // Asumir primer topic
            message: msg.trim(),
            event: 'message',
            id: `text_${Date.now()}`,
            time: Math.floor(Date.now() / 1000)
          };
          handleIncomingMessage(app, config, JSON.stringify(fakeJson));
        }
      }
    });

    ws.on('close', () => {
      app.debug(`[ntfy] 🔌 WebSocket cerrado`);
      if (pingTimer) clearInterval(pingTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      app.error(`[ntfy] ❌ WebSocket error: ${err.message}`);
    });
  }

  function scheduleReconnect() {
    const delaySec = RETRY_SECONDS[Math.min(reconnectAttempts, RETRY_SECONDS.length - 1)];
    const delayMs = delaySec * 1000;
    app.debug(`[ntfy] 🔄 Reintentando en ${delaySec}s (intento ${reconnectAttempts + 1})`);
    setTimeout(() => {
      reconnectAttempts++;
      connect();
    }, delayMs);
  }

  // Iniciar conexión
  connect();

  return {
    stop: () => {
      if (ws) ws.close();
      if (pingTimer) clearInterval(pingTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  };
}

function stopListener(instance) {
  if (instance && typeof instance.stop === 'function') {
    instance.stop();
  }
}

module.exports = { startListener, stopListener };
