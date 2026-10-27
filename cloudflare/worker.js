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

// Modelo de Gemini. Si Google lo retira, cámbialo por el
// modelo "Flash" que aparezca en Google AI Studio.
var MODELO = 'gemini-3.8-flash';

var MAX_CARACTERES_PEDIDO = 4000;  // largo máximo de lo que envía la página
var MAX_TOKENS_RESPUESTA = 4096;   // largo máximo de la respuesta (~3000 palabras)

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

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELO + ':generateContent';
    var respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: texto }] }],
        generationConfig: { maxOutputTokens: MAX_TOKENS_RESPUESTA, temperature: 0.9 }
      })
    });

    var datos = await respuesta.json().catch(function () { return {}; });
    if (!respuesta.ok) {
      var mensaje = (datos.error && datos.error.message) || 'Gemini no respondió';
      return responder({ error: mensaje }, respuesta.status, origen);
    }

    var partes = (((datos.candidates || [])[0] || {}).content || {}).parts || [];
    var resultado = partes.map(function (p) { return p.text || ''; }).join('');
    return responder({ texto: resultado }, 200, origen);
  }
};
