/* ==========================================================
   Conexión con Gemini a través del intermediario de Cloudflare.
   Aquí NO hay ninguna clave: la clave vive como secreto en
   Cloudflare. Solo funciona desde la página publicada en
   GitHub Pages (el intermediario rechaza otros orígenes).
   ========================================================== */

var IA = (function () {
  'use strict';

  var URL_INTERMEDIARIO = 'https://fabricadvideos.d-e-knovacore.workers.dev/';
  var TIEMPO_MAXIMO = 90000; // 90 segundos

  // Convierte los errores técnicos en mensajes fáciles de entender.
  function mensajeDeError(estado, texto) {
    texto = texto || '';
    if (estado === 503 || /demand|overloaded|unavailable/i.test(texto)) {
      return 'Gemini está muy ocupado ahora mismo. Intenta de nuevo en unos minutos.';
    }
    if (estado === 429 || /quota|rate/i.test(texto)) {
      return 'Se alcanzó el límite gratuito de Gemini. Vuelve a intentarlo más tarde o mañana.';
    }
    if (estado === 524 || estado === 504) {
      return 'Gemini tardó demasiado en responder. Intenta de nuevo.';
    }
    return 'No se pudo generar el texto: ' + (texto || 'error desconocido') + '.';
  }

  // opciones.json: pide a Gemini que responda solo con JSON.
  function pedir(prompt, opciones) {
    if (location.protocol === 'file:') {
      return Promise.reject(new Error('La IA solo funciona desde tu página publicada en GitHub Pages, no abriendo el archivo en tu computadora.'));
    }
    var control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var temporizador = control ? setTimeout(function () { control.abort(); }, TIEMPO_MAXIMO) : null;

    return fetch(URL_INTERMEDIARIO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, json: !!(opciones && opciones.json) }),
      signal: control ? control.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (datos) {
        if (!r.ok || datos.error) throw new Error(mensajeDeError(r.status, datos.error));
        if (!datos.texto || !datos.texto.trim()) throw new Error('Gemini respondió vacío. Intenta de nuevo.');
        return datos.texto.trim();
      });
    }, function (e) {
      if (e && e.name === 'AbortError') throw new Error(mensajeDeError(524));
      throw new Error('No se pudo conectar con el intermediario. Revisa tu conexión a internet.');
    }).finally(function () {
      if (temporizador) clearTimeout(temporizador);
    });
  }

  // Extrae el primer objeto JSON de la respuesta (Gemini a veces añade ```json).
  function leerJSON(texto) {
    var inicio = texto.indexOf('{');
    var fin = texto.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio) throw new Error('Gemini no respondió en el formato esperado. Intenta de nuevo.');
    try {
      return JSON.parse(texto.slice(inicio, fin + 1));
    } catch (e) {
      throw new Error('Gemini no respondió en el formato esperado. Intenta de nuevo.');
    }
  }

  function generarIdea(subgenero) {
    var claves = Object.keys(Ideas.SUBGENEROS);
    var clave = Ideas.SUBGENEROS[subgenero] ? subgenero : claves[Math.floor(Math.random() * claves.length)];

    var prompt = [
      'Eres guionista de un canal de YouTube en español de historias de terror y misterio.',
      'Inventa una idea ORIGINAL para un video del subgénero "' + Ideas.SUBGENEROS[clave] + '".',
      'Evita clichés gastados y no copies historias, películas ni creepypastas conocidas.',
      'Responde SOLO con un objeto JSON válido, sin texto antes ni después, con estas claves (todas en español):',
      '{',
      '  "titulo": "título corto y llamativo para YouTube",',
      '  "protagonista": "quién es el protagonista, en una frase",',
      '  "lugar": "dónde ocurre, en una frase",',
      '  "premisa": "de qué trata la historia, en dos o tres frases",',
      '  "giro": "giro final sorprendente, en una o dos frases",',
      '  "gancho": "frase del narrador para los primeros 15 segundos que atrape al espectador",',
      '  "tono": "tono y ritmo de la narración, en una frase",',
      '  "duracion": "duración sugerida, por ejemplo 10 a 12 minutos"',
      '}'
    ].join('\n');

    return pedir(prompt).then(function (texto) {
      var d = leerJSON(texto);
      var idea = { subgenero: clave, ia: true };
      ['titulo', 'protagonista', 'lugar', 'premisa', 'giro', 'gancho', 'tono', 'duracion'].forEach(function (k) {
        idea[k] = typeof d[k] === 'string' ? d[k].trim() : '';
      });
      if (!idea.titulo || !idea.premisa) throw new Error('Gemini no respondió en el formato esperado. Intenta de nuevo.');
      return idea;
    });
  }

  // Escribe la narración (voz en off) de una escena usando el contexto del proyecto.
  // palabras: largo aproximado deseado (por defecto, unas 200).
  // corto: true si es un Short (menos de 3 minutos), con ritmo rápido.
  function escribirNarracion(proyecto, indice, palabras, corto) {
    var escenas = proyecto.escenas;
    var e = escenas[indice];
    var anterior = indice > 0 ? escenas[indice - 1].narracion.trim() : '';
    var objetivo = Math.max(corto ? 10 : 80, Math.min(700, Math.round(palabras || 200)));
    var esUltima = indice === escenas.length - 1;

    var partes = [
      'Eres el narrador de un canal de YouTube en español de historias de terror y misterio.',
      'Escribe SOLO el texto de la narración (voz en off) de UNA escena del guion.',
      'Sin títulos, sin acotaciones, sin indicaciones de cámara ni de sonido, sin comillas alrededor.',
      corto
        ? 'Largo: entre ' + Math.round(objetivo * 0.8) + ' y ' + objetivo + ' palabras. NUNCA pases de ' + objetivo + ' palabras: el video tiene un tiempo máximo.'
        : 'Largo: unas ' + objetivo + ' palabras (entre ' + Math.round(objetivo * 0.85) + ' y ' + Math.round(objetivo * 1.15) + '). Es importante respetar ese largo.',
      'Frases claras para leer en voz alta, con tensión, atmósfera y detalles concretos.',
      corto ? 'Es un YouTube Short (video vertical de menos de ' + (palabras * escenas.length > 160 ? 'tres minutos' : 'un minuto') + '): ritmo muy rápido, frases cortas, nada de relleno.' +
        (indice === 0 ? ' La primera frase debe atrapar en 2 segundos.' : '') : '',
      esUltima ? 'Es la última escena: cierra la historia con un final inquietante.' : 'No cierres la historia todavía: termina dejando tensión para la siguiente escena.',
      '',
      'Título del video: ' + proyecto.titulo,
      'Subgénero: ' + (Ideas.SUBGENEROS[proyecto.subgenero] || 'terror'),
      'Premisa del video: ' + (proyecto.descripcion.trim() || '(sin premisa)'),
      '',
      'Esta es la escena ' + (indice + 1) + ' de ' + escenas.length + '.',
      'Título de la escena: ' + (e.titulo.trim() || '(sin título)')
    ];
    if (e.notas.trim()) partes.push('Notas del guionista para esta escena: ' + e.notas.trim());
    if (e.narracion.trim()) partes.push('Borrador actual (úsalo como base, mejóralo y ajústalo al largo pedido): ' + e.narracion.trim().slice(0, 1200));
    if (anterior) partes.push('', 'Narración de la escena anterior (continúa desde aquí sin repetirla): ' + anterior.slice(-1000));

    var pedido = pedir(partes.join('\n').slice(0, 3900));
    return corto ? pedido.then(function (t) { return recortarFrases(t, Math.round(objetivo * 1.05)); }) : pedido;
  }

  // En los Shorts, si Gemini escribe de más, se quitan frases del final (nunca a media frase).
  function recortarFrases(texto, maxPalabras) {
    var contar = function (t) { return t.trim() ? t.trim().split(/\s+/).length : 0; };
    if (contar(texto) <= maxPalabras) return texto;
    var frases = texto.match(/[^.!?…]+[.!?…]+["»”]?\s*/g) || [texto];
    var salida = '';
    for (var i = 0; i < frases.length; i++) {
      if (salida && contar(salida + frases[i]) > maxPalabras) break;
      salida += frases[i];
    }
    return salida.trim();
  }

  return {
    pedir: pedir,
    leerJSON: leerJSON,
    generarIdea: generarIdea,
    escribirNarracion: escribirNarracion
  };
})();
