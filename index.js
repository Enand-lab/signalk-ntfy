// Punto de entrada del plugin signalk-ntfy
const { sendNotification } = require('./sender');
const { startListener, stopListener } = require('./listener');
const { registerApi } = require('./api');

let plugin = null;
let currentApp = null;
let currentConfig = {};
let listenerInstance = null;
let unsubscribes = [];

//  Función para determinar servidor activo
function getActiveServer(config) {
  //  PRIMERO: Ver si hay un servidor que ya estaba como default
  const defaultServer = config.servers.find(s => s.isDefault);
  if (defaultServer) {
    currentApp.debug(`[ntfy] Usando servidor default persistente: ${defaultServer.id}`);
    return defaultServer.id;
  }
  
  //  SEGUNDO: Si no hay default, usar el primero
  if (config.servers.length > 0) {
    currentApp.debug(`[ntfy] No hay default persistente. Usando: ${config.servers[0].id}`);
    return config.servers[0].id;
  }
  
  //  TERCERO: Fallback
  currentApp.error('[ntfy] No hay servidores configurados');
  return 'principal';
}

//  Publicar estado del servidor en SignalK
function publishServerStatus(app, config) {
  const activeServer = config.servers.find(s => s.id === config.activeServerId);
  
  if (!activeServer) return;
  
  //  SOLO el ID como string simple
  app.handleMessage('signalk-ntfy', {
    updates: [{
      values: [{
        path: 'communications.ntfy.settings.activeServer',
        value: config.activeServerId  // ← Solo el string
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
    description: 'Envía notificaciones de SignalK a ntfy.sh',
    
    // Inicio del plugin
    start: (settings, restartPlugin) => {
      //  DETECTAR CAMBIO DE SERVIDOR PARA CAMBIOS VÍA UI
      const oldServerId = currentConfig.activeServerId;
      
      currentConfig = settings || {};
      
      //  Inicializar servidores si no existen
      if (!currentConfig.servers || !Array.isArray(currentConfig.servers)) {
        currentConfig.servers = [
          {
            id: 'default',
            name: 'Servidor Principal',
            url: currentConfig.ntfyUrl || 'https://ntfy.sh',
            token: currentConfig.token,
            isDefault: true
          }
        ];
      }
      
      // Comprobar si hay servidores, sino detener el plugin:
      if (!currentConfig.servers || currentConfig.servers.length === 0) {
        currentApp.error('[ntfy] No hay servidores configurados. Plugin deshabilitado.');
        return;
      }

      // Validar que todos los IDs sean únicos
      const serverIds = currentConfig.servers.map(s => s.id);
      const uniqueIds = new Set(serverIds);
      if (serverIds.length !== uniqueIds.size) {
        currentApp.error('[ntfy] Hay IDs de servidor duplicados. Corrige la configuración.');
      }
      
      // Determinar servidor activo
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
        
        // Detener y reiniciar listeners
        stopListener(listenerInstance);
        
        if (currentConfig.listenForCommands) {
          setTimeout(() => {
            listenerInstance = startListener(currentApp, currentConfig);
            currentApp.debug('[ntfy] ✅ Listeners reconectados (vía UI)');
          }, 1000);
        }
      }
      
      currentApp.debug('[ntfy] Iniciando plugin...');
      
      if (!currentConfig.enabled) {
        currentApp.debug('[ntfy] Plugin deshabilitado en configuración.');
        return;
      }

      // Publicar estado del servidor
      publishServerStatus(currentApp, currentConfig);

      // Normalizar niveles
      currentConfig.levels = Array.isArray(currentConfig.levels) && currentConfig.levels.length > 0
        ? currentConfig.levels
        : ['alert'];

      // Validar configuración mínima (ahora con servidores)
      if (!activeServer.url || !currentConfig.topic) {
        currentApp.error('[ntfy] Configuración incompleta: URL del servidor y topic son obligatorios');
        return;
      }

      //Validar configuración de listener
      if (currentConfig.listenForCommands) {
        if (!currentConfig.responsesTopic || !currentConfig.commandsTopic) {
          currentApp.error('[ntfy] listenForCommands activado pero falta configurar responsesTopic o commandsTopic');
          currentConfig.listenForCommands = false;
        }
      }

      currentApp.debug(`[ntfy] Servidor activo: ${activeServer.url}, Topic: ${currentConfig.topic}`);

      // Suscripción a notificaciones de SignalK
      const subscription = {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'notifications.*',
            period: 1000
          }
        ]
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

              let title = v.value.title || 'SignalK Alert';
              const message = v.value.message || 'Sin mensaje';

              if (Array.isArray(v.value.method) && v.value.method.length === 0) {
                title += ' (Silenciada)';
              }

              //  Enviar notificación con configuración actual
              sendNotification(currentApp, currentConfig, { 
                message, 
                title, 
                state: v.value.state  // Envio el tipo de notificación
              })
              .catch(err => {
                currentApp.error(`[ntfy] Error al enviar notificación: ${err.message}`);
              });
            });
          });
        }
      );

      // Iniciar escucha de comandos/respuestas si está activado
      if (currentConfig.listenForCommands) {
        listenerInstance = startListener(currentApp, currentConfig);
        currentApp.debug('[ntfy] Listener de comandos iniciado');
      }

      // Intervalo para publicar estado periódicamente
      const statusInterval = setInterval(() => {
        publishServerStatus(currentApp, currentConfig);
      }, 30000);

      // Guardar referencia para limpiar luego
      unsubscribes.push(() => clearInterval(statusInterval));

      // REFERENCIA ROBUSTA PARA RECONEXIÓN (ALMACENAR EN APP)
      app.signalkNtfyPlugin = {
        listenerInstance: listenerInstance,
        config: currentConfig,
        reconnectListeners: function() {
          currentApp.debug('[ntfy] 🔄 Ejecutando reconexión de listeners...');
          
          // 1. Detener listeners actuales
          if (this.listenerInstance) {
            stopListener(this.listenerInstance);
            currentApp.debug('[ntfy] Listeners anteriores detenidos');
          }
          
          // 2. Reiniciar solo si está activada la escucha
          if (this.config.listenForCommands) {
            setTimeout(() => {
              this.listenerInstance = startListener(currentApp, this.config);
              currentApp.debug('[ntfy] ✅ Listeners reconectados exitosamente');
              
              // Debug adicional
              const activeServer = this.config.servers.find(s => s.id === this.config.activeServerId);
              currentApp.debug(`[ntfy] Servidor activo listeners: ${activeServer?.url}`);
              currentApp.debug(`[ntfy] Topics: ${this.config.commandsTopic}/${this.config.responsesTopic}`);
            }, 1000);
          } else {
            currentApp.debug('[ntfy] ListenForCommands desactivado, no se reinician listeners');
          }
        }
      };

      currentApp.debug('[ntfy] Referencia de reconexión almacenada en app');
      currentApp.debug('[ntfy] Plugin iniciado correctamente');
    },

    // Detener el plugin
    stop: () => {
      currentApp.debug('[ntfy] Deteniendo plugin...');
      
      unsubscribes.forEach(unsub => unsub());
      unsubscribes = [];

      if (listenerInstance) {
        stopListener(listenerInstance);
        listenerInstance = null;
      }
      
      // LIMPIAR REFERENCIA
      if (currentApp.signalkNtfyPlugin) {
        currentApp.signalkNtfyPlugin.listenerInstance = null;
      }
      
      currentApp.debug('[ntfy] Plugin detenido');
    },

    // Esquema de configuración
    schema: require('./plugin-config.schema.json'),

    // registerWithRouter
    registerWithRouter: function(router) {
      const { registerApi } = require('./api');
      const { sendNotification } = require('./sender');
      
      registerApi(currentApp, currentConfig, sendNotification, router);
      currentApp.debug('[ntfy] API registrada correctamente');
    }
  };

  //  OpenAPI documentation
  const openapi = require('./openApi.json');
  plugin.getOpenApi = () => openapi;

  return plugin;
};
