# Plugin de notificaciones SignalK para ntfy

Notificaciones push fiables y comunicación bidireccional para tu embarcación: desde alertas automáticas de SignalK hasta controles interactivos desde el móvil.

## ¿Qué hace este plugin?

Este plugin ofrece **dos niveles de integración** entre tu servidor SignalK y [ntfy](https://ntfy.sh):

- **Modo básico (listo para usar):**  
  Envía automáticamente las alertas de SignalK (`alarm`, `warn`, etc.) a un tema de ntfy que tú elijas.  
  Solo necesitas:  
  - Crear un tema (público en `ntfy.sh` o en tu servidor local),  
  - Instalar la app gratuita de ntfy en tu móvil (sin registro),  
  - Activar el plugin y seleccionar los niveles de alerta.  
  **¡Eso es todo!** Si solo buscas recibir notificaciones confiables de tu barco en el móvil —incluso sin internet a bordo—, ya tienes una solución completa.

- **Modo avanzado (requiere configuración adicional):**  
  Permite comunicación bidireccional:  
  - Enviar notificaciones *personalizadas* con botones interactivos (✅/❌).  
  - Escuchar dos temas de ntfy configurables: uno para comandos y otro para respuestas.  
  - Publicar cualquier mensaje recibido en esas vías en dos rutas de SignalK:  
    - `communications.ntfy.commands`  
    - `communications.ntfy.responses`  

Este segundo nivel **no incluye lógica de procesamiento**: el plugin solo actúa como puente. Tú decides qué hacer con esos mensajes (con Node-RED, scripts, otro plugin, etc.).

### ¿Qué **no** hace este plugin?

- **No interpreta ni ejecuta** los comandos que recibe. Solo los publica en SignalK para que otras herramientas los manejen.  
- **No configura tus dispositivos móviles.** Tú eliges cómo enviar órdenes al servidor (por ejemplo, con HTTP Shortcuts, la propia app de ntfy, o cualquier cliente HTTP).  
- **No gestiona seguridad más allá de lo que ntfy y SignalK ya ofrecen.** La responsabilidad de usar nombres de tema seguros, tokens y buenas prácticas recae en ti.

### En resumen

- **¿Quieres solo notificaciones automáticas?** → Instala, configura el tema, y listo.  
- **¿Quieres control interactivo desde tu móvil?** → El plugin te da los canales, pero tú construyes la lógica encima.


---

## ¿Por qué ntfy (se pronuncia "notify")?

ntfy es una alternativa ligera, segura, autoalojable y sin dependencias frente a servicios como Telegram o Pushover:

| Característica        | ntfy                            | Alternativas comunes        |
|------------------------|----------------------------------|-----------------------------|
| Autoalojable           | ✅ Sí (funciona 100% sin internet) | ❌ Generalmente no          |
| Sin necesidad de cuenta| ✅ Usa temas como “contraseñas”    | ❌ Requiere registro        |
| Bidireccional          | ✅ WebSockets + botones interactivos| ⚠️ Limitado o no nativo     |
| Código abierto         | ✅ Apache 2.0 / GPLv2             | ❌ Cerrado o parcial        |
| Amigable con la red    | ✅ Mensajes pequeños, bajo ancho de banda | ⚠️ Suele ser más pesado |

Ideal para entornos marinos: funciona en redes locales, no depende de servicios externos y consume pocos recursos.

---

## Dos modos de uso

El plugin está pensado para todos los niveles técnicos:

### 1. Modo básico – Notificaciones automáticas (¡listo en 2 minutos!)

Perfecto para recibir alertas de SignalK (`alarm`, `warn`, etc.) en tu dispositivo móvil con una configuración mínima.  
Solo necesitas:  
- Un tema en ntfy.sh (o en tu servidor local).  
- Activar el plugin y elegir los niveles de alerta.  
- La aplicación móvil de ntfy.

**Ejemplo de uso:**  
“Sobrecalentamiento del motor” → Notificación inmediata en tu teléfono.

### 2. Modo avanzado – Comunicación bidireccional

Esta es la funcionalidad principal del plugin.  
Envías comandos desde tu teléfono (por ejemplo, reiniciar un servidor o apagar luces) y recibes confirmaciones o respuestas en SignalK.

**Características clave:**  
- Enviar notificaciones personalizadas mediante la API REST (`POST /send`).  
- Botones interactivos con acciones HTTP (✅/❌).  
- Recibir respuestas en la ruta `communications.ntfy.responses`.  
- Integración nativa con Node-RED, HTTP Shortcuts, etc.  
- Cambio automático de servidor (local ↔ ntfy.sh) según la presencia en la red WiFi.

**Ejemplo de uso:**  
Notificación: “¿Reiniciar la RPi4?” → El usuario pulsa ✅ → Comando ejecutado vía SSH → Confirmación recibida en SignalK.  
Ideal para sistemas de control embebidos donde se necesita interacción segura y sin apps externas.

---

## Aplicación móvil necesaria

Para recibir notificaciones push en tu teléfono, necesitas la app oficial de ntfy:  
- [Android (Google Play)](https://play.google.com/store/apps/details?id=io.heckel.ntfy)  
- [Android (F-Droid)](https://f-droid.org/packages/io.heckel.ntfy/)  
- [iOS (App Store)](https://apps.apple.com/us/app/ntfy/id1607245910)  

La app se ejecuta en segundo plano, escucha tus temas y entrega notificaciones instantáneas y fiables, incluso cuando el teléfono está inactivo. **No requiere cuenta.**

---

## Uso responsable: respeta los límites de ntfy.sh

Si usas el servicio público de ntfy.sh, por favor respeta sus [límites del plan gratuito](https://docs.ntfy.sh/config/#general-limits):  
- ~250 mensajes/día  
- ~150 suscripciones/día  
- **Todos los temas son públicos**: cualquiera puede leerlos o escribir en ellos.

### Importante: en ntfy.sh, los tokens **no restringen el acceso** a los temas.

El servidor público funciona en modo abierto (`auth-default-access: read-write` para todos), lo que significa que **cualquier persona que conozca el nombre de tu tema puede leer y publicar en él**, incluso sin un token.

La **única protección efectiva** en ntfy.sh es:  
- Usar nombres de tema **largos, aleatorios y difíciles de adivinar** (trata el nombre del tema como una contraseña).  
- **Nunca reutilizar** nombres comunes como `boat`, `alerts` o `commands`.

Si necesitas privacidad real de los temas, publicación autenticada o nombres reservados:  
- Aloja tu propio servidor ntfy con ACLs activadas, o  
- Usa un [plan de pago de ntfy.sh](https://ntfy.sh/#pricing) (que permite reservar temas, aunque sigue sin protección por ACL en escritura).

---

## Buenas prácticas para uso marino

En escenarios típicos de navegación, no necesitas seguridad empresarial, pero sí nombres sensatos:  
- Usa nombres de tema largos y aleatorios (por ejemplo, `boat_alerts_aB3xK9mQ2p`, `commands_rZ7wL4vN8s`).  
- ntfy permite letras (A–Z, a–z), dígitos (0–9) y guiones bajos (`_`).  
- Evita palabras del diccionario o nombres de embarcaciones como `myyacht` o `sailboat123`.  
- Separa los temas por función:  
  - Uno para alertas salientes (menor riesgo).  
  - Uno para respuestas (riesgo medio).  
  - Uno dedicado y muy aleatorio para comandos (máximo riesgo).  
- Usa tokens **solo si alojas tu propio ntfy o tienes un plan de pago en ntfy.sh** —en esos casos sí evitan publicaciones no autorizadas.  
- En el servidor público gratuito, **los tokens no tienen efecto**; la seguridad depende únicamente de nombres impredecibles.

> **Importante:** el `commandsTopic` es el más sensible —puede desencadenar acciones en tu embarcación (reinicios, apagado de equipos, etc.). Siempre usa un nombre largo y aleatorio, y combínalo con un token si usas un servidor propio.

---

## ¿Es esto “suficientemente seguro”?

Para la mayoría de navegantes, **sí**:  
- Adivinar por fuerza bruta un tema aleatorio de 12 caracteres llevaría siglos, incluso sin límites de tasa.  
- ntfy.sh aplica límites estrictos (ráfaga de 60 solicitudes, luego 1 cada 10 segundos) y bloqueos por IP mediante fail2ban.  
- En una red local, los temas solo están expuestos a dispositivos de tu embarcación, sin exposición a internet.

Si necesitas ACLs completas, autenticación o aislamiento TLS, aloja ntfy en tu Raspberry Pi o PC y desactiva el acceso público.

---

## Configuración en red local (¡importante!)

❌ **Nunca uses `localhost`** en la URL del servidor si interactúas desde dispositivos móviles.  
Tu teléfono interpreta `localhost` como sí mismo, no como tu servidor SignalK.

Siempre usa la IP local real de tu servidor:

```yaml
servers:
  - id: "local"
    name: "Servidor local"
    url: "http://192.168.1.100"   # ← IP de tu PC/RPi4
    isDefault: true
  - id: "remote"
    name: "ntfy.sh público"
    url: "https://ntfy.sh"
    token: "tu_token_privado"
```
## Instalación y requisitos 

    Servidor SignalK (versión 1.40+ recomendada)  
    Node.js ≥ 16  
    Acceso a ntfy (público o autoalojado)
     

 
## Documentación 

Consulta la documentación integrada del plugin para:

- Configuración paso a paso (básico → avanzado)  
- Subflujos listos para usar en Node-RED  
- Solución de problemas comunes  
- Ejemplos de integración con API REST

## Rutas de SignalK y endpoints de API 

El plugin crea las siguientes rutas de datos y endpoints REST para permitir una integración completa: 


- **communications.ntfy.settings.activeServer** (siempre disponible)
    Cadena que indica el ID del servidor ntfy activo (por ejemplo, "local" o "ntfysh"). Se actualiza al iniciar y cada 30 segundos. 

- **communications.ntfy.responses** (solo en modo avanzado)
    Respuestas de los botones interactivos de ntfy aparecen aquí como deltas de SignalK. 

- **communications.ntfy.commands** (solo en modo avanzado)
    Comandos personalizados enviados vía ntfy (por ejemplo, "action:reboot,value:true") se publican aquí para que los consuman Node-RED, otros plugins o lógica de automatización. 
     

Estas rutas permiten una integración fluida con herramientas compatibles con SignalK sin necesidad de sondeo ni dependencias externas. 
## Endpoints de API REST 

El plugin expone los siguientes endpoints bajo el enrutador de plugins de SignalK (/plugins/signalk-ntfy): 

- **POST /plugins/signalk-ntfy/send**
    Envía una notificación personalizada al servidor ntfy configurado.
    Opcionalmente, puedes sobrescribir el tema predeterminado en el cuerpo de la solicitud (útil para enrutamiento dinámico).

>  Nota: las respuestas de los botones interactivos siempre se publicarán en el responsesTopic configurado (communications.ntfy.responses), independientemente del tema usado en el mensaje original.  

Ejemplo de solicitud:
```
{
   "title": "Control de luces de camarote",
   "message": "¿Apagar las luces del camarote?",
   "topic": "boat_alerts",
   "actions": [
    {
       "action": "broadcast",
       "label": "✅ Sí",
       "message": "action:lights_off,value:true",
       "actionId": "cabin_lights_123"
    },
    {
       "action": "broadcast",
       "label": "❌ No",
       "message": "action:lights_off,value:false",
       "actionId": "cabin_lights_123"
    }
  ]
}
```
- ** GET /plugins/signalk-ntfy/status**
Devuelve el estado actual del plugin. 

Ejemplo de respuesta:
```
{
 "status": "activo",
 "plugin": "signalk-ntfy",
 "configured": true,
 "ntfyUrl": "https://ntfy.sh",
 "defaultTopic": "boat_alerts",
 "timestamp": "2025-11-04T12:00:00.000Z"
}
```
- **PUT /plugins/signalk-ntfy/settings/server**
Cambia dinámicamente el servidor ntfy activo y guarda la selección. Reinicia los oyentes si el modo avanzado está activado. 

Ejemplo de solicitud:
```
{
  "serverId": "local"
}
```
Ejemplo de respuesta exitosa:
```
{
 "status": "actualizado",
 "activeServer": "local",
 "persistent": true,
 "listenersRestarted": true,
 "timestamp": "2025-11-04T12:00:00.000Z"
}
```
> Para esquemas completos de solicitud/respuesta y reglas de validación, consulta el archivo openApi.json incluido.

## Licencia y agradecimientos 

Licencia: Apache-2.0
Gracias a la comunidad de SignalK y a ntfy.sh por construir herramientas fiables y abiertas.
Este plugin no está afiliado a ntfy.sh ni a SignalK. Úsalo bajo tu propia responsabilidad y cumpliendo con los términos de los servicios. 
 

Ejemplo: notificación con confirmación
```
{
   "title": "Control de luces de camarote",
   "message": "¿Apagar las luces del camarote?",
   "actions": [
    {
       "action": "broadcast",
       "label": "✅ Sí",
       "message": "action:lights_off, value:true",
       "actionId": "cabin_lights_123"
    },
    {
       "action": "broadcast",
       "label": "❌ No",
       "message": "action:lights_off, value:false",
       "actionId": "cabin_lights_123"
    }
  ]
}
```
