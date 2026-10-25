#!/usr/bin/env node
// Pruebas de `excludePaths` (signalk-ntfy) — SIN tocar Signal K ni la red del barco.
//
// Monta un servidor HTTP en 127.0.0.1 que hace de servidor ntfy, carga el plugin
// de verdad (`index.js` -> `sender.js` + `retry.js`) con un `app` de mentira y le
// inyecta deltas de notificacion por el mismo camino que usa Signal K:
// `app.subscriptionmanager.subscribe(...)`.
//
// Que se comprueba:
//   1. prefijo EXACTO  -> el path excluido no se envia
//   2. prefijo PARCIAL -> un path por debajo del prefijo tampoco se envia
//   3. path HERMANO    -> `...anchorWatch` NO se excluye al excluir `...anchor`
//   4. aviso de CLEARED -> un path excluido tampoco manda "vuelta a normal"
//   5. normalizacion   -> sin `notifications.`, con punto final, repetidas, y las
//                         entradas peligrosas (`*`, vacia, `notifications`) se
//                         avisan en el log y se ignoran
//   6. sin excludePaths (o lista vacia) no cambia NADA del comportamiento previo
//
// Uso:  node test/exclude-paths.test.js
// Salida: linea por comprobacion y codigo 0 si todo pasa, 1 si algo falla.

const http = require('http');
const path = require('path');

const DIR = path.join(__dirname, '..');
const FICHEROS = ['index.js', 'sender.js', 'listener.js', 'api.js', 'retry.js'];
// Prefijo comun de todos los paths de prueba (como el `notifications.` real).
const BASE = 'notifications.prueba.filtro';

let fallos = 0;

function check(nombre, condicion, detalle) {
  if (condicion) {
    console.log(`  [OK  ] ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  [FALLO] ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  }
}

function limpiarCache() {
  for (const f of FICHEROS) {
    delete require.cache[require.resolve(path.join(DIR, f))];
  }
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Servidor ntfy falso: guarda los cuerpos JSON que recibe y responde 200.
async function arrancarNtfy() {
  const recibidas = [];
  const srv = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      try { recibidas.push(JSON.parse(cuerpo)); } catch (e) { recibidas.push({ crudo: cuerpo }); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"id":"prueba"}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, recibidas, puerto: srv.address().port };
}

// Delta de notificacion tal cual lo manda Signal K.
function delta(p, value) {
  return { updates: [{ values: [{ path: `${BASE}.${p}`, value }] }] };
}

function aviso(state, message) {
  return { state, method: ['visual'], message };
}

// Arranca el plugin contra el ntfy falso con la configuracion pedida y devuelve
// la funcion para inyectar un delta mas lo que se ha enviado / avisado en el log.
async function escenario(settings) {
  limpiarCache();
  const { srv, recibidas, puerto } = await arrancarNtfy();
  const errores = [];
  let deltaCb = null;
  const app = {
    debug: () => {},
    error: (m) => errores.push(m),
    handleMessage: () => {},
    subscriptionmanager: {
      subscribe: (sub, unsubs, errCb, cb) => { deltaCb = cb; },
    },
  };
  const plugin = require(path.join(DIR, 'index.js'))(app);
  plugin.start({
    enabled: true,
    topic: 'prueba-filtro',
    levels: ['alert', 'warn', 'alarm', 'emergency'],
    listenForCommands: false,
    filterDuplicates: false,
    notifyOnClear: true,
    servers: [{ id: 'prueba', name: 'ntfy de prueba', url: `http://127.0.0.1:${puerto}`, isDefault: true }],
    ...settings,
  }, () => {});
  if (typeof deltaCb !== 'function') throw new Error('el plugin no se suscribio a notifications.*');
  return {
    recibidas,
    errores,
    async inyectar(p, value) {
      deltaCb(delta(p, value));
      await esperar(120);
    },
    async cerrar() {
      plugin.stop();
      await esperar(120);
      srv.close();
    },
  };
}

// --- 1) prefijo exacto ----------------------------------------------------
async function casoExacto() {
  console.log('\n[1] prefijo exacto: el path excluido no se envia');
  const e = await escenario({ excludePaths: [`${BASE}.security.deadmansswitch`] });
  await e.inyectar('security.deadmansswitch', aviso('alarm', 'switch sin confirmar'));
  check('0 envios del path excluido', e.recibidas.length === 0, `${e.recibidas.length} envio(s)`);
  await e.cerrar();
}

// --- 2) prefijo parcial (path por debajo del prefijo) ---------------------
async function casoParcial() {
  console.log('\n[2] prefijo parcial: un path por debajo del prefijo tampoco se envia');
  const e = await escenario({ excludePaths: [`${BASE}.security.deadmansswitch`] });
  await e.inyectar('security.deadmansswitch.sub.algo', aviso('emergency', 'hijo del excluido'));
  check('0 envios del hijo del path excluido', e.recibidas.length === 0, `${e.recibidas.length} envio(s)`);
  await e.cerrar();
}

// --- 3) path hermano que NO debe excluirse -------------------------------
async function casoHermano() {
  console.log('\n[3] path hermano: NO se excluye');
  const e = await escenario({ excludePaths: [`${BASE}.security.deadmansswitch`] });
  await e.inyectar('security.deadmansswitchWatch', aviso('alarm', 'hermano con el prefijo como texto'));
  check('1 envio del hermano', e.recibidas.length === 1, `${e.recibidas.length} envio(s)`);
  check('el hermano llega con su mensaje',
    e.recibidas[0] && e.recibidas[0].message === 'hermano con el prefijo como texto',
    JSON.stringify(e.recibidas[0]));
  // Y un path de otra rama sigue saliendo igual.
  await e.inyectar('temperatura', aviso('warn', 'nevera fuera de rango'));
  check('un path ajeno sigue enviandose', e.recibidas.length === 2, `${e.recibidas.length} envio(s)`);
  await e.cerrar();
}

// --- 4) el aviso de CLEARED tambien se excluye ---------------------------
async function casoCleared() {
  console.log('\n[4] cleared: el path excluido tampoco manda "vuelta a normal"');
  const e = await escenario({ excludePaths: [`${BASE}.security.deadmansswitch`] });
  await e.inyectar('security.deadmansswitch', aviso('alarm', 'switch sin confirmar'));
  await e.inyectar('security.deadmansswitch', aviso('normal', 'switch confirmado'));
  check('ni alarma ni CLEARED del excluido (0 envios)', e.recibidas.length === 0,
    e.recibidas.map((r) => r.title).join(' | '));
  // Control: un path NO excluido si manda su CLEARED con notifyOnClear activo.
  await e.inyectar('temperatura', aviso('alarm', 'nevera a 12 grados'));
  await e.inyectar('temperatura', aviso('normal', 'nevera otra vez bien'));
  check('el path no excluido manda alarma + CLEARED (2 envios)', e.recibidas.length === 2,
    e.recibidas.map((r) => r.title).join(' | '));
  check('el segundo es el CLEARED', /CLEARED/.test((e.recibidas[1] || {}).title || ''),
    JSON.stringify(e.recibidas[1]));
  await e.cerrar();
}

// --- 5) normalizacion y entradas peligrosas ------------------------------
async function casoNormalizacion() {
  console.log('\n[5] normalizacion: sin notifications., punto final, repetidas y entradas peligrosas');
  const e = await escenario({
    excludePaths: [
      'security.deadmansswitch',                      // sin notifications.: vale
      `${BASE}.security.deadmansswitch.`,             // punto final: se recorta
      `${BASE}.security.deadmansswitch`,              // repetida: no molesta
      '*',                                            // peligrosa: se ignora
      '',                                             // vacia: se ignora
      'notifications',                                // excluiria todo: se ignora
    ],
  });
  await e.inyectar('security.deadmansswitch', aviso('alarm', 'sin prefijo en la config'));
  check('la entrada sin notifications. excluye igual', e.recibidas.length === 0, `${e.recibidas.length} envio(s)`);
  await e.inyectar('otra.cosa', aviso('alert', 'no esta excluida'));
  check('lo no excluido sigue saliendo pese a las entradas malas', e.recibidas.length === 1,
    `${e.recibidas.length} envio(s)`);
  check('las 3 entradas peligrosas se avisan en el log', e.errores.length === 3,
    JSON.stringify(e.errores));
  await e.cerrar();
}

// --- 6) sin excludePaths no cambia nada ---------------------------------
async function casoSinExcluir() {
  console.log('\n[6] sin excludePaths (o lista vacia) el comportamiento previo no cambia');
  for (const config of [{}, { excludePaths: [] }]) {
    const e = await escenario(config);
    await e.inyectar('security.deadmansswitch', aviso('alarm', 'switch sin confirmar'));
    await e.inyectar('security.deadmansswitch', aviso('normal', 'switch confirmado'));
    check(`${JSON.stringify(config)}: alarma + CLEARED (2 envios)`, e.recibidas.length === 2,
      `${e.recibidas.length} envio(s)`);
    check(`${JSON.stringify(config)}: sin avisos de config`, e.errores.length === 0,
      JSON.stringify(e.errores));
    await e.cerrar();
  }
}

(async () => {
  console.log('Pruebas de excludePaths (signalk-ntfy) - todo en 127.0.0.1');
  await casoExacto();
  await casoParcial();
  await casoHermano();
  await casoCleared();
  await casoNormalizacion();
  await casoSinExcluir();
  console.log('\n' + '='.repeat(60));
  if (fallos > 0) {
    console.log(`RESULTADO: ${fallos} FALLO(S)`);
    process.exit(1);
  }
  console.log('RESULTADO: todas las comprobaciones OK');
  process.exit(0);
})().catch((err) => {
  console.error('ERROR en las pruebas:', err);
  process.exit(2);
});
