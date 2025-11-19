// api.js
const fs = require('fs');
const path = require('path');

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

function getActiveServer(config) {
  if (!config || !config.servers || !config.activeServerId) {
    return null;
  }
  return config.servers.find(s => s.id === config.activeServerId);
}

function registerApi(app, config, sendNotification, router) {
  if (!router) {
    app.error('[ntfy] Router no disponible');
    return;
  }

  router.post('/send', async (req, res) => {
    try {
      app.debug('[ntfy API] Petición recibida:', JSON.stringify(req.body));
      
      const { message, title, actions, topic } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'El campo "message" es obligatorio.' });
      }

      // usar multi-servidor
      const activeServer = getActiveServer(config);
      if (!activeServer) {
        app.error('[ntfy API] No hay servidor activo configurado');
        return res.status(500).json({ error: 'No hay servidor ntfy activo' });
      }

      app.debug(`[ntfy API] Servidor activo: ${activeServer.url}, Topic: ${topic || config.topic}`);

      // PASAR EL SERVIDOR ACTIVO A sendNotification
      await sendNotification(app, config, { 
        message, 
        title, 
        actions, 
        topic,
        server: activeServer
      });
      
      res.json({ 
        status: 'sent', 
        timestamp: new Date().toISOString(),
        server: activeServer.id,
        topic: topic || config.topic
      });
      
    } catch (err) {
      app.error(`[ntfy API] Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint de status 
  router.get('/status', (req, res) => {
    const activeServer = getActiveServer(config);
    const status = {
      status: 'active',
      plugin: 'signalk-ntfy',
      configured: !!(config && config.servers && config.servers.length > 0),
      activeServer: activeServer ? {
        id: activeServer.id,
        name: activeServer.name,
        url: activeServer.url
      } : 'No configurado',
      defaultTopic: config?.topic || 'No configurado',
      availableServers: config?.servers?.length || 0,
      timestamp: new Date().toISOString()
    };
    res.json(status);
  });

  // Endpoint activeServer
  router.put('/settings/server', async (req, res) => {
    try {
      const { serverId } = req.body;
      const server = config.servers.find(s => s.id === serverId);
      app.debug('[ntfy API] Cambiando servidor, body recibido:', JSON.stringify(req.body));
      app.debug('[ntfy API] Servidores disponibles:', JSON.stringify(config.servers.map(s => s.id)));
      
      if (!server) {
        return res.status(400).json({ error: 'Servidor no encontrado' });
      }
      
      // ACTUALIZAR CONFIGURACIÓN EN MEMORIA
      config.activeServerId = serverId;
      config.servers.forEach(s => {
        s.isDefault = (s.id === serverId);
      });
      
      //  GUARDAR EN ARCHIVO PARA PERSISTENCIA
      const configPath = path.join(process.env.HOME, '.signalk/plugin-config-data/signalk-ntfy.json');
      
      if (fs.existsSync(configPath)) {
        let configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // Actualizar qué servidor es el default
        configData.configuration.servers.forEach(server => {
          server.isDefault = (server.id === serverId);
        });
        
        // Guardar archivo
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
        app.debug(`[ntfy] Configuración persistente actualizada: servidor ${serverId}`);
      }
      
      //  ACTUALIZAR SIGNALK
      publishServerStatus(app, config);
      
      //  RECONEXIÓN ROBUSTA - USANDO REFERENCIA DIRECTA
      app.debug('[ntfy] === INICIANDO RECONEXIÓN DE LISTENERS ===');

      try {
        // Verificar que tenemos la referencia
        if (app.signalkNtfyPlugin && typeof app.signalkNtfyPlugin.reconnectListeners === 'function') {
          app.debug('[ntfy] Encontrada referencia de plugin, ejecutando reconexión...');
          
          // Actualizar la configuración en la referencia también
          app.signalkNtfyPlugin.config = config;
          
          // Ejecutar reconexión
          app.signalkNtfyPlugin.reconnectListeners();
          app.debug('[ntfy]  Comando de reconexión ejecutado');
        } else {
          app.debug('[ntfy]  No se encontró referencia de plugin, usando método de emergencia...');
          
          // MÉTODO DE EMERGENCIA - Reinicio directo
          if (config.listenForCommands) {
            const { startListener, stopListener } = require('./listener');
            
            // Detener cualquier listener global
            if (app.signalkNtfyListener) {
              stopListener(app.signalkNtfyListener);
            }
            
            // Crear nuevos listeners
            setTimeout(() => {
              app.signalkNtfyListener = startListener(app, config);
              app.debug('[ntfy] Listeners recreados (método emergencia)');
            }, 1000);
          }
        }
      } catch (err) {
        app.error(`[ntfy] ERROR en reconexión: ${err.message}`);
      }

      app.debug('[ntfy] === FIN RECONEXIÓN ===');
      
      res.json({ 
        status: 'updated', 
        activeServer: serverId,
        persistent: true,
        listenersRestarted: true,
        timestamp: new Date().toISOString()
      });
      
    } catch (err) {
      app.error(`[ntfy API] Error cambiando servidor: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.debug('[ntfy] API endpoints registrados: /send, /status, /settings/server');
}

module.exports = { registerApi };
