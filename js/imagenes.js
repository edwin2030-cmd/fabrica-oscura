/* ==========================================================
   Imágenes con IA para cada escena.
   1) Gemini analiza la historia y crea un "plan visual":
      personajes, lugares, estilo y una descripción por toma.
   2) Workers AI de Cloudflare (FLUX.2) dibuja cada toma.
   Las imágenes se guardan en este navegador (IndexedDB).
   Aquí NO hay ninguna clave.
   ========================================================== */

var Imagenes = (function () {
  'use strict';

  var URL_INTERMEDIARIO = 'https://fabricadvideos.d-e-knovacore.workers.dev/';
  var TIEMPO_MAXIMO = 100000;
  var MAX_HISTORIA = 20000;     // caracteres de la historia que se envían a Gemini
  var MAX_PROMPT = 1900;        // caracteres por imagen (el intermediario acepta 2000)
  var LADO_REFERENCIA = 448;    // la imagen de referencia debe medir menos de 512 px

  var FORMATOS = {
    '16:9': { nombre: '16:9 YouTube (1024×576)', ancho: 1024, alto: 576 },
    '16:9-hd': { nombre: '16:9 YouTube HD (1280×720, gasta más cuota)', ancho: 1280, alto: 720 },
    '9:16': { nombre: '9:16 Shorts (576×1024)', ancho: 576, alto: 1024 },
    '1:1': { nombre: '1:1 Cuadrada (1024×1024)', ancho: 1024, alto: 1024 }
  };

  var ESTILO_BASE = 'Cinematic still from a dark horror mystery film, photorealistic, moody low-key lighting, ' +
    'deep shadows, desaturated cold colors, subtle film grain, shallow depth of field, 35mm lens, atmospheric fog, ' +
    'unsettling and eerie mood, highly detailed, no text, no letters, no watermark.';

  /* ---------------- Almacenamiento (js/almacen.js) ---------------- */

  function cargar(proyectoId) {
    return Almacen.obtener('imagenes', proyectoId);
  }

  function guardar(galeria) {
    return Almacen.poner('imagenes', galeria);
  }

  function borrar(proyectoId) {
    return Almacen.borrar('imagenes', proyectoId);
  }

  /* ---------------- Plan visual con Gemini ---------------- */

  function idAzar() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function planificar(proyecto, porEscena) {
    var escenas = proyecto.escenas.map(function (e, i) {
      return { num: i + 1, id: e.id, titulo: e.titulo.trim(), texto: (e.narracion.trim() || e.notas.trim()) };
    }).filter(function (e) { return e.texto; });
    if (!escenas.length) return Promise.reject(new Error('Ninguna escena tiene narración. Escribe el guion primero.'));

    var historia = escenas.map(function (e) {
      return '[ESCENA ' + e.num + (e.titulo ? ' — ' + e.titulo : '') + ']\n' + e.texto;
    }).join('\n\n');
    var maxPorEscena = Math.floor(MAX_HISTORIA / escenas.length);
    if (historia.length > MAX_HISTORIA) {
      historia = escenas.map(function (e) {
        return '[ESCENA ' + e.num + ']\n' + e.texto.slice(0, maxPorEscena);
      }).join('\n\n');
    }

    var prompt = [
      'Eres director de arte de un canal de YouTube de historias de terror y misterio.',
      'Analiza la historia y prepara las imágenes que acompañarán la narración.',
      'Crea exactamente ' + porEscena + ' toma(s) visual(es) por cada escena, en orden, mostrando momentos distintos de esa escena.',
      'Mantén la coherencia: define una vez a los personajes y lugares principales con rasgos físicos concretos y fijos',
      '(edad, cara, pelo, ropa, colores) y reutilízalos igual en todas las tomas.',
      'Evita sangre explícita, gore y violencia gráfica: sugiere el miedo con sombras, siluetas, atmósfera y detalles inquietantes.',
      'Responde SOLO con JSON válido con esta forma:',
      '{',
      '  "personajes": [{ "nombre": "nombre", "rasgos": "physical description in English, 25-40 words" }],',
      '  "lugares": [{ "nombre": "nombre", "rasgos": "visual description in English, 20-35 words" }],',
      '  "estilo": "overall visual style and color palette in English, 15-25 words",',
      '  "tomas": [{ "escena": 1, "descripcion": "qué se ve, en español, una o dos frases", ' +
        '"prompt": "image prompt in English, 40-70 words: shot type, camera angle, subject, action, setting, lighting", ' +
        '"personajes": ["nombres que aparecen"], "lugar": "nombre del lugar" }]',
      '}',
      '',
      'Título: ' + proyecto.titulo,
      'Premisa: ' + (proyecto.descripcion.trim().slice(0, 800) || '(sin premisa)'),
      '',
      'HISTORIA:',
      historia
    ].join('\n');

    return IA.pedir(prompt, { json: true }).then(function (texto) {
      var d = IA.leerJSON(texto);
      var tomas = Array.isArray(d.tomas) ? d.tomas : [];
      var porNumero = {};
      escenas.forEach(function (e) { porNumero[e.num] = e; });
      tomas = tomas.map(function (t) {
        var e = porNumero[Number(t.escena)];
        if (!e || typeof t.prompt !== 'string' || !t.prompt.trim()) return null;
        return {
          id: idAzar(),
          escenaId: e.id,
          descripcion: String(t.descripcion || '').trim(),
          prompt: t.prompt.trim(),
          personajes: Array.isArray(t.personajes) ? t.personajes.map(String) : [],
          lugar: String(t.lugar || ''),
          imagen: null,
          error: ''
        };
      }).filter(Boolean);
      if (!tomas.length) throw new Error('Gemini no respondió en el formato esperado. Intenta de nuevo.');
      var lista = function (x) {
        return (Array.isArray(x) ? x : []).filter(function (p) { return p && p.nombre && p.rasgos; })
          .map(function (p) { return { nombre: String(p.nombre), rasgos: String(p.rasgos) }; });
      };
      return {
        biblia: { personajes: lista(d.personajes), lugares: lista(d.lugares), estilo: String(d.estilo || '') },
        tomas: tomas
      };
    });
  }

  /* ---------------- Generación de imágenes ---------------- */

  function mismoNombre(a, b) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  // Une estilo, personajes y lugar fijos con la toma, para que todas se parezcan.
  function construirPrompt(toma, biblia, conReferencia) {
    var partes = [];
    if (conReferencia) partes.push('Use image 0 only as reference for the characters\' appearance and the visual style. Create a completely new composition:');
    partes.push(toma.prompt);
    biblia.personajes.forEach(function (p) {
      var aparece = toma.personajes.some(function (n) { return mismoNombre(n, p.nombre); });
      if (aparece) partes.push(p.nombre + ': ' + p.rasgos);
    });
    biblia.lugares.forEach(function (l) {
      if (toma.lugar && mismoNombre(toma.lugar, l.nombre)) partes.push('Setting: ' + l.rasgos);
    });
    if (biblia.estilo) partes.push(biblia.estilo);
    partes.push(ESTILO_BASE);
    return partes.join(' ').replace(/\s+/g, ' ').slice(0, MAX_PROMPT);
  }

  function mensajeDeError(estado, texto) {
    texto = texto || '';
    if (estado === 422 || estado === 429) return texto;
    if (estado === 504 || estado === 524) return 'Cloudflare tardó demasiado en crear la imagen. Intenta de nuevo.';
    return texto || 'No se pudo generar la imagen.';
  }

  function enviar(cuerpo) {
    if (location.protocol === 'file:') {
      return Promise.reject(new Error('Las imágenes solo funcionan desde tu página publicada en GitHub Pages.'));
    }
    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, TIEMPO_MAXIMO);
    return fetch(URL_INTERMEDIARIO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: control.signal
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (datos) {
        if (!r.ok || datos.error) {
          var err = new Error(mensajeDeError(r.status, datos.error));
          err.estado = r.status;
          throw err;
        }
        return datos;
      });
    }, function (e) {
      if (e && e.name === 'AbortError') throw new Error(mensajeDeError(504));
      throw new Error('No se pudo conectar con el intermediario. Revisa tu conexión a internet.');
    }).finally(function () { clearTimeout(temporizador); });
  }

  function base64ABlob(b64) {
    var binario = atob(b64);
    var bytes = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    var tipo = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
      : bytes[0] === 0x52 && bytes[1] === 0x49 ? 'image/webp' : 'image/jpeg';
    return new Blob([bytes], { type: tipo });
  }

  // Reduce una imagen a menos de 512 px (requisito de la referencia) y la pasa a JPEG en base64.
  function referenciaDesde(blob) {
    return new Promise(function (resolver, rechazar) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var escala = Math.min(1, LADO_REFERENCIA / Math.max(img.width, img.height));
        var lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
        URL.revokeObjectURL(url);
        resolver(lienzo.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rechazar(new Error('No se pudo leer la imagen de referencia.')); };
      img.src = url;
    });
  }

  // Genera una toma. Si el filtro la bloquea, reintenta una vez con otra semilla.
  // semilla: opcional; por defecto la del proyecto (ayuda a que las imágenes se parezcan entre sí).
  function generarToma(toma, galeria, referencia, semilla) {
    var formato = FORMATOS[galeria.formato] || FORMATOS['16:9'];
    var pedirUna = function (semilla) {
      return enviar({
        accion: 'imagen',
        prompt: construirPrompt(toma, galeria.biblia, !!referencia),
        ancho: formato.ancho,
        alto: formato.alto,
        semilla: semilla,
        referencia: referencia || undefined
      });
    };
    return pedirUna(semilla == null ? galeria.semilla : semilla).catch(function (err) {
      if (err.estado !== 422) throw err;
      return pedirUna(Math.floor(Math.random() * 2000000000));
    }).then(function (datos) {
      if (!datos.imagen) throw new Error('Cloudflare no devolvió ninguna imagen.');
      return base64ABlob(datos.imagen);
    });
  }

  // Primera imagen ya generada, para usarla de referencia de personajes y estilo.
  function primeraImagen(galeria, exceptoId) {
    var t = galeria.tomas.find(function (x) { return x.imagen && x.id !== exceptoId; });
    return t ? t.imagen : null;
  }

  function nuevaGaleria(proyectoId, formato, plan) {
    return {
      proyectoId: proyectoId,
      formato: FORMATOS[formato] ? formato : '16:9',
      semilla: Math.floor(Math.random() * 2000000000),
      biblia: plan.biblia,
      tomas: plan.tomas,
      creado: new Date().toISOString()
    };
  }

  return {
    FORMATOS: FORMATOS,
    cargar: cargar,
    guardar: guardar,
    borrar: borrar,
    planificar: planificar,
    nuevaGaleria: nuevaGaleria,
    generarToma: generarToma,
    referenciaDesde: referenciaDesde,
    primeraImagen: primeraImagen,
    construirPrompt: construirPrompt
  };
})();
