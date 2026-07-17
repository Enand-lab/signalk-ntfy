// listener.js
const WebSocket = require('ws');

function handleIncomingMessage(app, config, rawData) {
  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch (e) {
    parsed = { rawMessage: rawData };
  }
  
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

function startListener(app, config) {
  const activeServer = config.servers.find(s => s.id === config.activeServerId);
  if (!activeServer) {
    app.error('[ntfy] No hay servidor activo para el listener');
    return { stop: () => {} };
  }
  
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
  const INACTIVITY_TIMEOUT = 600000;
  
  function connect() {
    // CORREGIDO: Expresión regular válida para eliminar slash final
    const baseUrl = ntfyUrl.toString().trim().replace(/\/$/, '');
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/${encodeURIComponent(combinedTopics)}/ws`;
    
    const wsOptions = {};
    if (token && typeof token === 'string' && token.trim() !== '') {
      wsOptions.headers = {
        'Authorization': `Bearer ${token.trim()}`
      };
      app.debug('[ntfy] WebSocket: Usando autenticación Bearer');
    } else {
      app.debug('[ntfy] WebSocket: Sin token (conexión anónima)');
    }
    
    ws = new WebSocket(wsUrl, wsOptions);
    
    ws.on('open', () => {
      app.debug(`[ntfy] ✅ WebSocket conectado a: ${combinedTopics}`);
      reconnectAttempts = 0;
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 45000);
    });
    
    let lastActivity = Date.now();
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        app.debug('[ntfy] ⚠️ WebSocket inactivo por 10min. Forzando reconexión...');
        ws.close();
      }
    }, 30000);
    
    ws.on('message', (data) => {
      lastActivity = Date.now();
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
        if (msg.trim()) {
          const fakeJson = {
            topic: topics[0],
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
