# Changelog

All notable changes to the `signalk-ntfy` plugin are documented in this file.  
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) standards.

## [0.2.0] - 2026-11-10

### Added
- **Paths excluidos (`excludePaths`)**: nueva lista de prefijos de path en la configuracion cuyas notificaciones no se reenvian nunca al telefono, ni en el ciclo de niveles ni en el aviso de vuelta a normal (`notifyOnClear`). Sirve para dejar un ciclo de avisos a bordo (sirena del webapp, tablet) sin que suene ademas el movil. Mismo criterio de coincidencia que `clickUrls` (prefijo por segmentos completos: `notifications.security.deadmansswitch` excluye sus hijos pero no un hermano como `...deadmansswitchWatch`); el `notifications.` inicial es opcional, los puntos finales se recortan y las entradas `*`, vacias o `notifications` se avisan en el log y se ignoran. El path excluido se descarta antes del filtro de duplicados y del registro de `notifyOnClear`. Con la lista vacia el comportamiento es el de la 0.1.0.
- **Aviso de alertas ya activas al arrancar (`notifyActiveOnStart`)**: encendido por defecto. Al arrancar, y tambien cada vez que se guarda la configuracion (que reinicia el plugin), Signal K entrega el valor actual de todos los paths de notificacion antes de cualquier delta en vivo. Con la opcion encendida cada alerta ya activa en uno de los niveles elegidos se vuelve a anunciar; apagada, solo salen las alertas levantadas o cambiadas despues del arranque. El replay se reconoce por una bandera puesta durante `subscribe()` (la entrega es sincrona), sin comparar marcas de tiempo: un productor con el reloj mal no puede afectarle. Signal K 2.37.0 y posteriores entregan ese replay tambien con seguridad activada; en la 2.36.0 y anteriores solo llegaba al plugin en un servidor sin seguridad, asi que ahi la opcion no tiene efecto visible. Contribucion de Peter Petrik (PR #10).
- Pruebas del filtro de exclusion en `test/exclude-paths.test.js` (`npm test`): prefijo exacto, path por debajo del prefijo, hermano que no se excluye, aviso de `CLEARED` excluido y normalizacion de entradas.

### Fixed
- **Los niveles de alerta se dibujan como casillas, sin el aviso de formato desconocido**: `levels` llevaba `"format": "checkboxes"`, que el validador del formulario del Admin UI no conoce: avisaba dos veces en cada guardado (`unknown format "checkboxes" ignored in schema at path ...`) y lo ignoraba, dibujando el campo como una lista con botones de anadir, quitar y mover. Ahora el esquema usa `uniqueItems` y el plugin declara `uiSchema` con `ui:widget: checkboxes`, que es donde el formulario espera la pista del widget. La clave, el enum, el valor por defecto y el formato guardado de `levels` no cambian. Contribucion de Peter Petrik (PR #12).

### Notas
- Con `notifyActiveOnStart` en su valor por defecto, `excludePaths` vacio y `levels` sin tocar, el comportamiento es el de la 0.1.0: sin cambios en `filterDuplicates`, `notifyOnClear`, `clickUrls` ni en la cola de reintentos.

## [0.1.0] - 2026-10-21

### Added
- **URL de click por path (`clickUrls`, issue #7)**: nueva lista de parejas prefijo/URL en la configuracion. La notificacion reenviada lleva el campo `click` de ntfy, asi que al tocarla el telefono abre la pagina que corresponda (alarma de ancla, dashboard, camara) en vez de la app de ntfy. Coincidencia por segmentos completos del path, gana el prefijo mas largo, `*` o prefijo vacio como comodin, sin coincidencia no se manda click. El prefijo se normaliza con `notifications.` delante si falta, se recorta la barra final de la URL y solo se aceptan `http`/`https`: una entrada invalida se avisa en el log al arrancar y se ignora sin tumbar el plugin. `POST /send` acepta `click` explicito.
- **Aviso de vuelta a normal (`notifyOnClear`, issue #6)**: apagado por defecto. Con el encendido, el plugin recuerda en memoria (por path, caducidad de 24 h) los avisos que ha encolado y, cuando ese path llega como `normal` o `null`, manda un unico `CLEARED: <camino>` con el mensaje del valor (o `Back to normal`), prioridad la del mapa para `normal` (2 por defecto) y borra la marca del filtro de duplicados para que una alarma nueva entre de inmediato. El registro se anota al encolar, no al confirmar; el aviso de vuelta a normal no se anota en el filtro. Un valor `normal` no sigue nunca el camino normal, aunque `normal` este en `levels`.

### Notas
- Sin cambios en `filterDuplicates` ni en la cola de reintentos: con `notifyOnClear` apagado y `clickUrls` vacio el comportamiento es el de la 0.0.9.
- Esta version manda un mensaje nuevo al volver a normal: no se usa `sequence_id` ni `message_clear` de ntfy para actualizar el aviso original.

## [0.0.9] - 2026-10-20

### Fixed
- **Una notificacion se perdia cuando el POST a ntfy fallaba**: no habia reintento. Ahora un envio fallido se reintenta a los 5, 15 y 45 s (unos 65 s en total) y, si se agotan, deja un error final en el log. Solo se reintenta en error de red, timeout, HTTP 5xx y HTTP 429; un 4xx (401, 403) es error de configuracion y no se repite.
- La peticion tiene **timeout de 10 s**: un servidor que acepta la conexion y no contesta ya no deja el envio pendiente, falla y entra en el reintento.
- Una **notificacion nueva del mismo path sustituye al reintento pendiente** de ese path, de modo que un productor que repite cada pocos segundos durante una caida no acumula envios.
- Con `filterDuplicates` encendido, la marca del path solo se da por buena cuando el envio tiene exito: si se agotan los reintentos se deshace, y la siguiente notificacion de ese path no se silencia (issue #5, reportado por Peter Petrik).
- Textos que llegan al telefono o a la UI pasan a ingles, como el README y el formulario: `No message`, ` (Silenced)`, `Main server` y la descripcion del plugin `Sends Signal K notifications to ntfy` (issue #8, reportado por Peter Petrik).

### Notas
- Sin dependencias nuevas: el timeout usa `AbortController`, nativo en Node >= 16.
- La ruta de la API `POST /send` sigue siendo un intento unico (ahora tambien con timeout): responde el error a quien llama en lugar de reintentar por detras.
- Los mensajes de log siguen en espanol.

## [0.0.8] - 2026-10-19

### Added
- Titulo derivado del path y del estado cuando el productor no envia `title` (p. ej. `ALARM: Navigation Anchor Drag`), y campo opcional `titlePrefix` para anteponer una etiqueta propia, como el nombre del barco. Contribucion de Peter Petrik (PR #2).

### Fixed
- **El filtro de notificaciones duplicadas anunciado en 0.0.5 no estaba conectado a ningun codigo**: `filterDuplicates` y `minIntervalMinutes` existian en el esquema y en la documentacion, pero no se aplicaban. Ahora funcionan por path: se envia cuando el estado cambia o cuando vence el intervalo minimo, y se silencia el resto.
- Una **escalada de severidad** (`normal` < `alert` < `warn` < `alarm` < `emergency`) **nunca se silencia**, aunque el path este en cooldown.
- El registro del filtro se purga solo (entradas de mas de 24 h) y un envio fallido no consume cooldown: el siguiente delta de ese path se vuelve a intentar.

### Notas
- Con `filterDuplicates` en `false` (valor por defecto) el comportamiento es exactamente el anterior: una notificacion por cada delta que pase el filtro de niveles.

## [0.0.7] - 2026-07-19

### Fixed
- **CORRECCIÓN CRÍTICA**: Arreglado problema con codificación UTF-8 en títulos y acciones
- Cambiado a JSON publishing (recomendado por documentación oficial de ntfy)
- Los emojis y caracteres especiales ahora se muestran correctamente
- Las acciones con botones funcionan correctamente
- Soporte completo para UTF-8 en mensajes, títulos y labels de acciones

### Technical Details
- Las notificaciones ahora se envían como JSON a la raíz del servidor (`POST /`)
- El topic va dentro del payload JSON en lugar de la URL
- Esto permite UTF-8 nativo sin problemas de codificación en headers HTTP
- Compatible con servidores ntfy auto-alojados y ntfy.sh

### Regression en la version 0.0.6
- Problema con codificación de caracteres UTF-8 en headers HTTP
- Los emojis y acentos no se mostraban correctamente
- Las acciones con botones fallaban

**Nota**: La versión 0.0.7 es un parche correctivo que soluciona la regresión introducida en 0.0.6.

## [0.0.6] - 2026-07-18

### Added
- Documentation update: Added "Anti-Spam Filtering" section to README.md to explain the duplicate notification filter introduced in v0.0.5.

## [0.0.5] - 2026-07-18

### Added
- Filtro de notificaciones repetidas configurable por path (`filterDuplicates` y `minIntervalMinutes`) para evitar spam en alarmas de alta frecuencia (ej. alarma de ancla).

### Fixed
- Corrección crítica en la construcción de URLs (expresión regular `//` corregida a `/\/$/`) que causaba fallos silenciosos en la conexión.
- El WebSocket ahora utiliza correctamente las cabeceras nativas de autenticación (`Authorization: Bearer`) en lugar de parámetros de URL, resolviendo el error 403 en servidores ntfy con acceso anónimo denegado.
- Eliminada la condición de carrera que provocaba la doble inicialización del listener al cambiar de servidor desde la interfaz de usuario.

## [0.0.4] - 2026-03-14

### Added
- Mapeo automático de estado SignalK → prioridad ntfy (1-5)
- Soporte para campo 'state' en API /send
- Priorización de notificaciones según severidad (alert, alarm, emergency)

### Changed
- Mejora en listener.js: corrección de comentario INACTIVITY_TIMEOUT

### Fixed
- Notificaciones ahora respetan el nivel de urgencia de SignalK

## [0.0.3] - 2025-11-25

### Fixed

- **WebSocket instability**: implemented client-side `ping` and unified topic subscription to prevent disconnections in NAT/firewall environments (e.g., marine networks).
- **Risk of rate-limiting on `ntfy.sh`**: reduced subscription count by 50% by using a single WebSocket connection for both command and response topics.

### Changed

- **Exponential backoff**: reconnection delays now follow `[5, 10, 15, 20, 30, 45, 60, 120]` seconds to avoid overwhelming the server during outages.
- **Inactivity timeout**: increased from 60 seconds to 300 seconds (5 minutes) to align with real-world `ntfy.sh` behaviour and prevent premature reconnection.

### Added

- **Full compatibility** with existing configurations — no changes required in UI or `package.json` beyond version bump.
- **Robust connection management** inspired by the official ntfy Android client.

> 💡 **Recommendation**: Users of `ntfy.sh` are strongly encouraged to update to this version to avoid service disruption due to connection throttling.

## [0.0.2] - 2025-11-04

### Changed

- Introduced conservative reconnection strategy for `ntfy.sh` (10-minute delay) to comply with public server limits.
- Added protection against infinite reconnection loops (max 5 attempts).

## [0.0.1] - 2025-11-03

### Added

- Initial release: basic and advanced modes, REST API, WebSocket bidirectional communication, multi-server support.
