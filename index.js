// Punto de entrada del plugin signalk-ntfy
const { sendNotification } = require('./sender');
const { startListener, stopListener } = require('./listener');
const { registerApi } = require('./api');

let plugin = null;
let currentApp = null;
let currentConfig = {};
let listenerInstance = null;
let unsubscribes = [];

// --- Filtro anti-duplicados (filterDuplicates / minIntervalMinutes) ---
// Registro en memoria del ultimo estado enviado por path. Las entradas de mas de
// 24 h se purgan solas para que el mapa no crezca sin limite.
const FILTER_RETENTION_MS = 24 * 60 * 60 * 1000;
// Orden de severidad de los estados de notificacion de Signal K.
const STATE_SEVERITY = { normal: 0, alert: 1, warn: 2, alarm: 3, emergency: 4 };
let lastSentByPath = new Map();

// Intervalo minimo efectivo en milisegundos (el esquema exige >= 1 minuto; 5 por defecto).
function minIntervalMs(config) {
  const minutes = Number(config.minIntervalMinutes);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 5) * 60 * 1000;
}

// Descarta las entradas caducadas (mas de 24 h sin enviar por ese path).
function purgeLastSent(now) {
  for (const [path, entry] of lastSentByPath) {
    if (now - entry.timestamp > FILTER_RETENTION_MS) lastSentByPath.delete(path);
  }
}

// Decide si un delta merece notificacion.
// - Filtro apagado (valor por defecto): siempre, comportamiento historico intacto.
// - Filtro encendido: se envia si el estado cambia respecto al ultimo enviado, si
//   ha vencido el intervalo minimo, o si la severidad escala. Una escalada NUNCA
//   se silencia aunque el path este en cooldown (seguridad a bordo).
function shouldSendForPath(path, state, config, now) {
  if (!config.filterDuplicates) return true;
  purgeLastSent(now);
  const last = lastSentByPath.get(path);
  if (!last) return true;
  const severity = STATE_SEVERITY[state] !== undefined ? STATE_SEVERITY[state] : 0;
  const lastSeverity = STATE_SEVERITY[last.state] !== undefined ? STATE_SEVERITY[last.state] : 0;
  if (severity > lastSeverity) return true;   // escalada de severidad: siempre pasa
  if (state !== last.state) return true;      // cambio de estado (incluida desescalada)
  return now - last.timestamp >= minIntervalMs(config);
}

// Marca el envio de un path y devuelve la entrada anterior, para poder deshacerla
// si el envio falla y no queremos silenciar el reintento.
function markSent(path, state, now) {
  const previous = lastSentByPath.get(path);
  lastSentByPath.set(path, { state, timestamp: now });
  return previous;
}

function rollbackSent(path, previous) {
  if (previous) lastSentByPath.set(path, previous);
  else lastSentByPath.delete(path);
}

// Fallback title for producers that send no `title` in the notification value
// (Signal K notification values carry state/method/message only, so this is
// the common case). Builds "STATE: Path Words" from the notification path,
// optionally prefixed with a user-defined label (e.g. the vessel name).
function deriveTitle(path, state, config) {
  const words = String(path || '')
    .replace(/^notifications\./, '')
    .split('.')
    .filter(Boolean)
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ');
  const stateLabel = state ? String(state).toUpperCase() : '';
  let title = stateLabel && words ? `${stateLabel}: ${words}`
    : (stateLabel || words || 'SignalK Alert');
  const prefix = typeof config.titlePrefix === 'string' ? config.titlePrefix.trim() : '';
  if (prefix) title = `${prefix} · ${title}`;
  return title;
}

// Función para determinar servidor activo
function getActiveServer(config) {
  const defaultServer = config.servers.find(s => s.isDefault);
  if (defaultServer) {
    currentApp.debug(`[ntfy] Usando servidor default persistente: ${defaultServer.id}`);
    return defaultServer.id;
  }
  if (config.servers.length > 0) {
    currentApp.debug(`[ntfy] No hay default persistente. Usando: ${config.servers[0].id}`);
    return config.servers[0].id;
  }
  currentApp.error('[ntfy] No hay servidores configurados');
  return 'principal';
}

// Publicar estado del servidor en SignalK
function publishServerStatus(app, config) {
  const activeServer = config.servers.find(s => s.id === config.activeServerId);
  if (!activeServer) return;
  
  app.handleMessage('signalk-ntfy', {
    updates: [{
      values: [{
        path: 'communications.ntfy.settings.activeServer',
        value: config.activeServerId
      }]
    }]
  });
  app.debug(`[ntfy] Estado publicado: ${config.activeServerId}`);
}

module.exports = function(app) {
  if (plugin) return plugin;
  
  currentApp = app;
  unsubscribes = [];
  listenerInstance = null;
  
  plugin = {
    id: 'signalk-ntfy',
    name: 'ntfy Notifications',
    description: 'Sends Signal K notifications to ntfy',
    
    start: (settings, restartPlugin) => {
      const oldServerId = currentConfig.activeServerId;
      currentConfig = settings || {};
      
      // Al arrancar o reconfigurar, el registro del filtro empieza limpio.
      lastSentByPath = new Map();
      
      if (!currentConfig.servers || !Array.isArray(currentConfig.servers)) {
        currentConfig.servers = [{
          id: 'default',
          name: 'Main server',
          url: currentConfig.ntfyUrl || 'https://ntfy.sh',
          token: currentConfig.token,
          isDefault: true
        }];
      }
      
      if (!currentConfig.servers || currentConfig.servers.length === 0) {
        currentApp.error('[ntfy] No hay servidores configurados. Plugin deshabilitado.');
        return;
      }
      
      const serverIds = currentConfig.servers.map(s => s.id);
      const uniqueIds = new Set(serverIds);
      if (serverIds.length !== uniqueIds.size) {
        currentApp.error('[ntfy] Hay IDs de servidor duplicados. Corrige la configuración.');
      }
      
      currentConfig.activeServerId = getActiveServer(currentConfig);
      const activeServer = currentConfig.servers.find(s => s.id === currentConfig.activeServerId);
      if (!activeServer) {
        currentApp.error('[ntfy] No se pudo determinar un servidor activo válido');
        return;
      }
      
      const newServerId = currentConfig.activeServerId;
      
      // Si cambió el servidor Y ya estábamos ejecutando (no es primera vez)
      if (listenerInstance && oldServerId && newServerId && oldServerId !== newServerId) {
        currentApp.debug(`[ntfy] Servidor cambió vía UI: ${oldServerId} → ${newServerId}`);
        
        stopListener(listenerInstance);
        listenerInstance = null; // Limpiar referencia
        
        if (currentConfig.listenForCommands) {
          setTimeout(() => {
            listenerInstance = startListener(currentApp, currentConfig);
            currentApp.debug('[ntfy] ✅ Listeners reconectados (vía UI)');
          }, 1000);
        }
        
        // ¡CRUCIAL! Salir de la función para evitar que el código continúe 
        // y ejecute el bloque de inicio normal de abajo, creando un segundo listener.
        return; 
      }
      
      currentApp.debug('[ntfy] Iniciando plugin...');
      if (!currentConfig.enabled) {
        currentApp.debug('[ntfy] Plugin deshabilitado en configuración.');
        return;
      }
      
      publishServerStatus(currentApp, currentConfig);
      
      currentConfig.levels = Array.isArray(currentConfig.levels) && currentConfig.levels.length > 0
      ? currentConfig.levels
      : ['alert'];
      
      if (!activeServer.url || !currentConfig.topic) {
        currentApp.error('[ntfy] Configuración incompleta: URL del servidor y topic son obligatorios');
        return;
      }
      
      if (currentConfig.listenForCommands) {
        if (!currentConfig.responsesTopic || !currentConfig.commandsTopic) {
          currentApp.error('[ntfy] listenForCommands activado pero falta configurar responsesTopic o commandsTopic');
          currentConfig.listenForCommands = false;
        }
      }
      
      currentApp.debug(`[ntfy] Servidor activo: ${activeServer.url}, Topic: ${currentConfig.topic}`);
      
      const subscription = {
        context: 'vessels.self',
        subscribe: [{ path: 'notifications.*', period: 1000 }]
      };
      
      currentApp.subscriptionmanager.subscribe(
        subscription,
        unsubscribes,
        (err) => {
          currentApp.error(`[ntfy] Error en suscripción a notificaciones: ${err.message}`);
        },
        (delta) => {
          if (!delta?.updates) return;
          delta.updates.forEach(update => {
            if (!update?.values) return;
            update.values.forEach(v => {
              if (!v?.path || !v.value || !v.value.state) return;
              if (!currentConfig.levels.includes(v.value.state)) return;
              
              // Filtro anti-duplicados: se evalua por path y solo si esta activado.
              const now = Date.now();
              if (!shouldSendForPath(v.path, v.value.state, currentConfig, now)) {
                currentApp.debug(`[ntfy] Duplicado silenciado: ${v.path} (${v.value.state})`);
                return;
              }
              // Se marca antes del POST para que una rafaga de deltas no lance varios
              // envios en vuelo; si el envio falla se deshace la marca (ver catch).
              const previousSent = currentConfig.filterDuplicates
                ? markSent(v.path, v.value.state, now)
                : undefined;
              
              let title = v.value.title || deriveTitle(v.path, v.value.state, currentConfig);
              const message = v.value.message || 'No message';
              if (Array.isArray(v.value.method) && v.value.method.length === 0) {
                title += ' (Silenced)';
              }
              
              // Enviar notificación con configuración actual (incluyendo path para el filtro)
              sendNotification(currentApp, currentConfig, { 
                message, 
                title, 
                state: v.value.state,
                path: v.path 
              }).catch(err => {
                // Si el envio falla, el path vuelve a su marca anterior: no silenciamos
                // el siguiente intento por un fallo de red.
                if (currentConfig.filterDuplicates) rollbackSent(v.path, previousSent);
                currentApp.error(`[ntfy] Error al enviar notificación: ${err.message}`);
              });
            });
          });
        }
      );
      
      if (currentConfig.listenForCommands) {
        listenerInstance = startListener(currentApp, currentConfig);
        currentApp.debug('[ntfy] Listener de comandos iniciado');
      }
      
      const statusInterval = setInterval(() => {
        publishServerStatus(currentApp, currentConfig);
      }, 30000);
      
      unsubscribes.push(() => clearInterval(statusInterval));
      
      app.signalkNtfyPlugin = {
        listenerInstance: listenerInstance,
        config: currentConfig,
        reconnectListeners: function() {
          currentApp.debug('[ntfy] 🔄 Ejecutando reconexión de listeners...');
          if (this.listenerInstance) {
            stopListener(this.listenerInstance);
            currentApp.debug('[ntfy] Listeners anteriores detenidos');
          }
          if (this.config.listenForCommands) {
            setTimeout(() => {
              this.listenerInstance = startListener(currentApp, this.config);
              currentApp.debug('[ntfy] ✅ Listeners reconectados exitosamente');
              const activeSrv = this.config.servers.find(s => s.id === this.config.activeServerId);
              currentApp.debug(`[ntfy] Servidor activo listeners: ${activeSrv?.url}`);
              currentApp.debug(`[ntfy] Topics: ${this.config.commandsTopic}/${this.config.responsesTopic}`);
            }, 1000);
          }
        }
      };
      currentApp.debug('[ntfy] Referencia de reconexión almacenada en app');
      currentApp.debug('[ntfy] Plugin iniciado correctamente');
    },
    
    stop: () => {
      currentApp.debug('[ntfy] Deteniendo plugin...');
      unsubscribes.forEach(unsub => unsub());
      unsubscribes = [];
      if (listenerInstance) {
        stopListener(listenerInstance);
        listenerInstance = null;
      }
      if (currentApp.signalkNtfyPlugin) {
        currentApp.signalkNtfyPlugin.listenerInstance = null;
      }
      currentApp.debug('[ntfy] Plugin detenido');
    },
    
    schema: require('./plugin-config.schema.json'),
    
    registerWithRouter: function(router) {
      registerApi(currentApp, currentConfig, sendNotification, router);
      currentApp.debug('[ntfy] API registrada correctamente');
    }
  };
  
  const openapi = require('./openApi.json');
  plugin.getOpenApi = () => openapi;
  
  return plugin;
};
