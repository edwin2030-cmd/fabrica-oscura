/* ==========================================================
   Fábrica Oscura — intermediario seguro
   Textos y voces con Gemini; imágenes y voz de respaldo con
   Workers AI de Cloudflare. Se pega en un Worker de Cloudflare.
   La clave de Gemini NO va aquí: se guarda en Cloudflare
   como secreto llamado GEMINI_API_KEY. Las imágenes usan la
   conexión (binding) de Workers AI llamada AI, sin clave.
   ========================================================== */

// Páginas que pueden usar este intermediario.
var ORIGENES_PERMITIDOS = [
  'https://edwin2030-cmd.github.io'
];

// Modelos de Gemini, en orden de preferencia. Si uno está
// ocupado o ya no existe, se prueba el siguiente.
// Los terminados en "-latest" los mantiene Google al día solos.
// Primero va el que menos se satura, para responder más rápido.
var MODELOS = [
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.8-flash-lite'
];

var MAX_CARACTERES_PEDIDO = 24000; // largo máximo de lo que envía la página (historias completas)
var MAX_TOKENS_RESPUESTA = 8192;   // largo máximo de la respuesta
var ESPERA_REINTENTO = 2000;       // milisegundos antes de reintentar un modelo ocupado
var TIEMPO_POR_INTENTO = 45000;    // milisegundos máximos de espera por cada intento
var TIEMPO_TOTAL = 85000;          // límite total, por debajo de los 100 s que espera Cloudflare

function esperar(ms) {
  return new Promise(function (resolver) { setTimeout(resolver, ms); });
}

// Un solo pedido a un modelo. Devuelve { estado, datos }.
async function pedirAGemini(modelo, texto, clave, json, tiempo) {
  var config = { maxOutputTokens: MAX_TOKENS_RESPUESTA, temperature: 0.9 };
  if (json) config.responseMimeType = 'application/json';
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
        generationConfig: config
      }),
      signal: AbortSignal.timeout(Math.max(1000, Math.min(TIEMPO_POR_INTENTO, tiempo)))
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

/* ---------------- Voces (texto a voz) ---------------- */

// Modelos de voz de Gemini con nivel gratuito, en orden de preferencia.
var MODELOS_VOZ = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview'
];
var MAX_CARACTERES_VOZ = 3000;     // largo máximo de cada fragmento de narración
var MAX_CARACTERES_ESTILO = 300;   // largo máximo de la indicación de estilo
var TIEMPO_POR_VOZ = 80000;        // milisegundos máximos de espera por cada audio

// Lista las voces de Gemini en español latinoamericano.
async function listarVoces(clave) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/voices?page_size=300' +
    ['es-419', 'es-MX', 'es-US', 'es-CO', 'es-AR', 'es-CL', 'es-PE', 'es-VE']
      .map(function (c) { return '&language_code=' + c; }).join('');
  try {
    var respuesta = await fetch(url, { headers: { 'x-goog-api-key': clave }, signal: AbortSignal.timeout(TIEMPO_POR_INTENTO) });
    var datos = await respuesta.json().catch(function () { return {}; });
    if (!respuesta.ok) return { estado: respuesta.status, datos: { error: (datos.error && datos.error.message) || 'No se pudo obtener la lista de voces' } };
    var voces = (datos.voices || []).map(function (v) {
      return {
        id: v.id || v.name || '',
        nombre: v.display_name || v.displayName || v.id || '',
        genero: v.gender || '',
        acento: v.accent || '',
        idioma: v.language_code || v.languageCode || '',
        descripcion: (v.description || '').slice(0, 200)
      };
    }).filter(function (v) { return v.id; });
    return { estado: 200, datos: { voces: voces } };
  } catch (e) {
    return { estado: 504, datos: { error: 'Gemini tardó demasiado en responder' } };
  }
}

// Genera el audio de un fragmento. Si sale bien, devuelve la respuesta de
// Google tal cual (sin abrirla), para no gastar el tiempo de proceso gratuito.
async function generarVoz(texto, voz, estilo, clave) {
  var contenido = { type: 'text', text: texto };
  if (estilo) contenido.annotations = [{ type: 'speech_metadata', style: estilo }];

  var ultimo = { estado: 503, error: 'Gemini no respondió' };
  for (var i = 0; i < MODELOS_VOZ.length; i++) {
    for (var intento = 0; intento < 2; intento++) {
      var respuesta;
      try {
        respuesta = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
          body: JSON.stringify({
            model: MODELOS_VOZ[i],
            input: [{ type: 'user_input', content: [contenido] }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: voz }] }
          }),
          signal: AbortSignal.timeout(TIEMPO_POR_VOZ)
        });
      } catch (e) {
        // Muy lento: no seguir probando, para no pasar el límite de espera de Cloudflare.
        return { estado: 504, error: 'Gemini tardó demasiado en generar el audio' };
      }
      if (respuesta.ok) return { estado: 200, cuerpo: respuesta.body, modelo: MODELOS_VOZ[i] };

      var datos = await respuesta.json().catch(function () { return {}; });
      ultimo = { estado: respuesta.status, error: (datos.error && datos.error.message) || 'Gemini no respondió' };
      if (!esPasajero(respuesta.status)) break;
      if (intento === 0) await esperar(ESPERA_REINTENTO);
    }
    // Clave inválida o voz inexistente: otro modelo no lo arreglará.
    if (ultimo.estado === 401 || ultimo.estado === 403) break;
  }
  return ultimo;
}

/* ---------------- Voz de respaldo (Workers AI de Cloudflare) ---------------- */

// MeloTTS: voz en español, sin límite por minuto y casi sin gasto
// (unos 0,0002 $ por minuto de audio, dentro de lo gratuito diario).
var MODELO_VOZ_CF = '@cf/myshell-ai/melotts';

async function generarVozCloudflare(env, texto) {
  try {
    var resultado = await env.AI.run(MODELO_VOZ_CF, { prompt: texto, lang: 'es' });
    var audio = resultado && (resultado.audio || resultado.result && resultado.result.audio);
    if (typeof audio !== 'string' || !audio) return { estado: 502, error: 'Cloudflare no devolvió audio' };
    return { estado: 200, datos: { audio: audio, formato: 'mp3', modelo: MODELO_VOZ_CF } };
  } catch (e) {
    var mensaje = String((e && e.message) || e || '');
    if (/neuron|4006|daily|allocation|quota/i.test(mensaje)) {
      return { estado: 429, error: 'Se alcanzó el límite gratuito diario de Cloudflare. Se renueva cada día a las 00:00 UTC.' };
    }
    return { estado: 502, error: 'No se pudo generar la voz de Cloudflare: ' + mensaje.slice(0, 200) };
  }
}

/* ---------------- Imágenes (Workers AI de Cloudflare) ---------------- */

var MODELO_IMAGEN = '@cf/black-forest-labs/flux-2-klein-4b';
var MAX_CARACTERES_IMAGEN = 2000;      // largo máximo de la descripción de la imagen
var MAX_BYTES_REFERENCIA = 400000;     // tamaño máximo de la imagen de referencia

function base64ABlob(b64, tipo) {
  var binario = atob(b64);
  var bytes = new Uint8Array(binario.length);
  for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

// Traduce los errores de Workers AI a mensajes claros.
function errorDeImagen(e) {
  var texto = String((e && e.message) || e || '');
  if (/3030|nsfw|safety|flagged|reject/i.test(texto)) {
    return { estado: 422, error: 'El filtro de seguridad bloqueó esta imagen. Pulsa regenerar o suaviza la descripción (menos sangre o violencia explícita).' };
  }
  if (/neuron|4006|daily|allocation|quota/i.test(texto)) {
    return { estado: 429, error: 'Se alcanzó el límite gratuito diario de imágenes de Cloudflare. Se renueva cada día a las 00:00 UTC (las 7 de la tarde en Colombia o Perú).' };
  }
  return { estado: 502, error: 'No se pudo generar la imagen: ' + texto.slice(0, 200) };
}

async function generarImagen(env, cuerpo) {
  var prompt = typeof cuerpo.prompt === 'string' ? cuerpo.prompt.trim() : '';
  var ancho = Number(cuerpo.ancho), alto = Number(cuerpo.alto);
  var semilla = Number(cuerpo.semilla);
  if (!prompt) return { estado: 400, error: 'Falta la descripción de la imagen' };
  if (prompt.length > MAX_CARACTERES_IMAGEN) return { estado: 400, error: 'La descripción de la imagen es demasiado larga' };
  if (!(ancho >= 256 && ancho <= 1920 && alto >= 256 && alto <= 1920 && ancho % 16 === 0 && alto % 16 === 0)) {
    return { estado: 400, error: 'Tamaño de imagen no válido' };
  }

  var form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(ancho));
  form.append('height', String(alto));
  if (Number.isInteger(semilla) && semilla >= 0 && semilla < 2147483647) form.append('seed', String(semilla));
  if (typeof cuerpo.referencia === 'string' && cuerpo.referencia) {
    if (cuerpo.referencia.length > MAX_BYTES_REFERENCIA * 1.4 || !/^[A-Za-z0-9+\/=]+$/.test(cuerpo.referencia)) {
      return { estado: 400, error: 'Imagen de referencia no válida' };
    }
    form.append('input_image_0', base64ABlob(cuerpo.referencia, 'image/jpeg'));
  }

  // FormData debe convertirse en un cuerpo con su "boundary" para Workers AI.
  var formulario = new Response(form);
  try {
    var resultado = await env.AI.run(MODELO_IMAGEN, {
      multipart: { body: formulario.body, contentType: formulario.headers.get('content-type') }
    });
    if (!resultado || !resultado.image) return { estado: 502, error: 'Cloudflare no devolvió ninguna imagen' };
    return { estado: 200, datos: { imagen: resultado.image } };
  } catch (e) {
    return errorDeImagen(e);
  }
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

    if (cuerpo.accion === 'imagen') {
      if (!env.AI) return responder({ error: 'Falta conectar Workers AI al Worker (conexión llamada AI en Settings → Bindings).' }, 500, origen);
      var imagen = await generarImagen(env, cuerpo);
      return responder(imagen.estado === 200 ? imagen.datos : { error: imagen.error }, imagen.estado, origen);
    }

    if (cuerpo.accion === 'voces') {
      var lista = await listarVoces(env.GEMINI_API_KEY);
      return responder(lista.datos, lista.estado, origen);
    }

    if (cuerpo.accion === 'voz-cloudflare') {
      if (!env.AI) return responder({ error: 'Falta conectar Workers AI al Worker (conexión llamada AI en Settings → Bindings).' }, 500, origen);
      var textoCF = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim() : '';
      if (!textoCF) return responder({ error: 'No hay texto para narrar' }, 400, origen);
      if (textoCF.length > MAX_CARACTERES_VOZ) return responder({ error: 'El fragmento de narración es demasiado largo' }, 400, origen);
      var vozCF = await generarVozCloudflare(env, textoCF);
      return responder(vozCF.estado === 200 ? vozCF.datos : { error: vozCF.error }, vozCF.estado, origen);
    }

    if (cuerpo.accion === 'voz') {
      var narracion = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim() : '';
      var voz = typeof cuerpo.voz === 'string' ? cuerpo.voz.trim() : '';
      var estilo = typeof cuerpo.estilo === 'string' ? cuerpo.estilo.trim() : '';
      if (!narracion) return responder({ error: 'No hay texto para narrar' }, 400, origen);
      if (narracion.length > MAX_CARACTERES_VOZ) return responder({ error: 'El fragmento de narración es demasiado largo' }, 400, origen);
      if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(voz)) return responder({ error: 'Voz no válida' }, 400, origen);
      if (estilo.length > MAX_CARACTERES_ESTILO) return responder({ error: 'La indicación de estilo es demasiado larga' }, 400, origen);

      var audio = await generarVoz(narracion, voz, estilo, env.GEMINI_API_KEY);
      if (audio.estado !== 200) return responder({ error: audio.error }, audio.estado, origen);
      var cabeceras = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Modelo': audio.modelo }, cabecerasCors(origen));
      return new Response(audio.cuerpo, { status: 200, headers: cabeceras });
    }

    var texto = typeof cuerpo.prompt === 'string' ? cuerpo.prompt.trim() : '';
    if (!texto) return responder({ error: 'El pedido está vacío' }, 400, origen);
    if (texto.length > MAX_CARACTERES_PEDIDO) {
      return responder({ error: 'El pedido es demasiado largo' }, 400, origen);
    }

    // Prueba cada modelo; si está ocupado, reintenta una vez y luego pasa al siguiente.
    var inicio = Date.now();
    var ultimo = { estado: 503, datos: {} };
    for (var i = 0; i < MODELOS.length; i++) {
      for (var intento = 0; intento < 2; intento++) {
        var queda = TIEMPO_TOTAL - (Date.now() - inicio);
        if (queda < 3000) break;
        var r = await pedirAGemini(MODELOS[i], texto, env.GEMINI_API_KEY, cuerpo.json === true, queda);
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
      if (TIEMPO_TOTAL - (Date.now() - inicio) < 3000) break;
    }

    var mensaje = (ultimo.datos.error && ultimo.datos.error.message) || 'Gemini no respondió';
    return responder({ error: mensaje }, ultimo.estado, origen);
  }
};
