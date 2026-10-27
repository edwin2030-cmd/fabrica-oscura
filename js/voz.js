/* ==========================================================
   Voces con IA (texto a voz de Gemini) a través del
   intermediario de Cloudflare. Aquí NO hay ninguna clave.
   El audio llega en WAV (24 kHz) y se convierte a MP3 en el
   propio navegador con lamejs (js/vendor/lame.min.js).
   Si Gemini alcanza su límite, se usa la voz de respaldo de
   Cloudflare (MeloTTS), que llega en MP3 y se pasa a 24 kHz.
   ========================================================== */

var Voz = (function () {
  'use strict';

  var URL_INTERMEDIARIO = 'https://fabricadvideos.d-e-knovacore.workers.dev/';
  var TIEMPO_MAXIMO = 110000;          // por fragmento
  var MAX_FRAGMENTO_GEMINI = 2400;     // caracteres por pedido a Gemini (menos pedidos = menos límites)
  var MAX_FRAGMENTO_CF = 1000;         // caracteres por pedido a Cloudflare
  var FRECUENCIA = 24000;              // muestras por segundo de todo el audio
  var PAUSA_ENTRE_ESCENAS = 0.8;       // segundos de silencio entre escenas
  var ESPERA_POR_LIMITE = 60;          // segundos de espera si se alcanza el límite por minuto
  var REINTENTOS_POR_LIMITE = 1;       // después se cambia a la voz de Cloudflare
  var CLAVE_PREFERENCIAS = 'fabricaOscura.voz.v1';

  // Voces básicas de Gemini, por si la lista de voces latinoamericanas no carga.
  // Hablan español; el acento latino se pide en la indicación de estilo.
  var VOCES_RESPALDO = [
    { id: 'Charon', nombre: 'Charon', genero: 'male', descripcion: 'informativa, ideal para narrar' },
    { id: 'Algenib', nombre: 'Algenib', genero: 'male', descripcion: 'áspera y grave' },
    { id: 'Enceladus', nombre: 'Enceladus', genero: 'male', descripcion: 'susurrante, con aire' },
    { id: 'Iapetus', nombre: 'Iapetus', genero: 'male', descripcion: 'clara' },
    { id: 'Orus', nombre: 'Orus', genero: 'male', descripcion: 'firme' },
    { id: 'Kore', nombre: 'Kore', genero: 'female', descripcion: 'firme' },
    { id: 'Gacrux', nombre: 'Gacrux', genero: 'female', descripcion: 'madura' },
    { id: 'Achernar', nombre: 'Achernar', genero: 'female', descripcion: 'suave' },
    { id: 'Vindemiatrix', nombre: 'Vindemiatrix', genero: 'female', descripcion: 'delicada' },
    { id: 'Sulafat', nombre: 'Sulafat', genero: 'female', descripcion: 'cálida' }
  ];

  // Voz de respaldo de Cloudflare: sin límite por minuto, una sola voz y sin estilos.
  var VOZ_CLOUDFLARE = {
    id: 'cloudflare', nombre: 'Voz de Cloudflare', genero: 'cloudflare', proveedor: 'cloudflare',
    descripcion: 'español, sin límite por minuto (no usa los estilos)'
  };

  var ACENTO_LATINO = ' Habla en español latinoamericano neutro.';

  var ESTILOS = {
    narrador: { nombre: 'Narrador de terror (grave y pausado)', texto: 'Narrador de historias de terror: voz grave, pausada y misteriosa, con silencios dramáticos.' },
    susurro: { nombre: 'Susurro inquietante', texto: 'Susurrando en voz baja, tensa e inquietante, como contando un secreto prohibido.' },
    tension: { nombre: 'Tensión creciente', texto: 'Narración tensa que acelera poco a poco, transmitiendo miedo y urgencia.' },
    documental: { nombre: 'Documental de misterio', texto: 'Tono de documental de misterio: serio, sobrio y creíble.' },
    melancolico: { nombre: 'Melancólico', texto: 'Voz melancólica y triste, lenta, con un fondo inquietante.' }
  };

  var FRASE_PRUEBA = 'Esa noche escuché tres golpes en la puerta. Eran las tres de la mañana… y yo vivía solo.';

  /* ---------------- Preferencias ---------------- */

  function leerPreferencias() {
    try {
      var p = JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) || '{}');
      return { voz: typeof p.voz === 'string' ? p.voz : '', estilo: ESTILOS[p.estilo] ? p.estilo : 'narrador' };
    } catch (e) {
      return { voz: '', estilo: 'narrador' };
    }
  }

  function guardarPreferencias(p) {
    try { localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(p)); } catch (e) { /* sin espacio: no pasa nada */ }
  }

  /* ---------------- Comunicación con el intermediario ---------------- */

  function mensajeDeError(estado, texto) {
    texto = texto || '';
    if (estado === 503 || /demand|overloaded|unavailable/i.test(texto)) return 'Gemini está muy ocupado ahora mismo. Intenta de nuevo en unos minutos.';
    if (estado === 429 || /quota|rate|exhausted/i.test(texto)) return 'Se alcanzó el límite gratuito de voz de Gemini. Vuelve a intentarlo más tarde o mañana.';
    if (estado === 504 || estado === 524) return 'Gemini tardó demasiado en generar el audio. Intenta de nuevo.';
    return 'No se pudo generar el audio: ' + (texto || 'error desconocido') + '.';
  }

  function enviar(cuerpo) {
    if (location.protocol === 'file:') {
      return Promise.reject(new Error('Las voces solo funcionan desde tu página publicada en GitHub Pages, no abriendo el archivo en tu computadora.'));
    }
    var control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var temporizador = control ? setTimeout(function () { control.abort(); }, TIEMPO_MAXIMO) : null;

    return fetch(URL_INTERMEDIARIO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: control ? control.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (datos) {
        if (!r.ok || datos.error) {
          var msg = typeof datos.error === 'string' ? datos.error : (datos.error && datos.error.message);
          var err = new Error(mensajeDeError(r.status, msg));
          err.estado = r.status;
          throw err;
        }
        return datos;
      });
    }, function (e) {
      if (e && e.name === 'AbortError') {
        var lento = new Error(mensajeDeError(504));
        lento.estado = 504;
        throw lento;
      }
      throw new Error('No se pudo conectar con el intermediario. Revisa tu conexión a internet.');
    }).finally(function () {
      if (temporizador) clearTimeout(temporizador);
    });
  }

  // Lista de voces: primero las latinoamericanas de Gemini, luego las de respaldo.
  function cargarVoces() {
    return enviar({ accion: 'voces' }).then(function (datos) {
      var latinas = (datos.voces || []).map(function (v) {
        v.latina = true;
        return v;
      });
      return latinas.concat(VOCES_RESPALDO, [VOZ_CLOUDFLARE]);
    }, function () {
      return VOCES_RESPALDO.concat([VOZ_CLOUDFLARE]);
    });
  }

  /* ---------------- Audio: lectura y conversión ---------------- */

  // Busca el audio en base64 dentro de la respuesta, esté donde esté.
  function buscarAudio(obj) {
    var mejor = '';
    (function recorrer(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(recorrer); return; }
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === 'string' && (k === 'data' || k === 'audio') && v.length > mejor.length) mejor = v;
        else if (v && typeof v === 'object') recorrer(v);
      });
    })(obj);
    return mejor;
  }

  function base64ABytes(b64) {
    var binario = atob(b64);
    var bytes = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  }

  // Convierte WAV (o PCM sin cabecera) en muestras de 16 bits.
  function leerPCM(bytes) {
    var vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var texto4 = function (pos) { return String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); };

    if (bytes.length > 44 && texto4(0) === 'RIFF' && texto4(8) === 'WAVE') {
      var frecuencia = 24000, pos = 12;
      while (pos + 8 <= bytes.length) {
        var id = texto4(pos), tam = vista.getUint32(pos + 4, true);
        if (id === 'fmt ') frecuencia = vista.getUint32(pos + 12, true);
        if (id === 'data') {
          var fin = Math.min(bytes.length, pos + 8 + tam);
          var inicio = pos + 8;
          var copia = bytes.slice(inicio, inicio + ((fin - inicio) & ~1));
          return { muestras: new Int16Array(copia.buffer), frecuencia: frecuencia };
        }
        pos += 8 + tam + (tam & 1);
      }
    }
    var par = bytes.slice(0, bytes.length & ~1);
    return { muestras: new Int16Array(par.buffer), frecuencia: 24000 };
  }

  function unir(partes) {
    var total = partes.reduce(function (n, p) { return n + p.length; }, 0);
    var salida = new Int16Array(total), pos = 0;
    partes.forEach(function (p) { salida.set(p, pos); pos += p.length; });
    return salida;
  }

  function aWav(muestras, frecuencia) {
    var buffer = new ArrayBuffer(44 + muestras.length * 2);
    var v = new DataView(buffer);
    var escribir = function (pos, t) { for (var i = 0; i < t.length; i++) v.setUint8(pos + i, t.charCodeAt(i)); };
    escribir(0, 'RIFF'); v.setUint32(4, 36 + muestras.length * 2, true); escribir(8, 'WAVE');
    escribir(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, frecuencia, true); v.setUint32(28, frecuencia * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    escribir(36, 'data'); v.setUint32(40, muestras.length * 2, true);
    new Int16Array(buffer, 44).set(muestras);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Carga el conversor a MP3 solo cuando hace falta (pesa unos 150 KB).
  var promesaLame = null;
  function cargarLame() {
    if (window.lamejs) return Promise.resolve(window.lamejs);
    if (!promesaLame) {
      promesaLame = new Promise(function (resolver, rechazar) {
        var s = document.createElement('script');
        s.src = 'js/vendor/lame.min.js';
        s.onload = function () { window.lamejs ? resolver(window.lamejs) : rechazar(new Error('No se pudo cargar el conversor a MP3.')); };
        s.onerror = function () { promesaLame = null; rechazar(new Error('No se pudo cargar el conversor a MP3.')); };
        document.head.appendChild(s);
      });
    }
    return promesaLame;
  }

  // Convierte a MP3 por partes, sin congelar la página. alProgreso(0..1).
  function aMp3(muestras, frecuencia, alProgreso) {
    return cargarLame().then(function (lame) {
      var codificador = new lame.Mp3Encoder(1, frecuencia, 64);
      var partes = [], BLOQUE = 1152, POR_TANDA = BLOQUE * 200, pos = 0;
      return new Promise(function (resolver) {
        (function tanda() {
          var hasta = Math.min(muestras.length, pos + POR_TANDA);
          for (; pos < hasta; pos += BLOQUE) {
            var mp3 = codificador.encodeBuffer(muestras.subarray(pos, Math.min(pos + BLOQUE, muestras.length)));
            if (mp3.length) partes.push(new Uint8Array(mp3));
          }
          if (alProgreso) alProgreso(pos / muestras.length);
          if (pos < muestras.length) { setTimeout(tanda, 0); return; }
          var final = codificador.flush();
          if (final.length) partes.push(new Uint8Array(final));
          resolver(new Blob(partes, { type: 'audio/mpeg' }));
        })();
      });
    });
  }

  // MP3 → muestras de 16 bits a 24 kHz (el navegador decodifica y cambia la frecuencia).
  function mp3APCM(bytes) {
    var Contexto = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Contexto) return Promise.reject(new Error('Este navegador no puede leer el audio de Cloudflare. Usa Chrome o Edge.'));
    var copia = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Contexto(1, 1, FRECUENCIA).decodeAudioData(copia).then(function (buf) {
      var datos = buf.getChannelData(0), muestras = new Int16Array(datos.length);
      for (var i = 0; i < datos.length; i++) {
        var x = Math.max(-1, Math.min(1, datos[i]));
        muestras[i] = x < 0 ? x * 32768 : x * 32767;
      }
      return { muestras: muestras, frecuencia: FRECUENCIA };
    });
  }

  /* ---------------- Generación ---------------- */

  function textoEstilo(clave, voz) {
    var e = (ESTILOS[clave] || ESTILOS.narrador).texto;
    return voz && voz.latina ? e : e + ACENTO_LATINO;
  }

  function esperar(segundos, alCadaSegundo) {
    return new Promise(function (resolver) {
      var quedan = segundos;
      (function paso() {
        if (alCadaSegundo) alCadaSegundo(quedan);
        if (quedan <= 0) { resolver(); return; }
        quedan--;
        setTimeout(paso, 1000);
      })();
    });
  }

  // Si el modelo de voz disponible no acepta la indicación de estilo, se deja de enviar
  // durante esta visita a la página (la voz elegida se mantiene).
  var estiloNoAdmitido = false;

  function sintetizarCloudflare(texto) {
    return enviar({ accion: 'voz-cloudflare', texto: texto }).then(function (datos) {
      if (!datos.audio) throw new Error('Cloudflare no devolvió audio. Intenta de nuevo.');
      return mp3APCM(base64ABytes(datos.audio));
    });
  }

  // Un fragmento de texto → muestras de audio. Si se alcanza el límite por minuto, espera y reintenta.
  function sintetizar(texto, voz, estilo, alEsperar, intento) {
    if (voz.proveedor === 'cloudflare') return sintetizarCloudflare(texto);
    intento = intento || 0;
    var conEstilo = !estiloNoAdmitido;
    return enviar({ accion: 'voz', texto: texto, voz: voz.id, estilo: conEstilo ? textoEstilo(estilo, voz) : '' }).then(function (datos) {
      var b64 = buscarAudio(datos);
      if (!b64) throw new Error('Gemini no devolvió audio. Intenta de nuevo.');
      return leerPCM(base64ABytes(b64));
    }, function (err) {
      if (conEstilo && err.estado === 400 && /speech metadata|not supported/i.test(err.message)) {
        estiloNoAdmitido = true;
        return sintetizar(texto, voz, estilo, alEsperar, intento);
      }
      if (err.estado === 429 && intento < REINTENTOS_POR_LIMITE) {
        return esperar(ESPERA_POR_LIMITE, alEsperar).then(function () {
          return sintetizar(texto, voz, estilo, alEsperar, intento + 1);
        });
      }
      throw err;
    });
  }

  // Divide un texto largo en trozos que terminan en punto, sin pasar de "maximo" caracteres.
  function dividir(texto, maximo) {
    maximo = maximo || MAX_FRAGMENTO_GEMINI;
    var frases = texto.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["»”)]*\s*|[^.!?…]+$/g) || [];
    var trozos = [], actual = '';
    frases.forEach(function (f) {
      while (f.length > maximo) {
        var corte = f.lastIndexOf(' ', maximo);
        if (corte < 1) corte = maximo;
        if (actual) { trozos.push(actual.trim()); actual = ''; }
        trozos.push(f.slice(0, corte).trim());
        f = f.slice(corte);
      }
      if ((actual + f).length > maximo && actual) { trozos.push(actual.trim()); actual = ''; }
      actual += f;
    });
    if (actual.trim()) trozos.push(actual.trim());
    return trozos;
  }

  function probar(voz, estilo) {
    return sintetizar(FRASE_PRUEBA, voz, estilo).then(function (a) {
      return aWav(a.muestras, a.frecuencia);
    });
  }

  // Errores por los que conviene pasar a la voz de Cloudflare: límite, saturación o lentitud de Gemini.
  function convieneRespaldo(err) {
    return err.estado === 429 || err.estado === 500 || err.estado === 503 || err.estado === 504 || err.estado === 524;
  }

  // Narra todas las escenas. alProgreso({ hecho, total, mensaje }). cancelado() → true para detener.
  // Devuelve también "segmentos": qué texto suena en qué segundo (para subtítulos y video).
  // Si Gemini falla por su límite, vuelve a narrar TODO con la voz de Cloudflare (para que no cambie
  // de voz a mitad de la historia) y lo indica con "respaldo: true".
  function narrarProyecto(proyecto, voz, estilo, alProgreso, cancelado) {
    return narrarCon(proyecto, voz, estilo, alProgreso, cancelado).catch(function (err) {
      if (voz.proveedor === 'cloudflare' || !convieneRespaldo(err) || (cancelado && cancelado())) throw err;
      alProgreso({ hecho: 0, total: 1, mensaje: 'Gemini alcanzó su límite. Cambiando a la voz de Cloudflare para toda la historia…' });
      return narrarCon(proyecto, VOZ_CLOUDFLARE, estilo, alProgreso, cancelado).then(function (a) {
        a.respaldo = true;
        return a;
      });
    });
  }

  function narrarCon(proyecto, voz, estilo, alProgreso, cancelado) {
    var maximo = voz.proveedor === 'cloudflare' ? MAX_FRAGMENTO_CF : MAX_FRAGMENTO_GEMINI;
    var trabajos = [];
    proyecto.escenas.forEach(function (e, i) {
      dividir(e.narracion || '', maximo).forEach(function (t, j) {
        trabajos.push({ texto: t, escena: i + 1, escenaId: e.id, primeroDeEscena: j === 0 });
      });
    });
    if (!trabajos.length) return Promise.reject(new Error('Ninguna escena tiene narración. Escríbela o genérala con IA primero.'));

    var partes = [], segmentos = [], frecuencia = FRECUENCIA, posicion = 0, k = 0;
    var quien = voz.proveedor === 'cloudflare' ? 'Generando voz de Cloudflare' : 'Generando voz';
    function siguiente() {
      if (cancelado && cancelado()) return Promise.reject(new Error('Generación de audio cancelada.'));
      if (k >= trabajos.length) {
        var muestras = unir(partes);
        return { muestras: muestras, frecuencia: frecuencia, duracion: muestras.length / frecuencia, segmentos: segmentos };
      }
      var t = trabajos[k];
      alProgreso({ hecho: k, total: trabajos.length, mensaje: quien + ': escena ' + t.escena + ' (parte ' + (k + 1) + ' de ' + trabajos.length + ')…' });
      return sintetizar(t.texto, voz, estilo, function (s) {
        alProgreso({ hecho: k, total: trabajos.length, mensaje: 'Límite por minuto de Gemini alcanzado. Reintentando en ' + s + ' s…' });
      }).then(function (a) {
        frecuencia = a.frecuencia;
        if (t.primeroDeEscena && partes.length) {
          var pausa = new Int16Array(Math.round(PAUSA_ENTRE_ESCENAS * frecuencia));
          partes.push(pausa);
          posicion += pausa.length;
        }
        segmentos.push({ escenaId: t.escenaId, texto: t.texto, inicio: posicion / frecuencia, fin: (posicion + a.muestras.length) / frecuencia });
        partes.push(a.muestras);
        posicion += a.muestras.length;
        k++;
        return siguiente();
      });
    }
    return Promise.resolve().then(siguiente);
  }

  return {
    ESTILOS: ESTILOS,
    VOCES_RESPALDO: VOCES_RESPALDO,
    VOZ_CLOUDFLARE: VOZ_CLOUDFLARE,
    leerPreferencias: leerPreferencias,
    guardarPreferencias: guardarPreferencias,
    cargarVoces: cargarVoces,
    probar: probar,
    narrarProyecto: narrarProyecto,
    aWav: aWav,
    aMp3: aMp3,
    dividir: dividir
  };
})();
