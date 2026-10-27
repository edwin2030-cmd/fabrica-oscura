/* ==========================================================
   Publicación en YouTube con la YouTube Data API v3 oficial.
   - Inicio de sesión con Google OAuth 2.0 (Google Identity
     Services). El "ID de cliente" NO es secreto: es público.
   - El permiso (token) vive solo en la memoria de esta pestaña,
     dura como máximo 1 hora y nunca se guarda ni se envía a
     otro sitio que no sea Google.
   - El video va directo de tu navegador a YouTube (subida
     reanudable), sin pasar por ningún servidor intermedio.
   - Nada se publica sin que lo confirmes en la página.
   ========================================================== */

var YouTube = (function () {
  'use strict';

  var CLAVE_ID = 'fabricaOscura.youtube.clienteId';
  var CLAVE_HISTORIAL = 'fabricaOscura.youtube.historial.v1';
  var CLAVE_BORRADORES = 'fabricaOscura.youtube.borradores.v1';
  var MAX_HISTORIAL = 300;

  var ALCANCE_SUBIR = 'https://www.googleapis.com/auth/youtube.upload';
  var ALCANCE_LEER = 'https://www.googleapis.com/auth/youtube.readonly';
  var API = 'https://www.googleapis.com/youtube/v3/';
  var API_SUBIDA = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

  var VISIBILIDADES = { 'private': 'Privado', unlisted: 'No listado', 'public': 'Público' };
  var CATEGORIAS = { '24': 'Entretenimiento', '1': 'Cine y animación', '22': 'Gente y blogs', '27': 'Educación' };

  // Límites de YouTube para los datos del video.
  var MAX_TITULO = 100;
  var MAX_DESCRIPCION_BYTES = 5000;
  var MAX_ETIQUETAS = 500;

  var token = null;        // { valor, vence } — solo en memoria
  var canal = null;        // { id, nombre }
  var clienteToken = null;
  var cargaGoogle = null;
  var pendiente = null;    // { resolver, rechazar } del inicio de sesión en curso
  var subidaActual = null; // XMLHttpRequest en curso, para poder cancelar

  /* ---------------- Utilidades ---------------- */

  function leer(clave, porDefecto) {
    try {
      var v = JSON.parse(localStorage.getItem(clave));
      return v == null ? porDefecto : v;
    } catch (e) { return porDefecto; }
  }

  function escribir(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); return true; } catch (e) { return false; }
  }

  function esperar(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // YouTube no acepta los signos < y > en títulos, descripciones ni etiquetas.
  function limpiar(t) {
    return String(t == null ? '' : t).replace(/[<>]/g, '').replace(/\r/g, '');
  }

  function bytes(t) {
    return new TextEncoder().encode(t).length;
  }

  function recortarBytes(t, max) {
    while (bytes(t) > max) t = t.slice(0, -1);
    return t;
  }

  // Lo que ocupa una lista de etiquetas según YouTube: las comas cuentan
  // y las etiquetas con espacios llevan comillas (2 caracteres más).
  function largoEtiquetas(lista) {
    return lista.reduce(function (n, t, i) { return n + t.length + (/\s/.test(t) ? 2 : 0) + (i ? 1 : 0); }, 0);
  }

  function normalizarEtiquetas(lista) {
    var vistas = {};
    var salida = [];
    (lista || []).forEach(function (t) {
      t = limpiar(t).replace(/[#,"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
      var k = t.toLowerCase();
      if (!t || vistas[k]) return;
      if (largoEtiquetas(salida.concat(t)) > MAX_ETIQUETAS) return;
      vistas[k] = true;
      salida.push(t);
    });
    return salida;
  }

  function normalizarHashtags(lista) {
    var vistas = {};
    return (lista || []).map(function (h) {
      return '#' + limpiar(h).replace(/[#\s,.;:!¡?¿"'()]+/g, '');
    }).filter(function (h) {
      var k = h.toLowerCase();
      if (h.length < 3 || vistas[k]) return false;
      vistas[k] = true;
      return true;
    }).slice(0, 8);
  }

  /* ---------------- Configuración ---------------- */

  function clienteId() {
    return leer(CLAVE_ID, '') || '';
  }

  function idValido(id) {
    return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id);
  }

  function guardarClienteId(id) {
    id = String(id || '').trim();
    if (!idValido(id)) throw new Error('Ese no parece un ID de cliente de Google. Debe terminar en ".apps.googleusercontent.com". No pegues el "secreto del cliente".');
    if (id !== clienteId()) { clienteToken = null; desconectar(); }
    escribir(CLAVE_ID, id);
  }

  function olvidarClienteId() {
    desconectar();
    clienteToken = null;
    try { localStorage.removeItem(CLAVE_ID); } catch (e) { /* nada */ }
  }

  /* ---------------- Inicio de sesión (OAuth 2.0) ---------------- */

  function cargarGoogle() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!cargaGoogle) {
      cargaGoogle = new Promise(function (resolver, rechazar) {
        var s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = function () { resolver(); };
        s.onerror = function () { cargaGoogle = null; rechazar(new Error('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión o desactiva el bloqueador de anuncios en esta página.')); };
        document.head.appendChild(s);
      });
    }
    return cargaGoogle;
  }

  // Deja todo listo para que el botón "Conectar" abra la ventana de Google
  // al instante (los navegadores bloquean ventanas abiertas con retraso).
  function preparar() {
    if (location.protocol === 'file:') return Promise.reject(new Error('YouTube solo funciona desde tu página publicada en GitHub Pages.'));
    var id = clienteId();
    if (!id) return Promise.reject(new Error('Falta el ID de cliente de Google.'));
    return cargarGoogle().then(function () {
      if (clienteToken) return;
      clienteToken = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: ALCANCE_SUBIR + ' ' + ALCANCE_LEER,
        callback: alRecibirToken,
        error_callback: function (err) {
          if (!pendiente) return;
          var p = pendiente; pendiente = null;
          p.rechazar(new Error(err && err.type === 'popup_closed'
            ? 'Cerraste la ventana de Google sin terminar de conectar.'
            : err && err.type === 'popup_failed_to_open'
              ? 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta página.'
              : 'No se pudo abrir el inicio de sesión de Google.'));
        }
      });
    });
  }

  function listo() {
    return !!clienteToken;
  }

  function alRecibirToken(r) {
    var p = pendiente; pendiente = null;
    if (!p) return;
    if (!r || r.error || !r.access_token) {
      p.rechazar(new Error(r && r.error === 'access_denied'
        ? 'No diste permiso en la ventana de Google.'
        : 'Google no dio permiso: ' + ((r && (r.error_description || r.error)) || 'error desconocido') + '.'));
      return;
    }
    if (!google.accounts.oauth2.hasGrantedAllScopes(r, ALCANCE_SUBIR, ALCANCE_LEER)) {
      p.rechazar(new Error('Hace falta marcar las dos casillas de permiso (subir videos y ver tu cuenta de YouTube). Vuelve a conectar y márcalas.'));
      return;
    }
    token = { valor: r.access_token, vence: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
    pedirApi('channels?part=snippet&mine=true').then(function (d) {
      var c = (d.items || [])[0];
      if (!c) {
        token = null;
        throw new Error('Esta cuenta de Google no tiene canal de YouTube. Crea tu canal en youtube.com y vuelve a conectar.');
      }
      canal = { id: c.id, nombre: (c.snippet && c.snippet.title) || 'Tu canal' };
      p.resolver(canal);
    }).catch(function (e) { p.rechazar(e); });
  }

  // Debe llamarse directamente desde un clic (después de preparar()).
  function conectar() {
    if (!clienteToken) return Promise.reject(new Error('El inicio de sesión de Google aún se está cargando. Espera un momento y vuelve a pulsar.'));
    if (pendiente) pendiente.rechazar(new Error('Se reemplazó el inicio de sesión anterior.'));
    return new Promise(function (resolver, rechazar) {
      pendiente = { resolver: resolver, rechazar: rechazar };
      clienteToken.requestAccessToken({ prompt: canal ? '' : 'select_account' });
    });
  }

  function conectado() {
    return !!(token && canal && Date.now() < token.vence - 60000);
  }

  function canalActual() {
    return conectado() ? canal : null;
  }

  function desconectar() {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token.valor, function () {}); } catch (e) { /* nada */ }
    }
    token = null;
    canal = null;
  }

  /* ---------------- Errores de YouTube ---------------- */

  function mensajeDeError(estado, datos) {
    var err = (datos && datos.error) || {};
    var razon = ((err.errors || [])[0] || {}).reason || '';
    var detalle = (err.details || []).map(function (d) { return d.reason || ''; }).join(' ');
    var texto = err.message || '';

    if (estado === 401) return 'El permiso de YouTube venció (dura 1 hora). Pulsa "Conectar" otra vez y vuelve a intentarlo.';
    if (razon === 'quotaExceeded' || /quota/i.test(texto)) return 'Se acabó la cuota diaria gratuita de YouTube. Se renueva a medianoche, hora del Pacífico (2 o 3 de la mañana en Colombia o Perú).';
    if (razon === 'uploadLimitExceeded') return 'YouTube no permite más subidas hoy en este canal. Inténtalo mañana.';
    if (razon === 'youtubeSignupRequired') return 'Esta cuenta no tiene canal de YouTube. Créalo en youtube.com y vuelve a conectar.';
    if (razon === 'accessNotConfigured' || /SERVICE_DISABLED/.test(detalle) || /has not been used|is disabled/i.test(texto)) {
      return 'La "YouTube Data API v3" no está habilitada en tu proyecto de Google Cloud. Habilítala y espera unos minutos.';
    }
    if (razon === 'insufficientPermissions' || razon === 'forbidden') return 'Google no dio permiso para subir videos. Desconecta, vuelve a conectar y marca todas las casillas.';
    if (razon === 'invalidTitle') return 'YouTube rechazó el título. Revisa que no esté vacío ni pase de 100 caracteres.';
    if (razon === 'invalidDescription') return 'YouTube rechazó la descripción. Acórtala un poco.';
    if (razon === 'invalidTags') return 'YouTube rechazó las etiquetas. Quita algunas o acórtalas.';
    if (razon === 'invalidPublishAt') return 'La fecha de publicación programada no es válida. Debe ser en el futuro.';
    if (razon === 'invalidCategoryId') return 'La categoría elegida no es válida.';
    if (estado === 0) return 'Se cortó la conexión con YouTube. Revisa tu internet e inténtalo de nuevo.';
    return 'YouTube respondió con un error (' + estado + '): ' + (texto || razon || 'error desconocido') + '.';
  }

  function pedirApi(ruta) {
    if (!token) return Promise.reject(new Error('Primero conecta tu cuenta de YouTube.'));
    return fetch(API + ruta, { headers: { Authorization: 'Bearer ' + token.valor } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(mensajeDeError(r.status, d));
        return d;
      });
    }, function () {
      throw new Error(mensajeDeError(0));
    });
  }

  /* ---------------- Subida reanudable ---------------- */

  function xhr(metodo, url, cabeceras, cuerpo, alSubir) {
    return new Promise(function (resolver) {
      var x = new XMLHttpRequest();
      subidaActual = x;
      x.open(metodo, url, true);
      Object.keys(cabeceras).forEach(function (k) { x.setRequestHeader(k, cabeceras[k]); });
      if (alSubir && x.upload) x.upload.onprogress = function (e) { if (e.lengthComputable) alSubir(e.loaded); };
      x.onload = function () { resolver({ estado: x.status, x: x }); };
      x.onerror = function () { resolver({ estado: 0, x: x }); };
      x.onabort = function () { resolver({ estado: -1, x: x }); };
      x.send(cuerpo == null ? null : cuerpo);
    });
  }

  function json(texto) {
    try { return JSON.parse(texto); } catch (e) { return {}; }
  }

  function cuerpoVideo(m) {
    var estado = {
      privacyStatus: m.publicarEn ? 'private' : m.privacidad,
      selfDeclaredMadeForKids: !!m.paraNinos,
      containsSyntheticMedia: !!m.sintetico,
      embeddable: true,
      license: 'youtube'
    };
    if (m.publicarEn) estado.publishAt = m.publicarEn;
    return {
      snippet: {
        title: m.titulo,
        description: m.descripcion,
        tags: m.etiquetas,
        categoryId: m.categoria,
        defaultLanguage: 'es',
        defaultAudioLanguage: 'es'
      },
      status: estado
    };
  }

  // Revisa y ajusta los datos antes de enviarlos. Lanza error si falta algo.
  function validar(m) {
    var titulo = limpiar(m.titulo).replace(/\s+/g, ' ').trim();
    if (!titulo) throw new Error('Escribe un título para el video.');
    if (titulo.length > MAX_TITULO) throw new Error('El título pasa de ' + MAX_TITULO + ' caracteres. Acórtalo.');
    var descripcion = limpiar(m.descripcion).trim();
    if (bytes(descripcion) > MAX_DESCRIPCION_BYTES) throw new Error('La descripción es demasiado larga para YouTube. Acórtala.');
    var etiquetas = normalizarEtiquetas(m.etiquetas);
    if (!VISIBILIDADES[m.privacidad]) throw new Error('Elige la visibilidad del video.');
    if (!CATEGORIAS[m.categoria]) throw new Error('Elige una categoría.');
    var publicarEn = '';
    if (m.publicarEn) {
      var f = new Date(m.publicarEn);
      if (isNaN(f.getTime())) throw new Error('La fecha programada no es válida.');
      if (f.getTime() < Date.now() + 15 * 60000) throw new Error('La fecha programada debe ser al menos 15 minutos en el futuro.');
      publicarEn = f.toISOString();
    }
    return {
      titulo: titulo, descripcion: descripcion, etiquetas: etiquetas, categoria: m.categoria,
      privacidad: m.privacidad, publicarEn: publicarEn, paraNinos: !!m.paraNinos, sintetico: !!m.sintetico
    };
  }

  // Sube el archivo. alProgreso(fraccion, mensaje). Devuelve el video creado.
  function subir(archivo, datos, alProgreso) {
    var m;
    try { m = validar(datos); } catch (e) { return Promise.reject(e); }
    if (!conectado()) return Promise.reject(new Error('El permiso de YouTube venció o no estás conectado. Pulsa "Conectar" otra vez.'));
    if (!archivo || !archivo.size) return Promise.reject(new Error('Elige el video MP4 que quieres subir.'));

    var total = archivo.size;
    var cancelado = false;
    var aviso = function (f, t) { if (alProgreso) alProgreso(f, t); };
    var mb = function (b) { return (b / 1048576).toFixed(1); };

    aviso(0, 'Preparando la subida en YouTube…');
    return xhr('POST', API_SUBIDA, {
      Authorization: 'Bearer ' + token.valor,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(total),
      'X-Upload-Content-Type': 'video/mp4'
    }, JSON.stringify(cuerpoVideo(m))).then(function (r) {
      if (r.estado === -1) throw new Error('Subida cancelada.');
      if (r.estado !== 200) throw new Error(mensajeDeError(r.estado, json(r.x.responseText)));
      var destino = r.x.getResponseHeader('Location');
      if (!destino) throw new Error('YouTube no devolvió la dirección de subida. Inténtalo de nuevo.');

      var reintentos = 0;

      // Pregunta a YouTube cuántos bytes ya recibió (para reanudar tras un corte).
      function consultar() {
        return xhr('PUT', destino, { 'Content-Range': 'bytes */' + total }, null).then(function (q) {
          if (q.estado === 200 || q.estado === 201) return { hecho: json(q.x.responseText) };
          if (q.estado === 308) {
            var rango = /bytes=0-(\d+)/.exec(q.x.getResponseHeader('Range') || '');
            return { desde: rango ? Number(rango[1]) + 1 : 0 };
          }
          return { fallo: q };
        });
      }

      function enviar(desde) {
        var cab = { 'Content-Type': 'video/mp4' };
        if (desde > 0) cab['Content-Range'] = 'bytes ' + desde + '-' + (total - 1) + '/' + total;
        return xhr('PUT', destino, cab, desde > 0 ? archivo.slice(desde) : archivo, function (cargado) {
          var hecho = desde + cargado;
          aviso(Math.min(0.99, hecho / total), 'Subiendo… ' + mb(hecho) + ' de ' + mb(total) + ' MB');
        }).then(function (s) {
          if (s.estado === -1 || cancelado) throw new Error('Subida cancelada.');
          if (s.estado === 200 || s.estado === 201) return json(s.x.responseText);
          var pasajero = s.estado === 0 || s.estado === 308 || s.estado >= 500;
          if (!pasajero || reintentos >= 5) throw new Error(mensajeDeError(s.estado, json(s.x.responseText)));
          reintentos++;
          var espera = 2000 * Math.pow(2, reintentos - 1);
          aviso(desde / total, 'Se cortó la conexión. Reintentando en ' + Math.round(espera / 1000) + ' s (intento ' + reintentos + ' de 5)…');
          return esperar(espera).then(consultar).then(function (q) {
            if (q.hecho) return q.hecho;
            if (q.fallo) {
              if (q.fallo.estado === -1) throw new Error('Subida cancelada.');
              if (q.fallo.estado === 0 || q.fallo.estado >= 500) return enviar(desde);
              throw new Error(mensajeDeError(q.fallo.estado, json(q.fallo.x.responseText)));
            }
            return enviar(q.desde);
          });
        });
      }

      return enviar(0);
    }).then(function (video) {
      if (!video || !video.id) throw new Error('YouTube terminó la subida pero no devolvió el video. Revisa YouTube Studio.');
      aviso(1, '¡Subida terminada!');
      return {
        id: video.id,
        privacidad: (video.status && video.status.privacyStatus) || m.privacidad,
        publicarEn: m.publicarEn,
        titulo: m.titulo
      };
    }).finally(function () {
      subidaActual = null;
    });
  }

  function cancelar() {
    if (subidaActual) subidaActual.abort();
  }

  // Estado del video en YouTube (procesado, rechazado, visibilidad…).
  function estado(videoId) {
    return pedirApi('videos?part=status,processingDetails&id=' + encodeURIComponent(videoId)).then(function (d) {
      var v = (d.items || [])[0];
      if (!v) return 'YouTube no encuentra este video. Puede que lo hayas borrado o que sea de otro canal.';
      var s = v.status || {};
      var subida = { uploaded: 'subido, procesándose', processed: 'procesado y listo', failed: 'falló al procesarse', rejected: 'rechazado', deleted: 'borrado' }[s.uploadStatus] || s.uploadStatus || '';
      var partes = ['Estado: ' + subida, 'Visibilidad: ' + (VISIBILIDADES[s.privacyStatus] || s.privacyStatus || '?')];
      if (s.publishAt) partes.push('Se publicará el ' + new Date(s.publishAt).toLocaleString('es'));
      if (s.rejectionReason) partes.push('Motivo del rechazo: ' + s.rejectionReason);
      if (s.failureReason) partes.push('Motivo del fallo: ' + s.failureReason);
      return partes.join(' · ');
    });
  }

  /* ---------------- Título, descripción y etiquetas con IA ---------------- */

  function generarDatos(proyecto, duracionSegundos) {
    var narracion = proyecto.escenas.map(function (e) { return e.narracion.trim(); }).filter(Boolean).join('\n').slice(0, 6000);
    var minutos = duracionSegundos ? Math.max(1, Math.round(duracionSegundos / 60)) : 0;
    var prompt = [
      'Eres experto en YouTube para un canal en español latinoamericano de historias de terror y misterio narradas.',
      'Crea los datos para publicar este video. Reglas:',
      '- "titulo": atractivo e intrigante, de 40 a 70 caracteres, sin mentir sobre el contenido, sin todo en mayúsculas, sin hashtags, sin los signos < ni >.',
      '- "descripcion": 3 párrafos cortos separados por una línea en blanco: un gancho que dé ganas de verlo, una sinopsis SIN revelar el giro final, y una invitación a suscribirse y comentar. Sin enlaces inventados, sin hashtags, sin los signos < ni >. Máximo 900 caracteres.',
      '- "etiquetas": de 10 a 15 etiquetas de búsqueda en español (frases cortas, sin #).',
      '- "hashtags": de 3 a 5 hashtags en español, cada uno de una sola palabra con #.',
      'Responde SOLO con un objeto JSON válido: {"titulo": "...", "descripcion": "...", "etiquetas": ["..."], "hashtags": ["#..."]}',
      '',
      'Título de trabajo: ' + proyecto.titulo,
      'Subgénero: ' + (Ideas.SUBGENEROS[proyecto.subgenero] || 'terror'),
      minutos ? 'Duración del video: unos ' + minutos + ' minutos' : '',
      'Premisa: ' + (proyecto.descripcion.trim() || '(sin premisa)').slice(0, 1500),
      '',
      'Narración del video (puede estar recortada):',
      narracion || '(sin narración)'
    ].filter(function (l, i, a) { return l !== '' || a[i - 1] !== ''; }).join('\n');

    return IA.pedir(prompt, { json: true }).then(function (texto) {
      var d = IA.leerJSON(texto);
      var titulo = limpiar(d.titulo).replace(/\s+/g, ' ').trim().slice(0, MAX_TITULO);
      if (!titulo) throw new Error('Gemini no respondió en el formato esperado. Intenta de nuevo.');
      var hashtags = normalizarHashtags(Array.isArray(d.hashtags) ? d.hashtags : []);
      var descripcion = limpiar(d.descripcion).trim();
      if (hashtags.length) descripcion += '\n\n' + hashtags.join(' ');
      return {
        titulo: titulo,
        descripcion: recortarBytes(descripcion, MAX_DESCRIPCION_BYTES),
        etiquetas: normalizarEtiquetas(Array.isArray(d.etiquetas) ? d.etiquetas : [])
      };
    });
  }

  /* ---------------- Borradores e historial ---------------- */

  function borrador(proyectoId) {
    return leer(CLAVE_BORRADORES, {})[proyectoId] || null;
  }

  function guardarBorrador(proyectoId, datos) {
    var todos = leer(CLAVE_BORRADORES, {});
    todos[proyectoId] = datos;
    escribir(CLAVE_BORRADORES, todos);
  }

  function borrarBorrador(proyectoId) {
    var todos = leer(CLAVE_BORRADORES, {});
    delete todos[proyectoId];
    escribir(CLAVE_BORRADORES, todos);
  }

  function historial() {
    var h = leer(CLAVE_HISTORIAL, []);
    return Array.isArray(h) ? h : [];
  }

  function registrar(entrada) {
    var h = historial();
    h.unshift(entrada);
    escribir(CLAVE_HISTORIAL, h.slice(0, MAX_HISTORIAL));
  }

  function subidasDeHoy() {
    var hoy = new Date().toDateString();
    return historial().filter(function (e) { return new Date(e.fecha).toDateString() === hoy; }).length;
  }

  function enlace(videoId) {
    return 'https://youtu.be/' + encodeURIComponent(videoId);
  }

  function enlaceStudio(videoId) {
    return 'https://studio.youtube.com/video/' + encodeURIComponent(videoId) + '/edit';
  }

  return {
    VISIBILIDADES: VISIBILIDADES,
    CATEGORIAS: CATEGORIAS,
    MAX_TITULO: MAX_TITULO,
    MAX_ETIQUETAS: MAX_ETIQUETAS,
    clienteId: clienteId,
    guardarClienteId: guardarClienteId,
    olvidarClienteId: olvidarClienteId,
    preparar: preparar,
    listo: listo,
    conectar: conectar,
    conectado: conectado,
    canal: canalActual,
    desconectar: desconectar,
    subir: subir,
    cancelar: cancelar,
    estado: estado,
    generarDatos: generarDatos,
    largoEtiquetas: largoEtiquetas,
    normalizarEtiquetas: normalizarEtiquetas,
    borrador: borrador,
    guardarBorrador: guardarBorrador,
    borrarBorrador: borrarBorrador,
    historial: historial,
    registrar: registrar,
    subidasDeHoy: subidasDeHoy,
    enlace: enlace,
    enlaceStudio: enlaceStudio
  };
})();
