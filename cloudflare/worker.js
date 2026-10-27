/* ==========================================================
   Fábrica Oscura — intermediario seguro para Gemini
   Se pega en un Worker de Cloudflare. La clave de Gemini NO
   va aquí: se guarda en Cloudflare como secreto llamado
   GEMINI_API_KEY.
   ========================================================== */

// Páginas que pueden usar este intermediario.
var ORIGENES_PERMITIDOS = [
  'https://edwin2030-cmd.github.io'
];

// Modelos de Gemini, en orden de preferencia. Si uno está
// ocupado o ya no existe, se prueba el siguiente.
// Los terminados en "-latest" los mantiene Google al día solos.
var MODELOS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.8-flash-lite',
  'gemini-flash-lite-latest'
];

var MAX_CARACTERES_PEDIDO = 4000;  // largo máximo de lo que envía la página
var MAX_TOKENS_RESPUESTA = 4096;   // largo máximo de la respuesta (~3000 palabras)
var ESPERA_REINTENTO = 2000;       // milisegundos antes de reintentar un modelo ocupado
var TIEMPO_POR_INTENTO = 20000;    // milisegundos máximos de espera por cada intento

function esperar(ms) {
  return new Promise(function (resolver) { setTimeout(resolver, ms); });
}

// Un solo pedido a un modelo. Devuelve { estado, datos }.
async function pedirAGemini(modelo, texto, clave) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent';
  try {
    var respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': clave
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: texto }] }],
        generationConfig: { maxOutputTokens: MAX_TOKENS_RESPUESTA, temperature: 0.9 }
      }),
      signal: AbortSignal.timeout(TIEMPO_POR_INTENTO)
    });
    var datos = await respuesta.json().catch(function () { return {}; });
    return { estado: respuesta.status, datos: datos };
  } catch (e) {
    return { estado: 504, datos: { error: { message: 'Gemini tardó demasiado en responder' } } };
  }
}

// Errores pasajeros: vale la pena reintentar o probar otro modelo.
function esPasajero(estado) {
  return estado === 429 || estado === 500 || estado === 503 || estado === 504;
}

function cabecerasCors(origen) {
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function responder(datos, estado, origen) {
  var cabeceras = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cabecerasCors(origen));
  return new Response(JSON.stringify(datos), { status: estado, headers: cabeceras });
}

export default {
  async fetch(peticion, env) {
    var origen = peticion.headers.get('Origin') || '';
    if (ORIGENES_PERMITIDOS.indexOf(origen) === -1) {
      return new Response('Origen no permitido', { status: 403 });
    }

    if (peticion.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cabecerasCors(origen) });
    }
    if (peticion.method !== 'POST') {
      return responder({ error: 'Usa POST' }, 405, origen);
    }
    if (!env.GEMINI_API_KEY) {
      return responder({ error: 'Falta el secreto GEMINI_API_KEY en Cloudflare' }, 500, origen);
    }

    var cuerpo;
    try {
      cuerpo = await peticion.json();
    } catch (e) {
      return responder({ error: 'Pedido no válido' }, 400, origen);
    }

    var texto = typeof cuerpo.prompt === 'string' ? cuerpo.prompt.trim() : '';
    if (!texto) return responder({ error: 'El pedido está vacío' }, 400, origen);
    if (texto.length > MAX_CARACTERES_PEDIDO) {
      return responder({ error: 'El pedido es demasiado largo' }, 400, origen);
    }

    // Prueba cada modelo; si está ocupado, reintenta una vez y luego pasa al siguiente.
    var ultimo = { estado: 503, datos: {} };
    for (var i = 0; i < MODELOS.length; i++) {
      for (var intento = 0; intento < 2; intento++) {
        var r = await pedirAGemini(MODELOS[i], texto, env.GEMINI_API_KEY);
        if (r.estado === 200) {
          var partes = (((r.datos.candidates || [])[0] || {}).content || {}).parts || [];
          var resultado = partes.map(function (p) { return p.text || ''; }).join('');
          return responder({ texto: resultado, modelo: MODELOS[i] }, 200, origen);
        }
        ultimo = r;
        if (!esPasajero(r.estado)) break;     // p. ej. 404: el modelo no existe, no insistir
        if (r.estado === 504) break;          // muy lento: mejor probar otro modelo
        if (intento === 0) await esperar(ESPERA_REINTENTO);
      }
      // Clave inválida o pedido mal formado: otro modelo no lo arreglará.
      if (ultimo.estado === 400 || ultimo.estado === 401 || ultimo.estado === 403) break;
    }

    var mensaje = (ultimo.datos.error && ultimo.datos.error.message) || 'Gemini no respondió';
    return responder({ error: mensaje }, ultimo.estado, origen);
  }
};
