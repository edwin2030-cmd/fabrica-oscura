/* ==========================================================
   Creación de videos MP4 en el propio navegador.
   - Imágenes (paso 4) con movimiento de cámara lento y
     transiciones suaves.
   - Narración (paso 3) + música ambiental opcional.
   - Subtítulos sincronizados con los segmentos de la voz.
   Usa WebCodecs (Chrome / Edge) para codificar y mp4-muxer
   (js/vendor/mp4-muxer.js) para armar el archivo MP4.
   No usa ningún servidor ni clave.
   ========================================================== */

var Video = (function () {
  'use strict';

  var FPS = 30;
  var FUNDIDO = 1.0;              // segundos de transición entre imágenes
  var FUNDIDO_INICIO = 0.8;       // aparición desde negro
  var FUNDIDO_FINAL = 1.5;        // desaparición a negro
  var MAX_SUBTITULO = 84;         // caracteres por subtítulo (unas dos líneas)
  var BLOQUE_AUDIO = 4096;        // muestras por paquete de audio

  var FORMATOS = {
    '16:9': { nombre: '16:9 YouTube (1280×720)', ancho: 1280, alto: 720, bitrate: 2500000 },
    '9:16': { nombre: '9:16 Shorts (720×1280)', ancho: 720, alto: 1280, bitrate: 2500000 }
  };

  var MUSICAS = {
    ninguna: 'Sin música',
    dron: 'Dron oscuro (grave y envolvente)',
    viento: 'Viento inquietante',
    latido: 'Latidos de corazón',
    archivo: 'Mi propio archivo de música…'
  };

  /* ---------------- Compatibilidad ---------------- */

  function compatible() {
    var falta = ['VideoEncoder', 'AudioEncoder', 'VideoFrame', 'AudioData', 'OfflineAudioContext']
      .filter(function (n) { return typeof window[n] === 'undefined'; });
    if (typeof window.Mp4Muxer === 'undefined') falta.push('Mp4Muxer');
    return falta.length
      ? { ok: false, motivo: 'Este navegador no puede crear videos (' + falta.join(', ') + '). Usa Google Chrome o Microsoft Edge actualizados en una computadora.' }
      : { ok: true, motivo: '' };
  }

  /* ---------------- Subtítulos ---------------- */

  // Parte un texto en frases cortas para mostrar en pantalla.
  function partirFrases(texto) {
    var frases = texto.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) || [];
    var salida = [];
    frases.forEach(function (f) {
      f = f.trim();
      while (f.length > MAX_SUBTITULO) {
        // Corta en una coma o, si no hay, en un espacio cercano a la mitad del máximo.
        var corte = f.lastIndexOf(', ', MAX_SUBTITULO);
        if (corte < MAX_SUBTITULO * 0.4) corte = f.lastIndexOf(' ', MAX_SUBTITULO);
        if (corte < 1) corte = MAX_SUBTITULO;
        salida.push(f.slice(0, corte + (f[corte] === ',' ? 1 : 0)).trim());
        f = f.slice(corte + 1).trim();
      }
      if (f) salida.push(f);
    });
    return salida;
  }

  // Cada segmento de voz sabe cuándo empieza y termina; dentro de él,
  // el tiempo se reparte entre las frases según su número de letras.
  function crearSubtitulos(segmentos) {
    var subs = [];
    segmentos.forEach(function (s) {
      var frases = partirFrases(s.texto);
      var total = frases.reduce(function (n, f) { return n + f.length; }, 0) || 1;
      var t = s.inicio, largo = s.fin - s.inicio;
      frases.forEach(function (f) {
        var d = largo * f.length / total;
        subs.push({ inicio: t, fin: t + d, texto: f });
        t += d;
      });
    });
    return subs;
  }

  function tiempoSRT(seg) {
    var ms = Math.max(0, Math.round(seg * 1000));
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    var dos = function (n) { return (n < 10 ? '0' : '') + n; };
    return dos(h) + ':' + dos(m) + ':' + dos(s) + ',' + String(ms % 1000).padStart(3, '0');
  }

  function aSRT(subs) {
    return subs.map(function (c, i) {
      return (i + 1) + '\n' + tiempoSRT(c.inicio) + ' --> ' + tiempoSRT(c.fin) + '\n' + c.texto + '\n';
    }).join('\n');
  }

  /* ---------------- Línea de tiempo de imágenes ---------------- */

  // Reparte las imágenes de cada escena dentro del tiempo en que suena esa escena.
  // tomas: [{ escenaId, imagen }] en orden. Devuelve [{ inicio, fin, imagen }].
  function lineaDeTiempo(escenaIds, tomas, segmentos, duracion) {
    var conImagen = tomas.filter(function (t) { return t.imagen; });
    if (!conImagen.length) throw new Error('No hay imágenes generadas. Genéralas en "Imágenes de la historia".');

    var tramos = [];
    if (segmentos && segmentos.length) {
      escenaIds.forEach(function (id) {
        var segs = segmentos.filter(function (s) { return s.escenaId === id; });
        if (!segs.length) return;
        var inicio = segs[0].inicio;
        var fin = segs[segs.length - 1].fin;
        var imgs = conImagen.filter(function (t) { return t.escenaId === id; });
        if (!imgs.length) {
          // Escena sin imágenes: se alarga la imagen anterior (o la siguiente, si es la primera).
          if (tramos.length) tramos[tramos.length - 1].fin = fin;
          else tramos.push({ inicio: inicio, fin: fin, imagen: null });
          return;
        }
        var paso = (fin - inicio) / imgs.length;
        imgs.forEach(function (t, k) {
          tramos.push({ inicio: inicio + paso * k, fin: inicio + paso * (k + 1), imagen: t.imagen });
        });
      });
    }
    if (!tramos.some(function (t) { return t.imagen; })) {
      // Sin datos de tiempos: se reparten todas las imágenes por igual.
      var p = duracion / conImagen.length;
      tramos = conImagen.map(function (t, k) { return { inicio: p * k, fin: p * (k + 1), imagen: t.imagen }; });
    }
    // Rellena huecos: si el primer tramo no tiene imagen, toma la del siguiente con imagen.
    for (var i = 0; i < tramos.length; i++) {
      if (!tramos[i].imagen) {
        var sig = tramos.slice(i + 1).find(function (t) { return t.imagen; });
        tramos[i].imagen = sig ? sig.imagen : conImagen[0].imagen;
      }
    }
    // Tramos seguidos de principio a fin, sin huecos.
    tramos[0].inicio = 0;
    for (var j = 0; j < tramos.length - 1; j++) tramos[j].fin = tramos[j + 1].inicio;
    tramos[tramos.length - 1].fin = duracion;
    return tramos.filter(function (t) { return t.fin - t.inicio > 0.05; });
  }

  /* ---------------- Audio: narración + música ---------------- */

  function crearRuido(ctx) {
    var b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function lfo(ctx, frecuencia, cantidad, destino, duracion) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.frequency.value = frecuencia;
    g.gain.value = cantidad;
    o.connect(g).connect(destino);
    o.start(0);
    o.stop(duracion);
  }

  // Música generada al momento (sin archivos ni derechos de autor).
  function sintetizarMusica(ctx, tipo, salida, duracion) {
    if (tipo === 'dron') {
      var filtro = ctx.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.value = 260;
      filtro.connect(salida);
      lfo(ctx, 0.05, 140, filtro.frequency, duracion);
      [[41.2, 'sawtooth', 0.25], [55, 'sine', 0.6], [82.4, 'sine', 0.3], [55.4, 'triangle', 0.3]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = n[1];
        o.frequency.value = n[0];
        g.gain.value = n[2];
        o.connect(g).connect(filtro);
        o.start(0);
        o.stop(duracion);
      });
    } else if (tipo === 'viento') {
      var ruido = ctx.createBufferSource();
      ruido.buffer = crearRuido(ctx);
      ruido.loop = true;
      var banda = ctx.createBiquadFilter();
      banda.type = 'bandpass';
      banda.frequency.value = 420;
      banda.Q.value = 0.9;
      var oleaje = ctx.createGain();
      oleaje.gain.value = 0.7;
      ruido.connect(banda).connect(oleaje).connect(salida);
      lfo(ctx, 0.07, 260, banda.frequency, duracion);
      lfo(ctx, 0.11, 0.3, oleaje.gain, duracion);
      ruido.start(0);
      ruido.stop(duracion);
    } else if (tipo === 'latido') {
      var grave = ctx.createBiquadFilter();
      grave.type = 'lowpass';
      grave.frequency.value = 120;
      grave.connect(salida);
      for (var t = 1; t < duracion - 1; t += 1.25) {
        [0, 0.3].forEach(function (desfase, k) {
          var o = ctx.createOscillator(), g = ctx.createGain(), ini = t + desfase;
          o.frequency.value = k ? 48 : 55;
          g.gain.setValueAtTime(0, ini);
          g.gain.linearRampToValueAtTime(k ? 0.7 : 1, ini + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, ini + 0.22);
          o.connect(g).connect(grave);
          o.start(ini);
          o.stop(ini + 0.25);
        });
      }
    }
  }

  // Mezcla la narración con la música. Devuelve un AudioBuffer mono.
  function mezclarAudio(op, frecuenciaSalida, duracion) {
    var ctx = new OfflineAudioContext(1, Math.ceil(duracion * frecuenciaSalida), frecuenciaSalida);

    var voz = ctx.createBuffer(1, op.muestras.length, op.frecuencia);
    var canal = voz.getChannelData(0);
    for (var i = 0; i < op.muestras.length; i++) canal[i] = op.muestras[i] / 32768;
    var fuenteVoz = ctx.createBufferSource();
    fuenteVoz.buffer = voz;
    fuenteVoz.connect(ctx.destination);
    fuenteVoz.start(0);

    var preparar = Promise.resolve();
    if (op.musica && op.musica.tipo !== 'ninguna' && op.musica.volumen > 0) {
      var musica = ctx.createGain();
      var vol = op.musica.volumen * 0.5;   // la música siempre por debajo de la voz
      musica.gain.setValueAtTime(0, 0);
      musica.gain.linearRampToValueAtTime(vol, Math.min(3, duracion / 3));
      musica.gain.setValueAtTime(vol, Math.max(0, duracion - 3));
      musica.gain.linearRampToValueAtTime(0, duracion);
      musica.connect(ctx.destination);

      if (op.musica.tipo === 'archivo') {
        if (!op.musica.archivo) return Promise.reject(new Error('Elige un archivo de música o cambia la opción de música.'));
        preparar = op.musica.archivo.arrayBuffer().then(function (b) {
          return ctx.decodeAudioData(b);
        }).then(function (buffer) {
          var f = ctx.createBufferSource();
          f.buffer = buffer;
          f.loop = true;
          f.connect(musica);
          f.start(0);
        }, function () {
          throw new Error('No se pudo leer el archivo de música. Usa un MP3, WAV u OGG.');
        });
      } else {
        sintetizarMusica(ctx, op.musica.tipo, musica, duracion);
      }
    }
    return preparar.then(function () { return ctx.startRendering(); });
  }

  /* ---------------- Dibujo de cada fotograma ---------------- */

  // Movimientos de cámara que se van alternando: [zoom inicial, zoom final, desplazamiento X inicial, final, Y inicial, final]
  var MOVIMIENTOS = [
    [1.0, 1.14, 0, 0, 0, 0],          // acercarse al centro
    [1.14, 1.02, 0, 0, 0.3, -0.3],    // alejarse subiendo
    [1.12, 1.12, -0.8, 0.8, 0, 0],    // recorrer de izquierda a derecha
    [1.03, 1.15, 0.4, -0.4, -0.3, 0.3],
    [1.12, 1.12, 0.8, -0.8, 0, 0]     // recorrer de derecha a izquierda
  ];

  function suave(x) { return x * x * (3 - 2 * x); }

  function dibujarImagen(c, ancho, alto, bitmap, indice, progreso) {
    var m = MOVIMIENTOS[indice % MOVIMIENTOS.length];
    var p = suave(Math.max(0, Math.min(1, progreso)));
    var zoom = m[0] + (m[1] - m[0]) * p;
    var bw = bitmap.naturalWidth || bitmap.width, bh = bitmap.naturalHeight || bitmap.height;
    var escala = Math.max(ancho / bw, alto / bh) * zoom;
    var w = bw * escala, h = bh * escala;
    var dx = (m[2] + (m[3] - m[2]) * p) * (w - ancho) / 2;
    var dy = (m[4] + (m[5] - m[4]) * p) * (h - alto) / 2;
    c.drawImage(bitmap, (ancho - w) / 2 + dx, (alto - h) / 2 + dy, w, h);
  }

  function lineasDeTexto(c, texto, maxAncho) {
    var palabras = texto.split(' '), lineas = [], actual = '';
    palabras.forEach(function (p) {
      var prueba = actual ? actual + ' ' + p : p;
      if (c.measureText(prueba).width > maxAncho && actual) { lineas.push(actual); actual = p; }
      else actual = prueba;
    });
    if (actual) lineas.push(actual);
    return lineas;
  }

  function dibujarSubtitulo(c, ancho, alto, texto) {
    var vertical = alto > ancho;
    var tam = Math.round(vertical ? ancho * 0.055 : alto * 0.045);
    c.font = '600 ' + tam + 'px "Segoe UI", Roboto, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var lineas = lineasDeTexto(c, texto, ancho * (vertical ? 0.82 : 0.78));
    var alturaLinea = tam * 1.3;
    var base = alto * (vertical ? 0.74 : 0.86) - (lineas.length - 1) * alturaLinea / 2;
    var anchoMax = Math.max.apply(null, lineas.map(function (l) { return c.measureText(l).width; }));
    c.fillStyle = 'rgba(0, 0, 0, 0.55)';
    var relleno = tam * 0.45;
    c.fillRect((ancho - anchoMax) / 2 - relleno, base - alturaLinea / 2 - relleno * 0.6,
      anchoMax + relleno * 2, alturaLinea * lineas.length + relleno * 1.2);
    c.fillStyle = '#ffffff';
    c.shadowColor = 'rgba(0, 0, 0, 0.9)';
    c.shadowBlur = 4;
    lineas.forEach(function (l, i) { c.fillText(l, ancho / 2, base + i * alturaLinea); });
    c.shadowBlur = 0;
  }

  function dibujarFotograma(c, ancho, alto, t, tramos, subtitulos, duracion) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, ancho, alto);

    var i = tramos.length - 1;
    while (i > 0 && tramos[i].inicio > t) i--;
    var progresoDe = function (k) { return (t - tramos[k].inicio) / (tramos[k].fin - tramos[k].inicio + FUNDIDO); };

    var enTransicion = i > 0 && t - tramos[i].inicio < FUNDIDO;
    if (enTransicion) {
      dibujarImagen(c, ancho, alto, tramos[i - 1].bitmap, i - 1, progresoDe(i - 1));
      c.globalAlpha = suave((t - tramos[i].inicio) / FUNDIDO);
    }
    dibujarImagen(c, ancho, alto, tramos[i].bitmap, i, progresoDe(i));
    c.globalAlpha = 1;

    // Aparición desde negro y desaparición a negro.
    var oscuro = Math.max(t < FUNDIDO_INICIO ? 1 - t / FUNDIDO_INICIO : 0,
      t > duracion - FUNDIDO_FINAL ? (t - (duracion - FUNDIDO_FINAL)) / FUNDIDO_FINAL : 0);
    if (oscuro > 0) {
      c.fillStyle = 'rgba(0, 0, 0, ' + Math.min(1, oscuro) + ')';
      c.fillRect(0, 0, ancho, alto);
    }

    if (subtitulos) {
      var s = subtitulos.find(function (x) { return t >= x.inicio && t < x.fin; });
      if (s) dibujarSubtitulo(c, ancho, alto, s.texto);
    }
  }

  /* ---------------- Codificación ---------------- */

  // Algunos navegadores nunca responden si pueden usar un formato: se da un tiempo máximo.
  function conLimite(promesa, ms) {
    return Promise.race([promesa, new Promise(function (r) { setTimeout(function () { r({ supported: false }); }, ms); })]);
  }

  function elegirConfigVideo(formato) {
    var opciones = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'].map(function (codec) {
      return { codec: codec, width: formato.ancho, height: formato.alto, bitrate: formato.bitrate, framerate: FPS, avc: { format: 'avc' } };
    });
    var probar = function (k) {
      if (k >= opciones.length) return Promise.reject(new Error('Este navegador no puede codificar video H.264. Usa Google Chrome o Microsoft Edge actualizados.'));
      return conLimite(VideoEncoder.isConfigSupported(opciones[k]), 10000).then(function (r) {
        return r.supported ? opciones[k] : probar(k + 1);
      }, function () { return probar(k + 1); });
    };
    return probar(0);
  }

  function elegirConfigAudio() {
    var opciones = [
      { muxer: 'aac', config: { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, bitrate: 128000 } },
      { muxer: 'aac', config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 } },
      { muxer: 'opus', config: { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 } }
    ];
    var probar = function (k) {
      if (k >= opciones.length) return Promise.reject(new Error('Este navegador no puede codificar el audio del video. Usa Google Chrome o Microsoft Edge actualizados.'));
      return conLimite(AudioEncoder.isConfigSupported(opciones[k].config), 10000).then(function (r) {
        return r.supported ? opciones[k] : probar(k + 1);
      }, function () { return probar(k + 1); });
    };
    return probar(0);
  }

  // Abre una imagen para dibujarla. Si el método rápido falla o tarda, usa el clásico (<img>).
  function abrirImagen(blob) {
    var clasico = function () {
      return new Promise(function (resolver, rechazar) {
        var img = new Image();
        img.onload = function () { resolver(img); };
        img.onerror = function () { rechazar(new Error('No se pudo abrir una de las imágenes. Regenérala e intenta de nuevo.')); };
        img.src = URL.createObjectURL(blob);
      });
    };
    if (typeof createImageBitmap !== 'function') return clasico();
    return Promise.race([
      createImageBitmap(blob),
      new Promise(function (r, rechazar) { setTimeout(function () { rechazar(new Error('lento')); }, 8000); })
    ]).catch(clasico);
  }

  function pausa() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  function esperarCola(codificador, maximo) {
    if (codificador.encodeQueueSize <= maximo) return Promise.resolve();
    return new Promise(function (resolver) {
      var listo = function () {
        if (codificador.encodeQueueSize <= maximo) { codificador.removeEventListener('dequeue', listo); clearInterval(respaldo); resolver(); }
      };
      codificador.addEventListener('dequeue', listo);
      var respaldo = setInterval(listo, 20);   // por si el navegador no avisa
    });
  }

  /*
    op = {
      muestras (Int16Array), frecuencia, segmentos, escenaIds,
      tomas: [{ escenaId, imagen (Blob) }],
      formato: '16:9' | '9:16',
      musica: { tipo, volumen (0–1), archivo (Blob) },
      subtitulos: true/false,
      limite: segundos (para la vista previa) o 0
    }
    alProgreso(fraccion, mensaje). cancelado() → true para detener.
  */
  function crear(op, alProgreso, cancelado) {
    var c0 = compatible();
    if (!c0.ok) return Promise.reject(new Error(c0.motivo));
    if (!op.muestras || !op.muestras.length) return Promise.reject(new Error('Falta la narración. Genera el audio en "Voz y audio".'));

    var formato = FORMATOS[op.formato] || FORMATOS['16:9'];
    var duracionTotal = op.muestras.length / op.frecuencia;
    var duracion = op.limite ? Math.min(op.limite, duracionTotal) : duracionTotal;
    var tramos, subtitulos = null;
    try {
      tramos = lineaDeTiempo(op.escenaIds, op.tomas, op.segmentos, duracionTotal).filter(function (t) { return t.inicio < duracion; });
    } catch (e) {
      return Promise.reject(e);
    }
    if (op.subtitulos && op.segmentos && op.segmentos.length) subtitulos = crearSubtitulos(op.segmentos);

    var detener = function () { if (cancelado && cancelado()) throw new Error('Creación del video cancelada.'); };
    var codVideo = null, codAudio = null, configVideo, configAudio, muxer, fallo = null;

    alProgreso(0.01, 'Preparando imágenes…');
    return Promise.all(tramos.map(function (t) {
      return abrirImagen(t.imagen).then(function (b) { t.bitmap = b; });
    })).then(function () {
      return Promise.all([elegirConfigVideo(formato), elegirConfigAudio()]);
    }).then(function (configs) {
      configVideo = configs[0];
      configAudio = configs[1];
      detener();
      alProgreso(0.03, 'Mezclando la narración' + (op.musica && op.musica.tipo !== 'ninguna' ? ' con la música' : '') + '…');
      return mezclarAudio(op, configAudio.config.sampleRate, duracion);
    }).then(function (audio) {
      detener();
      muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: formato.ancho, height: formato.alto, frameRate: FPS },
        audio: { codec: configAudio.muxer, numberOfChannels: 1, sampleRate: configAudio.config.sampleRate },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset'
      });
      var alFallar = function (e) { fallo = fallo || e; };

      // 1) Audio
      codAudio = new AudioEncoder({ output: function (ch, meta) { muxer.addAudioChunk(ch, meta); }, error: alFallar });
      codAudio.configure(configAudio.config);
      var datos = audio.getChannelData(0), fr = audio.sampleRate;
      for (var i = 0; i < datos.length; i += BLOQUE_AUDIO) {
        var trozo = datos.slice(i, Math.min(i + BLOQUE_AUDIO, datos.length));
        var ad = new AudioData({
          format: 'f32-planar', sampleRate: fr, numberOfFrames: trozo.length, numberOfChannels: 1,
          timestamp: Math.round(i / fr * 1e6), data: trozo
        });
        codAudio.encode(ad);
        ad.close();
      }
      return codAudio.flush();
    }).then(function () {
      if (fallo) throw fallo;
      detener();

      // 2) Video, fotograma a fotograma
      codVideo = new VideoEncoder({ output: function (ch, meta) { muxer.addVideoChunk(ch, meta); }, error: function (e) { fallo = fallo || e; } });
      codVideo.configure(configVideo);
      var lienzo = document.createElement('canvas');
      lienzo.width = formato.ancho;
      lienzo.height = formato.alto;
      var c = lienzo.getContext('2d');
      var total = Math.ceil(duracion * FPS), f = 0;

      function tanda() {
        if (fallo) return Promise.reject(fallo);
        detener();
        var hasta = Math.min(total, f + 15);
        var cadena = Promise.resolve();
        for (; f < hasta; f++) {
          (function (n) {
            cadena = cadena.then(function () { return esperarCola(codVideo, 6); }).then(function () {
              var t = n / FPS;
              dibujarFotograma(c, formato.ancho, formato.alto, t, tramos, subtitulos, duracion);
              var vf = new VideoFrame(lienzo, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
              codVideo.encode(vf, { keyFrame: n % (FPS * 2) === 0 });
              vf.close();
            });
          })(f);
        }
        return cadena.then(function () {
          alProgreso(0.08 + 0.88 * f / total, 'Creando el video: ' + Math.floor(f / FPS) + ' de ' + Math.round(duracion) + ' segundos…');
          return f < total ? pausa().then(tanda) : null;
        });
      }
      return tanda().then(function () { return codVideo.flush(); });
    }).then(function () {
      if (fallo) throw fallo;
      alProgreso(0.98, 'Guardando el archivo MP4…');
      muxer.finalize();
      return {
        blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }),
        duracion: duracion,
        subtitulos: subtitulos
      };
    }).catch(function (e) {
      throw e instanceof Error ? e : new Error('No se pudo crear el video: ' + e);
    }).finally(function () {
      [codVideo, codAudio].forEach(function (cod) { if (cod && cod.state !== 'closed') { try { cod.close(); } catch (e) { /* ya cerrado */ } } });
      (tramos || []).forEach(function (t) {
        if (t.bitmap && t.bitmap.close) t.bitmap.close();
        else if (t.bitmap && t.bitmap.src) URL.revokeObjectURL(t.bitmap.src);
      });
    });
  }

  return {
    FORMATOS: FORMATOS,
    MUSICAS: MUSICAS,
    compatible: compatible,
    crear: crear,
    crearSubtitulos: crearSubtitulos,
    aSRT: aSRT,
    lineaDeTiempo: lineaDeTiempo
  };
})();
