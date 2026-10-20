// Punto de entrada del plugin signalk-ntfy
const { sendNotification, DEFAULT_STATE_PRIORITY_MAP } = require('./sender');
const { createRetryQueue } = require('./retry');
const { startListener, stopListener } = require('./listener');
const { registerApi } = require('./api');

let plugin = null;
let currentApp = null;
let currentConfig = {};
let listenerInstance = null;
let unsubscribes = [];
let retryQueue = null;

// --- Filtro anti-duplicados (filterDuplicates / minIntervalMinutes) ---
// Registro en memoria del ultimo estado enviado por path. Las entradas de mas de
// 24 h se purgan solas para que el mapa no crezca sin limite.
const FILTER_RETENTION_MS = 24 * 60 * 60 * 1000;
// Orden de severidad de los estados de notificacion de Signal K.
const STATE_SEVERITY = { normal: 0, alert: 1, warn: 2, alarm: 3, emergency: 4 };
let lastSentByPath = new Map();
// Marca a la que hay que volver si la notificacion de un path no llega a enviarse.
// Se guarda la primera de la racha: durante los reintentos el path sigue marcado
// (asi una rafaga no lanza varios envios) y al fallar de forma definitiva se deshace.
let pendingRollback = new Map();

// --- Aviso de vuelta a la normalidad (notifyOnClear, issue #6) ---
// Paths de los que se ha encolado un aviso desde que arranco el plugin: es lo que
// permite avisar del "ya esta normal" solo de lo que se aviso antes, en vez de
// reenviar el normal de todo el barco. En memoria y con la misma caducidad que el
// filtro (24 h); al reiniciar el plugin el registro empieza vacio.
let notifiedByPath = new Map();

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

// Lo mismo para el registro de avisos (notifyOnClear).
function purgeNotified(now) {
  for (const [path, entry] of notifiedByPath) {
    if (now - entry.timestamp > FILTER_RETENTION_MS) notifiedByPath.delete(path);
  }
}

// Anota que se ha avisado de un path. Se llama al encolar, no al confirmar el
// envio: el armador prefiere que un "ya esta normal" de mas sea posible a que un
// aviso perdido por red no tenga su vuelta a la normalidad.
function markNotified(path, state, now) {
  purgeNotified(now);
  notifiedByPath.set(path, { state, timestamp: now });
}

// Consume la entrada del registro: devuelve true solo si ese path se aviso y la
// entrada sigue vigente. Borrarla evita repetir el CLEARED en cada delta normal.
function forgetNotified(path, now) {
  purgeNotified(now);
  return notifiedByPath.delete(path);
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

// Parte del path en palabras ("notifications.navigation.anchor" -> "Navigation Anchor").
// La usan tanto el titulo de una alarma como el del aviso de vuelta a la normalidad.
function pathWords(path) {
  return String(path || '')
    .replace(/^notifications\./, '')
    .split('.')
    .filter(Boolean)
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ');
}

// Fallback title for producers that send no `title` in the notification value
// (Signal K notification values carry state/method/message only, so this is
// the common case). Builds "STATE: Path Words" from the notification path,
// optionally prefixed with a user-defined label (e.g. the vessel name).
function composeTitle(stateLabel, path, config) {
  const words = pathWords(path);
  const label = stateLabel ? String(stateLabel).toUpperCase() : '';
  let title = label && words ? `${label}: ${words}`
    : (label || words || 'SignalK Alert');
  const prefix = typeof config.titlePrefix === 'string' ? config.titlePrefix.trim() : '';
  if (prefix) title = `${prefix} · ${title}`;
  return title;
}

function deriveTitle(path, state, config) {
  return composeTitle(state, path, config);
}

// --- clickUrls (issue #7) ---
// Cada entrada asocia un prefijo de path con la URL que abre el telefono al tocar
// la notificacion. Se normaliza al arrancar: prefijo con "notifications." delante
// si falta, URL sin la barra final y solo http/https. Una entrada mala se avisa y
// se ignora: una errata en la configuracion no puede dejar el barco sin avisos.
function normalizeClickUrls(list, app) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((entry, index) => {
    const rawUrl = entry && typeof entry.url === 'string' ? entry.url.trim() : '';
    const rawPrefix = entry && typeof entry.pathPrefix === 'string' ? entry.pathPrefix.trim() : '';
    if (!rawUrl) {
      app.error(`[ntfy] clickUrls[${index}]: falta la url. Entrada ignorada.`);
      return;
    }
    if (!/^https?:\/\//.test(rawUrl)) {
      app.error(`[ntfy] clickUrls[${index}]: la url "${rawUrl}" no empieza por http:// ni https://. Entrada ignorada.`);
      return;
    }
    // Prefijo vacio o "*" es el comodin: vale para cualquier path.
    let prefix = rawPrefix;
    if (prefix && prefix !== '*') {
      if (!prefix.startsWith('notifications.')) prefix = `notifications.${prefix}`;
    } else {
      prefix = '*';
    }
    out.push({ pathPrefix: prefix, url: rawUrl.replace(/\/+$/, '') });
  });
  return out;
}

// URL de click para un path: gana el prefijo mas largo que encaje por segmentos
// completos (igual al prefijo o prefijo seguido de punto); el comodin solo se usa
// si ningun prefijo concreto encaja. Sin coincidencia no se manda click.
function resolveClickUrl(path, config) {
  if (!path || !config || !Array.isArray(config.clickUrls)) return undefined;
  let best = null;
  let fallback = null;
  for (const entry of config.clickUrls) {
    if (!entry || typeof entry.url !== 'string' || !entry.url) continue;
    const prefix = typeof entry.pathPrefix === 'string' ? entry.pathPrefix : '';
    if (!prefix || prefix === '*') {
      if (!fallback) fallback = entry;
      continue;
    }
    if (path === prefix || path.startsWith(`${prefix}.`)) {
      if (!best || prefix.length > best.pathPrefix.length) best = entry;
    }
  }
  const winner = best || fallback;
  return winner ? winner.url : undefined;
}

// Aviso de vuelta a la normalidad de un path avisado: mensaje nuevo, prioridad la
// del mapa para "normal" (2 por defecto) para no romper modos de concentracion.
// Se llama con el registro y la marca del filtro ya borrados.
function enqueueCleared(path, value) {
  if (!retryQueue) return;
  let message = 'Back to normal';
  if (value && value.message) {
    if (typeof value.message === 'string' && value.message.trim()) message = value.message;
    else if (typeof value.message === 'object' && Object.keys(value.message).length > 0) message = value.message;
  }
  const activeServer = currentConfig.servers.find(s => s.id === currentConfig.activeServerId);
  const priorityMap = (activeServer && activeServer.priorityMap) || DEFAULT_STATE_PRIORITY_MAP;
  const priority = priorityMap.normal !== undefined ? priorityMap.normal : 2;
  retryQueue.enqueue({
    path,
    payload: { message, title: composeTitle('CLEARED', path, currentConfig), state: 'normal', path, priority },
    onSuccess: () => {
      currentApp.debug(`[ntfy] Aviso de vuelta a normal enviado: ${path}`);
    },
    onFailure: (err, info) => {
      currentApp.error(`[ntfy] Error al enviar aviso de vuelta a normal: ${err.message} (${info.attempts} intento(s))`);
    }
  });
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
      
      // Al arrancar o reconfigurar, los registros empiezan limpios y los
      // reintentos pendientes del arranque anterior se tiran.
      lastSentByPath = new Map();
      pendingRollback.clear();
      notifiedByPath = new Map();
      // Las URLs de click se validan aqui y no en cada aviso: lo que llega mal se
      // avisa una vez en el log al arrancar y no vuelve a molestar.
      currentConfig.clickUrls = normalizeClickUrls(currentConfig.clickUrls, currentApp);
      if (retryQueue) retryQueue.cancelAll();
      retryQueue = createRetryQueue({
        app: currentApp,
        send: (job) => sendNotification(currentApp, currentConfig, job.payload)
      });
      
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
              if (!v?.path) return;
              const path = v.path;
              const state = v.value && v.value.state ? v.value.state : null;
              // Filtro anti-duplicados: se evalua por path y solo si esta activado.
              const now = Date.now();
              
              // Vuelta a la normalidad (issue #6). Un valor null o en estado normal
              // NUNCA sigue el camino normal, ni siquiera con "normal" en levels:
              // o genera un CLEARED de un path que se aviso antes, o no sale nada.
              if (!state || state === 'normal') {
                if (currentConfig.notifyOnClear && forgetNotified(path, now)) {
                  // La alarma esta resuelta: se borran la marca del filtro y el
                  // rollback pendiente para que una alarma nueva entre de inmediato.
                  lastSentByPath.delete(path);
                  pendingRollback.delete(path);
                  enqueueCleared(path, v.value);
                }
                return;
              }
              
              if (!currentConfig.levels.includes(state)) return;
              
              if (!shouldSendForPath(path, state, currentConfig, now)) {
                currentApp.debug(`[ntfy] Duplicado silenciado: ${path} (${state})`);
                return;
              }
              // Se marca antes del POST para que una rafaga de deltas no lance varios
              // envios en vuelo. La marca solo vale si el envio tiene exito: mientras
              // la cola reintenta el path sigue marcado, y si se agotan los intentos
              // se deshace (ver onFailure).
              const previousSent = currentConfig.filterDuplicates
                ? markSent(path, state, now)
                : undefined;
              if (currentConfig.filterDuplicates && !pendingRollback.has(path)) {
                pendingRollback.set(path, previousSent);
              }
              
              let title = v.value.title || deriveTitle(path, state, currentConfig);
              const message = v.value.message || 'No message';
              if (Array.isArray(v.value.method) && v.value.method.length === 0) {
                title += ' (Silenced)';
              }
              
              // Envio a traves de la cola de reintentos (5, 15 y 45 s): un fallo de red
              // ya no pierde el aviso, y una notificacion nueva del mismo path sustituye
              // al reintento pendiente. El POST lo hace sender.js, con timeout propio.
              if (!retryQueue) return;   // plugin detenido: no hay cola de envio
              // Solo los avisos que llegan a la cola cuentan para el CLEARED, y se
              // anotan aqui (al encolar), no al confirmar el envio.
              if (currentConfig.notifyOnClear) markNotified(path, state, now);
              retryQueue.enqueue({
                path,
                payload: { message, title, state, path, click: resolveClickUrl(path, currentConfig) },
                onSuccess: () => {
                  // Envio confirmado: la marca del filtro ya es buena.
                  if (currentConfig.filterDuplicates) {
                    lastSentByPath.set(path, { state, timestamp: Date.now() });
                    pendingRollback.delete(path);
                  }
                },
                onFailure: (err, info) => {
                  // Envio fallido de forma definitiva: el path vuelve a su marca
                  // anterior para no silenciar la siguiente notificacion.
                  if (currentConfig.filterDuplicates && pendingRollback.has(path)) {
                    rollbackSent(path, pendingRollback.get(path));
                    pendingRollback.delete(path);
                  }
                  currentApp.error(`[ntfy] Error al enviar notificación: ${err.message} (${info.attempts} intento(s))`);
                }
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
      if (retryQueue) {
        retryQueue.cancelAll();
        retryQueue = null;
      }
      pendingRollback.clear();
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
