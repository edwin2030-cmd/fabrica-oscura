/* ==========================================================
   Fábrica Oscura — lógica de la aplicación
   Navegación por "#", pantallas, editor de escenas, exportación.
   ========================================================== */

(function () {
  'use strict';

  var ESTADOS = {
    idea: 'Idea',
    guion: 'Guion en progreso',
    listo: 'Listo para grabar',
    publicado: 'Publicado'
  };
  var PALABRAS_POR_MINUTO = 150; // velocidad media de narración en español
  var RETRASO_AUTOGUARDADO = 800;

  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var menuToggle = document.querySelector('.menu-toggle');

  // Estado de la sesión
  var editor = null;           // { proyecto, sucio, temporizador }
  var ideaActual = null;
  var subgeneroIdeas = 'todos';
  var filtros = { texto: '', estado: 'todos' };

  /* ---------------- Utilidades ---------------- */

  function esc(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function contarPalabras(t) {
    t = (t || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }

  function formatoDuracion(palabras) {
    var seg = Math.round(palabras / PALABRAS_POR_MINUTO * 60);
    var m = Math.floor(seg / 60);
    var s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatoFecha(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  function estadisticas(p) {
    var palabras = p.escenas.reduce(function (n, e) { return n + contarPalabras(e.narracion); }, 0);
    return { escenas: p.escenas.length, palabras: palabras, duracion: formatoDuracion(palabras) };
  }

  function nombreSubgenero(clave) {
    return Ideas.SUBGENEROS[clave] || 'Sin subgénero';
  }

  function opciones(mapa, seleccionado) {
    return Object.keys(mapa).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === seleccionado ? ' selected' : '') + '>' + esc(mapa[k]) + '</option>';
    }).join('');
  }

  function aviso(mensaje, tipo) {
    var cont = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (tipo === 'error' ? ' error' : '');
    el.textContent = mensaje;
    cont.appendChild(el);
    // Los errores se quedan más tiempo para poder leerlos; con el ratón encima, el aviso no se va.
    var quedan = tipo === 'error' ? 6000 : 3000, desde = Date.now(), temporizador;
    function programar() { desde = Date.now(); temporizador = setTimeout(salir, quedan); }
    function salir() {
      el.classList.add('saliendo');
      setTimeout(function () { el.remove(); }, 200);
    }
    el.addEventListener('mouseenter', function () { clearTimeout(temporizador); quedan = Math.max(1000, quedan - (Date.now() - desde)); });
    el.addEventListener('mouseleave', programar);
    programar();
  }

  // Ventana de confirmación propia (más clara que window.confirm en móviles).
  function confirmar(titulo, texto, textoBoton) {
    var modal = document.getElementById('modal');
    document.getElementById('modalTitulo').textContent = titulo;
    document.getElementById('modalTexto').textContent = texto;
    var aceptar = document.getElementById('modalAceptar');
    aceptar.textContent = textoBoton || 'Eliminar';
    modal.hidden = false;
    aceptar.focus();

    return new Promise(function (resolver) {
      function cerrar(resultado) {
        modal.hidden = true;
        modal.removeEventListener('click', alClic);
        document.removeEventListener('keydown', alTecla);
        resolver(resultado);
      }
      function alClic(e) {
        var accion = e.target.getAttribute('data-modal');
        if (accion) cerrar(accion === 'aceptar');
      }
      function alTecla(e) {
        if (e.key === 'Escape') cerrar(false);
      }
      modal.addEventListener('click', alClic);
      document.addEventListener('keydown', alTecla);
    });
  }

  function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto).then(function () { return true; }, function () { return copiarAlternativo(texto); });
    }
    return Promise.resolve(copiarAlternativo(texto));
  }

  function copiarAlternativo(texto) {
    var area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    return ok;
  }

  function nombreArchivo(titulo) {
    var base = (titulo || 'guion')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return (base || 'guion') + '.txt';
  }

  function descargarTexto(nombre, texto) {
    // El BOM (﻿) hace que el Bloc de notas de Windows muestre bien las tildes.
    var blob = new Blob(['﻿' + texto.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function guionComoTexto(p) {
    var st = estadisticas(p);
    var linea = '='.repeat(60);
    var partes = [
      p.titulo.toUpperCase(),
      linea,
      'Subgénero: ' + nombreSubgenero(p.subgenero),
      'Estado: ' + (ESTADOS[p.estado] || p.estado),
      'Escenas: ' + st.escenas + ' · Palabras narradas: ' + st.palabras + ' · Duración estimada: ' + st.duracion,
      'Última edición: ' + formatoFecha(p.actualizado)
    ];
    if (p.descripcion.trim()) partes.push('', 'PREMISA', p.descripcion.trim());

    p.escenas.forEach(function (e, i) {
      partes.push('', linea, 'ESCENA ' + (i + 1) + (e.titulo.trim() ? ' — ' + e.titulo.trim() : ''), linea);
      if (e.narracion.trim()) partes.push('', '[NARRACIÓN]', e.narracion.trim());
      if (e.visual.trim()) partes.push('', '[VISUAL]', e.visual.trim());
      if (e.sonido.trim()) partes.push('', '[SONIDO / MÚSICA]', e.sonido.trim());
      if (e.notas.trim()) partes.push('', '[NOTAS]', e.notas.trim());
    });
    return partes.join('\n') + '\n';
  }

  /* ---------------- Acciones sobre proyectos ---------------- */

  function crearProyecto(datos) {
    var p = Storage.nuevoProyecto(datos);
    if (!Storage.guardar(p)) {
      aviso('No se pudo guardar. Revisa que el navegador permita el almacenamiento local.', 'error');
      return;
    }
    location.hash = '#editor/' + p.id;
  }

  function obtenerProyecto(id) {
    return editor && editor.proyecto.id === id ? editor.proyecto : Storage.obtener(id);
  }

  function copiarGuion(id) {
    var p = obtenerProyecto(id);
    if (!p) return;
    copiarTexto(guionComoTexto(p)).then(function (ok) {
      aviso(ok ? 'Guion copiado al portapapeles' : 'No se pudo copiar el guion', ok ? '' : 'error');
    });
  }

  function exportarGuion(id) {
    var p = obtenerProyecto(id);
    if (!p) return;
    descargarTexto(nombreArchivo(p.titulo), guionComoTexto(p));
    aviso('Guion exportado como archivo de texto');
  }

  function eliminarProyecto(id) {
    var p = obtenerProyecto(id);
    if (!p) return;
    confirmar('¿Eliminar proyecto?', 'Se eliminará "' + p.titulo + '" y todas sus escenas. Esta acción no se puede deshacer.', 'Eliminar')
      .then(function (ok) {
        if (!ok) return;
        if (editor && editor.proyecto.id === id) {
          clearTimeout(editor.temporizador);
          editor = null;
        }
        Imagenes.borrar(id).catch(function () { /* sin imágenes guardadas */ });
        Almacen.borrar('audios', id).catch(function () { /* sin audio guardado */ });
        Almacen.borrar('videos', id).catch(function () { /* sin video guardado */ });
        YouTube.borrarBorrador(id);
        if (Storage.eliminar(id)) aviso('Proyecto eliminado');
        else aviso('No se pudo eliminar el proyecto', 'error');
        if (ruta().vista === 'editor') location.hash = '#proyectos';
        else render();
      });
  }

  function duplicarProyecto(id) {
    guardarPendiente();
    var copia = Storage.duplicar(id);
    if (copia) { aviso('Proyecto duplicado'); render(); }
    else aviso('No se pudo duplicar el proyecto', 'error');
  }

  /* ---------------- Editor: guardado ---------------- */

  function marcarEstado(estado) {
    var el = document.getElementById('saveStatus');
    if (!el) return;
    el.className = 'save-status' + (estado === 'guardado' ? '' : ' ' + estado);
    el.textContent = estado === 'guardado' ? 'Guardado'
      : estado === 'pendiente' ? 'Cambios sin guardar…'
      : 'Error al guardar';
  }

  function guardarEditor(mostrarAviso) {
    if (!editor) return;
    clearTimeout(editor.temporizador);
    var ok = Storage.guardar(editor.proyecto);
    editor.sucio = !ok;
    marcarEstado(ok ? 'guardado' : 'error');
    if (!ok) aviso('No se pudo guardar. El almacenamiento del navegador puede estar lleno.', 'error');
    else if (mostrarAviso) aviso('Proyecto guardado');
  }

  function cambioEnEditor() {
    editor.sucio = true;
    marcarEstado('pendiente');
    clearTimeout(editor.temporizador);
    editor.temporizador = setTimeout(function () { guardarEditor(false); }, RETRASO_AUTOGUARDADO);
  }

  function guardarPendiente() {
    if (editor && editor.sucio) guardarEditor(false);
  }

  /* ---------------- Vistas ---------------- */

  function tarjetaProyecto(p) {
    var st = estadisticas(p);
    return '' +
      '<article class="card">' +
        '<div class="tags">' +
          '<span class="tag tag-estado-' + esc(p.estado) + '">' + esc(ESTADOS[p.estado] || p.estado) + '</span>' +
          '<span class="tag">' + esc(nombreSubgenero(p.subgenero)) + '</span>' +
        '</div>' +
        '<h3 class="card-title"><a href="#editor/' + esc(p.id) + '">' + esc(p.titulo) + '</a></h3>' +
        (p.descripcion.trim() ? '<p class="card-desc">' + esc(p.descripcion) + '</p>' : '') +
        '<div class="card-meta">' +
          '<span>🎬 ' + st.escenas + ' escena' + (st.escenas === 1 ? '' : 's') + '</span>' +
          '<span>⏱ ' + st.duracion + ' min</span>' +
          '<span>✎ ' + esc(formatoFecha(p.actualizado)) + '</span>' +
        '</div>' +
        '<div class="card-actions">' +
          '<a class="btn btn-sm btn-primary" href="#editor/' + esc(p.id) + '">Abrir</a>' +
          '<button type="button" class="btn btn-sm" data-action="exportar" data-id="' + esc(p.id) + '">Exportar</button>' +
          '<button type="button" class="btn btn-sm" data-action="duplicar" data-id="' + esc(p.id) + '">Duplicar</button>' +
          '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="eliminar" data-id="' + esc(p.id) + '" aria-label="Eliminar ' + esc(p.titulo) + '">Eliminar</button>' +
        '</div>' +
      '</article>';
  }

  function vistaInicio() {
    var proyectos = Storage.listar();
    var totalEscenas = 0, totalPalabras = 0;
    proyectos.forEach(function (p) {
      var st = estadisticas(p);
      totalEscenas += st.escenas;
      totalPalabras += st.palabras;
    });
    var recientes = proyectos.slice(0, 3);

    app.innerHTML = '' +
      '<section class="hero">' +
        '<span class="hero-kicker">Estudio de guiones · Terror y misterio</span>' +
        '<h1 class="hero-title">Crea historias que <em>hielan la sangre</em></h1>' +
        '<p class="hero-sub">Encuentra ideas, escribe tus guiones escena por escena y exporta todo listo para grabar tu próximo video de YouTube.</p>' +
        '<div class="hero-actions">' +
          '<button type="button" class="btn btn-primary btn-lg" data-action="nuevo-proyecto">+ Nuevo proyecto</button>' +
          '<a class="btn btn-lg" href="#ideas">Generar una idea</a>' +
        '</div>' +
      '</section>' +

      '<div class="stats-row">' +
        '<div class="stat"><div class="stat-value">' + proyectos.length + '</div><div class="stat-label">Proyectos</div></div>' +
        '<div class="stat"><div class="stat-value">' + totalEscenas + '</div><div class="stat-label">Escenas escritas</div></div>' +
        '<div class="stat"><div class="stat-value">' + totalPalabras.toLocaleString('es') + '</div><div class="stat-label">Palabras de narración</div></div>' +
        '<div class="stat"><div class="stat-value">' + formatoDuracion(totalPalabras) + '</div><div class="stat-label">Minutos de voz estimados</div></div>' +
      '</div>' +

      '<section class="section">' +
        '<div class="section-head"><h2 class="section-title">Proyectos recientes</h2>' +
          (proyectos.length ? '<a class="btn btn-sm btn-ghost" href="#proyectos">Ver todos →</a>' : '') + '</div>' +
        (recientes.length
          ? '<div class="grid">' + recientes.map(tarjetaProyecto).join('') + '</div>'
          : '<div class="empty"><div class="empty-icon">🕯️</div><h3>Aún no hay proyectos</h3>' +
            '<p>Empieza con una idea del generador o crea un proyecto en blanco.</p>' +
            '<button type="button" class="btn btn-primary" data-action="nuevo-proyecto">Crear mi primer proyecto</button></div>') +
      '</section>' +

      '<section class="section">' +
        '<h2 class="section-title" style="margin-bottom:18px">Cómo funciona</h2>' +
        '<div class="steps">' +
          '<div class="step"><h3>Encuentra la idea</h3><p>Usa el generador para combinar premisas, lugares, giros y ganchos de terror.</p></div>' +
          '<div class="step"><h3>Escribe por escenas</h3><p>Divide el guion en escenas con narración, indicaciones visuales, sonido y notas.</p></div>' +
          '<div class="step"><h3>Copia o exporta</h3><p>Copia el guion al portapapeles o descárgalo como archivo .txt para grabar.</p></div>' +
        '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="features">' +
          '<div class="feature"><div class="feature-icon">💡</div><h3>Generador de ideas con IA</h3><p>Ideas nuevas con Gemini o al azar. Seis subgéneros: paranormal, psicológico, leyendas urbanas, misterios, folclore y grabaciones encontradas.</p></div>' +
          '<div class="feature"><div class="feature-icon">🎬</div><h3>Editor de escenas</h3><p>Reordena, duplica y elimina escenas. Calcula palabras y duración estimada de la narración.</p></div>' +
          '<div class="feature"><div class="feature-icon">🎙️</div><h3>Voces con IA</h3><p>Convierte la narración en audio con voces masculinas y femeninas, escúchala y descárgala en MP3.</p></div>' +
          '<div class="feature"><div class="feature-icon">🖼️</div><h3>Imágenes con IA</h3><p>Ilustra cada escena con imágenes cinematográficas y oscuras en 16:9, con personajes coherentes.</p></div>' +
          '<div class="feature"><div class="feature-icon">🎬</div><h3>Videos MP4</h3><p>Une imágenes con movimiento, narración, música y subtítulos en un video listo para YouTube.</p></div>' +
          '<div class="feature"><div class="feature-icon">📺</div><h3>Publicar en YouTube</h3><p>Título, descripción y etiquetas con IA, visibilidad o fecha programada, barra de subida e historial. Siempre con tu confirmación.</p></div>' +
          '<div class="feature"><div class="feature-icon">💾</div><h3>Guardado automático</h3><p>Tus proyectos se guardan solos en este navegador mientras escribes.</p></div>' +
          '<div class="feature"><div class="feature-icon">📱</div><h3>En cualquier pantalla</h3><p>Funciona en computadoras, tabletas y teléfonos.</p></div>' +
        '</div>' +
      '</section>' +

      '<section class="section roadmap">' +
        '<strong>Próximas etapas de la fábrica</strong> <span class="badge-soon">aún no disponibles</span>' +
        '<ul><li>Publicación directa en YouTube</li></ul>' +
      '</section>';
  }

  function vistaProyectos() {
    app.innerHTML = '' +
      '<div class="page-head section-head">' +
        '<div><h1>Mis proyectos</h1><p class="muted" style="margin:0">Todos tus videos en preparación.</p></div>' +
        '<button type="button" class="btn btn-primary" data-action="nuevo-proyecto">+ Nuevo proyecto</button>' +
      '</div>' +
      '<div class="toolbar-filters">' +
        '<input type="search" class="input" id="buscar" placeholder="Buscar por título o premisa…" aria-label="Buscar proyectos" value="' + esc(filtros.texto) + '">' +
        '<select id="filtroEstado" aria-label="Filtrar por estado"><option value="todos">Todos los estados</option>' + opciones(ESTADOS, filtros.estado) + '</select>' +
      '</div>' +
      '<div id="listaProyectos"></div>';

    pintarListaProyectos();
  }

  function pintarListaProyectos() {
    var cont = document.getElementById('listaProyectos');
    if (!cont) return;
    var todos = Storage.listar();
    var q = filtros.texto.trim().toLowerCase();
    var lista = todos.filter(function (p) {
      var okEstado = filtros.estado === 'todos' || p.estado === filtros.estado;
      var okTexto = !q || (p.titulo + ' ' + p.descripcion).toLowerCase().indexOf(q) !== -1;
      return okEstado && okTexto;
    });

    if (!todos.length) {
      cont.innerHTML = '<div class="empty"><div class="empty-icon">🕯️</div><h3>Aún no hay proyectos</h3>' +
        '<p>Crea un proyecto en blanco o empieza desde una idea del generador.</p>' +
        '<div class="hero-actions"><button type="button" class="btn btn-primary" data-action="nuevo-proyecto">+ Nuevo proyecto</button>' +
        '<a class="btn" href="#ideas">Generar una idea</a></div></div>';
    } else if (!lista.length) {
      cont.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><h3>Sin resultados</h3><p>Ningún proyecto coincide con la búsqueda.</p></div>';
    } else {
      cont.innerHTML = '<div class="grid">' + lista.map(tarjetaProyecto).join('') + '</div>';
    }
  }

  function vistaIdeas() {
    if (!ideaActual) ideaActual = Ideas.generar(subgeneroIdeas);
    app.innerHTML = '' +
      '<div class="page-head">' +
        '<h1>Generador de ideas</h1>' +
        '<p class="muted" style="margin:0">Combina al azar premisas, lugares, protagonistas y giros para inspirar tu próxima historia.</p>' +
      '</div>' +
      '<div class="ideas-controls">' +
        '<label>Subgénero<select id="subgeneroIdeas"><option value="todos">Cualquiera (sorpresa)</option>' +
          opciones(Ideas.SUBGENEROS, subgeneroIdeas) + '</select></label>' +
        '<button type="button" class="btn btn-primary" data-action="generar-idea-ia">✨ Generar con IA</button>' +
        '<button type="button" class="btn" data-action="generar-idea">🎲 Idea al azar</button>' +
      '</div>' +
      '<div id="tarjetaIdea"></div>' +
      '<p class="note">ℹ️ <strong>✨ Generar con IA</strong> le pide a Gemini una idea nueva (tarda unos segundos). <strong>🎲 Idea al azar</strong> mezcla elementos escritos a mano y es instantáneo.</p>';
    pintarIdea();
  }

  function pintarIdea() {
    var i = ideaActual;
    document.getElementById('tarjetaIdea').innerHTML = '' +
      '<article class="idea-card">' +
        '<div class="tags"><span class="tag tag-estado-publicado">' + esc(nombreSubgenero(i.subgenero)) + '</span>' +
          (i.duracion ? '<span class="tag">⏱ ' + esc(i.duracion) + '</span>' : '') +
          (i.ia ? '<span class="tag">✨ Creada con IA</span>' : '') + '</div>' +
        '<h2 class="idea-title">' + esc(i.titulo) + '</h2>' +
        '<div class="idea-fields">' +
          '<div class="idea-field idea-field-wide"><h3>Premisa</h3><p>' + esc(i.premisa) + '</p></div>' +
          '<div class="idea-field"><h3>Protagonista</h3><p>' + esc(i.protagonista) + '</p></div>' +
          '<div class="idea-field"><h3>Lugar</h3><p>' + esc(i.lugar) + '</p></div>' +
          '<div class="idea-field"><h3>Giro final</h3><p>' + esc(i.giro) + '</p></div>' +
          '<div class="idea-field"><h3>Tono</h3><p>' + esc(i.tono) + '</p></div>' +
          '<div class="idea-field idea-field-wide"><h3>Gancho para los primeros segundos</h3><p class="idea-hook">' + esc(i.gancho) + '</p></div>' +
        '</div>' +
        '<div class="idea-actions">' +
          '<button type="button" class="btn btn-primary" data-action="usar-idea">Crear proyecto con esta idea</button>' +
          '<button type="button" class="btn" data-action="copiar-idea">Copiar idea</button>' +
          '<button type="button" class="btn btn-ghost" data-action="generar-idea-ia">✨ Otra con IA</button>' +
          '<button type="button" class="btn btn-ghost" data-action="generar-idea">🎲 Otra al azar</button>' +
        '</div>' +
      '</article>';
  }

  function vistaEditor(id) {
    var p = editor && editor.proyecto.id === id ? editor.proyecto : Storage.obtener(id);
    if (!p) {
      app.innerHTML = '<div class="empty"><div class="empty-icon">👻</div><h3>Proyecto no encontrado</h3>' +
        '<p>Puede que haya sido eliminado o que se haya creado en otro navegador.</p>' +
        '<a class="btn btn-primary" href="#proyectos">Volver a proyectos</a></div>';
      editor = null;
      return;
    }
    editor = { proyecto: p, sucio: false, temporizador: null };

    app.innerHTML = '' +
      '<div class="editor-toolbar">' +
        '<div class="toolbar-left">' +
          '<a class="btn btn-sm btn-ghost" href="#proyectos">← Proyectos</a>' +
          '<span id="saveStatus" class="save-status">Guardado</span>' +
        '</div>' +
        '<div class="toolbar-actions">' +
          '<button type="button" class="btn btn-sm btn-primary" data-action="guardar" title="Ctrl + S">Guardar</button>' +
          '<button type="button" class="btn btn-sm" data-action="copiar" data-id="' + esc(p.id) + '">Copiar guion</button>' +
          '<button type="button" class="btn btn-sm" data-action="exportar" data-id="' + esc(p.id) + '">Exportar .txt</button>' +
          '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="eliminar" data-id="' + esc(p.id) + '">Eliminar</button>' +
        '</div>' +
      '</div>' +
      '<div class="editor-layout">' +
        '<aside class="panel editor-meta">' +
          '<h2>Datos del video</h2>' +
          '<label>Título<input type="text" data-field="titulo" maxlength="150" value="' + esc(p.titulo) + '"></label>' +
          '<label>Subgénero<select data-field="subgenero">' + opciones(Ideas.SUBGENEROS, p.subgenero) + '</select></label>' +
          '<label>Estado<select data-field="estado">' + opciones(ESTADOS, p.estado) + '</select></label>' +
          '<label>Premisa / descripción<textarea data-field="descripcion" rows="5" placeholder="¿De qué trata la historia?">' + esc(p.descripcion) + '</textarea></label>' +
          '<div class="editor-stats" id="editorStats"></div>' +
          '<p class="hint">Duración estimada a ' + PALABRAS_POR_MINUTO + ' palabras por minuto de narración. Se guarda automáticamente.</p>' +
          '<div class="voz-panel">' +
            '<h2>🎙️ Voz y audio</h2>' +
            '<label>Voz<select id="vozSelect"></select></label>' +
            '<label>Estilo de narración<select id="vozEstilo"></select></label>' +
            '<div class="voz-acciones">' +
              '<button type="button" class="btn btn-sm" data-action="voz-probar">▶ Escuchar prueba</button>' +
              '<button type="button" class="btn btn-sm btn-primary" data-action="voz-generar">🎙️ Generar audio de la historia</button>' +
            '</div>' +
            '<div id="vozProgreso" class="voz-progreso" hidden>' +
              '<progress max="1" value="0"></progress>' +
              '<p class="hint" id="vozMensaje"></p>' +
              '<button type="button" class="btn btn-sm btn-ghost" data-action="voz-cancelar">Cancelar</button>' +
            '</div>' +
            '<audio id="vozAudio" controls preload="metadata" hidden></audio>' +
            '<button type="button" class="btn btn-sm" data-action="voz-descargar" hidden>⬇ Descargar MP3</button>' +
            '<p class="hint">La voz lee la narración de todas las escenas, en orden. El audio se guarda en este navegador y se usa para crear el video.</p>' +
          '</div>' +
        '</aside>' +
        '<section>' +
          '<div class="scenes-head"><h2>Escenas</h2>' +
            '<button type="button" class="btn btn-sm" data-action="agregar-escena">+ Añadir escena</button></div>' +
          '<div class="guion-ia">' +
            '<label>Duración objetivo<select id="duracionObjetivo">' +
              [5, 8, 10, 12, 15].map(function (m) {
                return '<option value="' + m + '"' + (m === duracionObjetivo ? ' selected' : '') + '>' + m + ' minutos</option>';
              }).join('') +
            '</select></label>' +
            '<button type="button" class="btn btn-primary" data-action="guion-completo">✍️ Escribir guion completo con IA</button>' +
            '<p class="hint" id="guionMensaje">Escribe la narración de todas las escenas, una tras otra, con el largo necesario para la duración elegida.</p>' +
          '</div>' +
          '<div class="scene-list" id="listaEscenas"></div>' +
          '<button type="button" class="btn add-scene-big" data-action="agregar-escena">+ Añadir escena al final</button>' +
          '<div class="imagenes-seccion">' +
            '<div class="scenes-head"><h2>🖼️ Imágenes de la historia</h2></div>' +
            '<div class="img-controles">' +
              '<label>Formato<select id="imgFormato">' + Object.keys(Imagenes.FORMATOS).map(function (k) {
                return '<option value="' + esc(k) + '">' + esc(Imagenes.FORMATOS[k].nombre) + '</option>';
              }).join('') + '</select></label>' +
              '<label>Imágenes por escena<select id="imgPorEscena"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label>' +
              '<label class="check"><input type="checkbox" id="imgReferencia" checked> Usar la primera imagen como referencia de personajes</label>' +
            '</div>' +
            '<div class="img-acciones">' +
              '<button type="button" class="btn" data-action="img-plan">🧠 1. Crear descripciones visuales con IA</button>' +
              '<button type="button" class="btn btn-primary" data-action="img-generar">🖼️ 2. Generar imágenes</button>' +
              '<button type="button" class="btn btn-ghost" data-action="img-detener" hidden>⏹ Detener</button>' +
              '<button type="button" class="btn" data-action="img-descargar-todas" hidden>⬇ Descargar todas</button>' +
            '</div>' +
            '<div id="imgProgreso" class="voz-progreso" hidden><progress max="1" value="0"></progress><p class="hint" id="imgMensaje"></p></div>' +
            '<div id="galeria" class="galeria"></div>' +
            '<p class="hint">Las descripciones las escribe Gemini; las imágenes, Workers AI de Cloudflare (unas 90 gratis al día en 16:9). ' +
              'Se guardan en este navegador: descárgalas para no perderlas.</p>' +
          '</div>' +
          '<div class="video-seccion">' +
            '<div class="scenes-head"><h2>🎬 Video MP4</h2></div>' +
            '<ul class="requisitos" id="videoRequisitos"></ul>' +
            '<div class="img-controles">' +
              '<label>Formato<select id="videoFormato">' + Object.keys(Video.FORMATOS).map(function (k) {
                return '<option value="' + esc(k) + '">' + esc(Video.FORMATOS[k].nombre) + '</option>';
              }).join('') + '</select></label>' +
              '<label>Música ambiental<select id="videoMusica">' + opciones(Video.MUSICAS, 'dron') + '</select></label>' +
              '<label>Volumen de la música <span id="videoVolumenValor">25%</span><input type="range" id="videoVolumen" min="0" max="100" value="25"></label>' +
              '<label id="videoArchivoCaja" hidden>Archivo de música<input type="file" id="videoArchivo" accept="audio/*"></label>' +
              '<label class="check"><input type="checkbox" id="videoSubtitulos" checked> Subtítulos dentro del video</label>' +
            '</div>' +
            '<div class="img-acciones">' +
              '<button type="button" class="btn" data-action="video-previa">👁 Vista previa (30 s)</button>' +
              '<button type="button" class="btn btn-primary" data-action="video-crear">🎬 Crear video completo</button>' +
              '<button type="button" class="btn btn-ghost" data-action="video-cancelar" hidden>⏹ Cancelar</button>' +
            '</div>' +
            '<div id="videoProgreso" class="voz-progreso" hidden><progress max="1" value="0"></progress><p class="hint" id="videoMensaje"></p></div>' +
            '<div id="videoResultado" hidden>' +
              '<video id="videoReproductor" controls playsinline></video>' +
              '<div class="img-acciones">' +
                '<button type="button" class="btn btn-primary" data-action="video-descargar">⬇ Descargar MP4</button>' +
                '<button type="button" class="btn" data-action="video-srt">⬇ Subtítulos .srt (para YouTube)</button>' +
              '</div>' +
              '<p class="hint" id="videoInfo"></p>' +
            '</div>' +
            '<p class="hint">El video se crea dentro de tu navegador (Chrome o Edge en computadora), sin servidores ni costos. ' +
              'Un video de 10 minutos puede tardar varios minutos: no cierres la pestaña mientras se crea.</p>' +
          '</div>' +
          seccionYouTube() +
        '</section>' +
      '</div>';

    pintarEscenas();
    prepararPanelVoz();
    prepararImagenes(p);
    actualizarRequisitosVideo();
    prepararYouTube(p);
  }

  function pintarEscenas() {
    var cont = document.getElementById('listaEscenas');
    var escenas = editor.proyecto.escenas;
    if (!escenas.length) {
      cont.innerHTML = '<div class="empty"><div class="empty-icon">🎞️</div><h3>Sin escenas</h3><p>Añade la primera escena de tu guion.</p></div>';
    } else {
      cont.innerHTML = escenas.map(function (e, i) {
        var palabras = contarPalabras(e.narracion);
        return '' +
          '<article class="scene" data-scene-id="' + esc(e.id) + '">' +
            '<div class="scene-head">' +
              '<span class="scene-num">Escena ' + (i + 1) + '</span>' +
              '<input type="text" class="scene-title" data-sfield="titulo" placeholder="Título de la escena" aria-label="Título de la escena ' + (i + 1) + '" value="' + esc(e.titulo) + '">' +
              '<div class="scene-tools">' +
                '<button type="button" class="btn btn-icon" data-action="subir-escena" title="Mover arriba" aria-label="Mover escena arriba"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
                '<button type="button" class="btn btn-icon" data-action="bajar-escena" title="Mover abajo" aria-label="Mover escena abajo"' + (i === escenas.length - 1 ? ' disabled' : '') + '>↓</button>' +
                '<button type="button" class="btn btn-icon" data-action="duplicar-escena" title="Duplicar" aria-label="Duplicar escena">⧉</button>' +
                '<button type="button" class="btn btn-icon btn-danger-ghost" data-action="eliminar-escena" title="Eliminar" aria-label="Eliminar escena">✕</button>' +
              '</div>' +
            '</div>' +
            '<div class="scene-ai"><button type="button" class="btn btn-sm" data-action="narracion-ia">✨ Escribir narración con IA</button></div>' +
            '<label>Narración (voz en off)<textarea data-sfield="narracion" rows="5" placeholder="Lo que dirá el narrador en esta escena…">' + esc(e.narracion) + '</textarea></label>' +
            '<div class="scene-grid">' +
              '<label>Visual / imágenes<textarea data-sfield="visual" rows="3" placeholder="Qué se ve en pantalla…">' + esc(e.visual) + '</textarea></label>' +
              '<label>Sonido y música<textarea data-sfield="sonido" rows="3" placeholder="Ambiente, efectos, música…">' + esc(e.sonido) + '</textarea></label>' +
            '</div>' +
            '<label>Notas de producción<textarea data-sfield="notas" rows="2" placeholder="Ideas, recordatorios, referencias…">' + esc(e.notas) + '</textarea></label>' +
            '<div class="scene-foot"><span data-scene-stats>' + palabras + ' palabra' + (palabras === 1 ? '' : 's') + ' · ' + formatoDuracion(palabras) + ' min</span></div>' +
          '</article>';
      }).join('');
    }
    pintarEstadisticasEditor();
  }

  function pintarEstadisticasEditor() {
    var el = document.getElementById('editorStats');
    if (!el || !editor) return;
    var st = estadisticas(editor.proyecto);
    el.innerHTML =
      '<div><strong>' + st.escenas + '</strong><span>Escenas</span></div>' +
      '<div><strong>' + st.palabras + '</strong><span>Palabras</span></div>' +
      '<div><strong>' + st.duracion + '</strong><span>Minutos</span></div>';
  }

  /* ---------------- Editor: escenas ---------------- */

  function indiceEscena(boton) {
    var art = boton.closest('[data-scene-id]');
    if (!art) return -1;
    var id = art.getAttribute('data-scene-id');
    return editor.proyecto.escenas.findIndex(function (e) { return e.id === id; });
  }

  function escenaTieneContenido(e) {
    return [e.titulo, e.narracion, e.visual, e.sonido, e.notas].some(function (t) { return t.trim(); });
  }

  function accionEscena(accion, boton) {
    var escenas = editor.proyecto.escenas;
    var i = indiceEscena(boton);
    var enfocar = null;

    if (accion === 'agregar-escena') {
      var nueva = Storage.nuevaEscena();
      escenas.push(nueva);
      enfocar = nueva.id;
    } else if (i < 0) {
      return;
    } else if (accion === 'subir-escena' && i > 0) {
      escenas.splice(i - 1, 0, escenas.splice(i, 1)[0]);
    } else if (accion === 'bajar-escena' && i < escenas.length - 1) {
      escenas.splice(i + 1, 0, escenas.splice(i, 1)[0]);
    } else if (accion === 'duplicar-escena') {
      var copia = Storage.nuevaEscena(escenas[i]);
      if (copia.titulo) copia.titulo += ' (copia)';
      escenas.splice(i + 1, 0, copia);
    } else if (accion === 'eliminar-escena') {
      var quitar = function () {
        escenas.splice(i, 1);
        cambioEnEditor();
        pintarEscenas();
      };
      if (escenaTieneContenido(escenas[i])) {
        confirmar('¿Eliminar escena ' + (i + 1) + '?', 'Se perderá el texto de esta escena.', 'Eliminar')
          .then(function (ok) { if (ok && editor) quitar(); });
      } else {
        quitar();
      }
      return;
    } else {
      return;
    }

    cambioEnEditor();
    pintarEscenas();

    if (enfocar) {
      var el = app.querySelector('[data-scene-id="' + enfocar + '"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.querySelector('.scene-title').focus({ preventScroll: true });
      }
    }
  }

  /* ---------------- Inteligencia artificial ---------------- */

  var iaOcupada = false;

  // Desactiva los botones de IA mientras Gemini trabaja, para no enviar pedidos repetidos.
  function marcarIaOcupada(ocupada, botonActivo) {
    iaOcupada = ocupada;
    Array.prototype.forEach.call(document.querySelectorAll('[data-action$="-ia"]'), function (b) {
      b.disabled = ocupada;
    });
    if (botonActivo) {
      if (ocupada) {
        botonActivo.setAttribute('data-texto', botonActivo.textContent);
        botonActivo.textContent = '⏳ Generando…';
      } else if (botonActivo.getAttribute('data-texto')) {
        botonActivo.textContent = botonActivo.getAttribute('data-texto');
      }
    }
  }

  function generarIdeaIA(boton) {
    if (iaOcupada) return;
    marcarIaOcupada(true, boton);
    IA.generarIdea(subgeneroIdeas).then(function (idea) {
      ideaActual = idea;
      if (ruta().vista === 'ideas') pintarIdea();
      aviso('Idea creada con IA');
    }, function (err) {
      aviso(err.message, 'error');
    }).finally(function () {
      marcarIaOcupada(false, boton);
    });
  }

  var duracionObjetivo = 10;     // minutos
  var guionDetenido = false;

  // Palabras por escena para llegar a la duración elegida.
  function palabrasPorEscena(proyecto) {
    return duracionObjetivo * PALABRAS_POR_MINUTO / Math.max(1, proyecto.escenas.length);
  }

  function guionCompletoIA(boton) {
    if (!editor) return;
    if (boton.getAttribute('data-corriendo')) {   // segundo clic: detener
      guionDetenido = true;
      boton.textContent = '⏳ Deteniendo al terminar la escena actual…';
      return;
    }
    if (iaOcupada) return;
    var proyecto = editor.proyecto;
    if (!proyecto.escenas.length) { aviso('Añade al menos una escena primero.', 'error'); return; }

    var tieneTexto = proyecto.escenas.some(function (e) { return e.narracion.trim(); });
    var seguir = tieneTexto
      ? confirmar('¿Escribir el guion completo?', 'Gemini reescribirá la narración de las ' + proyecto.escenas.length +
          ' escenas usando el texto actual como base. Puede tardar varios minutos.', 'Escribir')
      : Promise.resolve(true);

    seguir.then(function (ok) {
      if (!ok) return;
      var ids = proyecto.escenas.map(function (e) { return e.id; });
      var palabras = palabrasPorEscena(proyecto);
      var mensaje = function (t) { var el = document.getElementById('guionMensaje'); if (el) el.textContent = t; };
      var botonActual = function () { return document.querySelector('[data-action="guion-completo"]'); };
      guionDetenido = false;
      marcarIaOcupada(true);
      boton.setAttribute('data-corriendo', '1');
      boton.disabled = false;
      boton.textContent = '⏹ Detener';
      var k = 0;

      function siguiente() {
        if (!editor || editor.proyecto !== proyecto) return Promise.resolve('salio');
        if (guionDetenido) return Promise.resolve('detenido');
        if (k >= ids.length) return Promise.resolve('listo');
        var i = proyecto.escenas.findIndex(function (e) { return e.id === ids[k]; });
        if (i < 0) { k++; return siguiente(); }   // escena borrada mientras tanto
        mensaje('⏳ Escribiendo escena ' + (k + 1) + ' de ' + ids.length + '… (cada una puede tardar hasta un minuto)');
        return IA.escribirNarracion(proyecto, i, palabras).then(function (texto) {
          if (!editor || editor.proyecto !== proyecto) return 'salio';
          var escena = proyecto.escenas.find(function (e) { return e.id === ids[k]; });
          if (escena) escena.narracion = texto;
          cambioEnEditor();
          pintarEscenas();
          k++;
          return siguiente();
        });
      }

      siguiente().then(function (fin) {
        if (fin === 'listo') aviso('Guion completo escrito: ' + estadisticas(proyecto).duracion + ' min estimados');
        else if (fin === 'detenido') aviso('Guion detenido. Se guardaron las escenas ya escritas.');
        mensaje(fin === 'listo' ? '✅ Guion listo. Ya puedes generar el audio.' : 'Escribe la narración de todas las escenas, una tras otra.');
      }, function (err) {
        aviso(err.message + ' Se guardaron las escenas ya escritas.', 'error');
        mensaje('Se detuvo en la escena ' + (k + 1) + '. Pulsa el botón otra vez para reintentar.');
      }).finally(function () {
        var b = botonActual();
        if (b) {
          b.removeAttribute('data-corriendo');
          b.textContent = '✍️ Escribir guion completo con IA';
        }
        marcarIaOcupada(false);
      });
    });
  }

  function narracionIA(boton) {
    if (iaOcupada || !editor) return;
    var i = indiceEscena(boton);
    if (i < 0) return;
    var proyecto = editor.proyecto;
    var idEscena = proyecto.escenas[i].id;

    var seguir = proyecto.escenas[i].narracion.trim()
      ? confirmar('¿Reescribir la narración?', 'Gemini usará el texto actual como borrador y lo reemplazará por una versión nueva.', 'Reescribir')
      : Promise.resolve(true);

    seguir.then(function (ok) {
      if (!ok) return;
      marcarIaOcupada(true, boton);
      return IA.escribirNarracion(proyecto, i, palabrasPorEscena(proyecto)).then(function (texto) {
        // El usuario pudo cambiar de pantalla o borrar la escena mientras esperaba.
        if (!editor || editor.proyecto !== proyecto) return;
        var escena = proyecto.escenas.find(function (e) { return e.id === idEscena; });
        if (!escena) return;
        escena.narracion = texto;
        cambioEnEditor();
        pintarEscenas();
        aviso('Narración escrita con IA');
      }, function (err) {
        aviso(err.message, 'error');
      }).finally(function () {
        marcarIaOcupada(false, boton);
      });
    });
  }

  /* ---------------- Voces ---------------- */

  var voces = null;        // lista cargada una vez por visita
  var cargandoVoces = null;
  var vozOcupada = false;
  var vozCancelada = false;
  var audioVoz = null;     // { proyectoId, wav, muestras?, frecuencia, segmentos, duracion, url, mp3 }
  var audioPrueba = null;  // URL de la última prueba

  // Google nombra sus voces en inglés; aquí se traducen para que se entiendan.
  var TIPOS_VOZ = {
    'Authoritative Advisor': 'Asesor serio',
    'Digital Assistant': 'Asistente',
    'Commercial Voiceover': 'Locutor comercial',
    'Training Voiceover': 'Locutor de cursos',
    'Podcaster': 'Podcaster',
    'Tech Advisor': 'Asesor técnico',
    'Tutor': 'Tutor',
    'Concierge': 'Recepcionista',
    'Call Center Agent': 'Agente telefónico'
  };

  function paisVoz(v) {
    var t = (v.acento || '') + ' ' + (v.descripcion || '');
    if (/mexic/i.test(t)) return 'México';
    if (/argentin/i.test(t)) return 'Argentina';
    if (/colombi/i.test(t)) return 'Colombia';
    if (/chile/i.test(t)) return 'Chile';
    if (/peru|perú/i.test(t)) return 'Perú';
    if (/venezol/i.test(t)) return 'Venezuela';
    return 'Latinoamérica';
  }

  function etiquetaVoz(v) {
    if (v.proveedor === 'azure') return v.nombre;
    if (!v.latina) return v.nombre + ' — ' + v.descripcion;
    var nombre = v.nombre.replace(/^(.*?)(\s+\d+)?$/, function (_, tipo, num) {
      return (TIPOS_VOZ[tipo] || tipo) + (num || '');
    });
    var edad = /(\d{2})-year-old/.exec(v.descripcion || '');
    return nombre + (edad ? ' · ' + edad[1] + ' años' : '');
  }

  function pintarSelectVoces() {
    var sel = document.getElementById('vozSelect');
    if (!sel) return;
    var pref = Voz.leerPreferencias();
    var lista = voces || Voz.VOCES_RESPALDO;
    var latinas = lista.filter(function (v) { return v.latina && (v.genero === 'male' || v.genero === 'female'); });
    var paises = [];
    latinas.forEach(function (v) { if (paises.indexOf(paisVoz(v)) === -1) paises.push(paisVoz(v)); });
    paises.sort(function (a, b) { return (a === 'México' ? -1 : 0) - (b === 'México' ? -1 : 0); });

    // Primero Azure (rápida y con mucho cupo gratis), México arriba.
    var grupos = [];
    var azure = lista.filter(function (v) { return v.proveedor === 'azure'; });
    var paisesAzure = [];
    azure.forEach(function (v) { if (paisesAzure.indexOf(v.pais) === -1) paisesAzure.push(v.pais); });
    paisesAzure.sort(function (a, b) { return a === 'México' ? -1 : b === 'México' ? 1 : a.localeCompare(b); });
    paisesAzure.forEach(function (pais) {
      [['male', 'masculinas'], ['female', 'femeninas']].forEach(function (g) {
        grupos.push(['⚡ Azure · ' + pais + ' — voces ' + g[1], azure.filter(function (v) { return v.pais === pais && v.genero === g[0]; })]);
      });
    });

    paises.forEach(function (pais) {
      [['male', 'masculinas'], ['female', 'femeninas']].forEach(function (g) {
        grupos.push(['Gemini · ' + pais + ' — voces ' + g[1], latinas.filter(function (v) { return paisVoz(v) === pais && v.genero === g[0]; })]);
      });
    });
    grupos.push(['Gemini · voces básicas masculinas', lista.filter(function (v) { return !v.latina && !v.proveedor && v.genero === 'male'; })]);
    grupos.push(['Gemini · voces básicas femeninas', lista.filter(function (v) { return !v.latina && !v.proveedor && v.genero === 'female'; })]);
    grupos.push(['Respaldo (si las demás están al límite)', [Voz.VOZ_CLOUDFLARE]]);

    sel.innerHTML = grupos.filter(function (g) { return g[1].length; }).map(function (g) {
      return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (v) {
        return '<option value="' + esc(v.id) + '"' + (v.id === pref.voz ? ' selected' : '') +
          ' title="' + esc(v.descripcion) + '">' + esc(etiquetaVoz(v)) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }

  function prepararPanelVoz() {
    var pref = Voz.leerPreferencias();
    document.getElementById('vozEstilo').innerHTML = Object.keys(Voz.ESTILOS).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === pref.estilo ? ' selected' : '') + '>' + esc(Voz.ESTILOS[k].nombre) + '</option>';
    }).join('');
    pintarSelectVoces();
    if (!voces && !cargandoVoces && location.protocol !== 'file:') {
      cargandoVoces = Voz.cargarVoces().then(function (lista) {
        voces = lista;
        pintarSelectVoces();
      });
    }
    // Si este proyecto ya tiene audio (en esta visita o guardado en el navegador), se vuelve a mostrar.
    var id = editor.proyecto.id;
    if (audioVoz && audioVoz.proyectoId === id) { mostrarAudio(audioVoz.url); return; }
    Almacen.obtener('audios', id).then(function (guardado) {
      if (!guardado || !editor || editor.proyecto.id !== id) return;
      if (audioVoz) URL.revokeObjectURL(audioVoz.url);
      audioVoz = {
        proyectoId: id, wav: guardado.wav, frecuencia: guardado.frecuencia, segmentos: guardado.segmentos || [],
        duracion: guardado.duracion, url: URL.createObjectURL(guardado.wav), mp3: null
      };
      mostrarAudio(audioVoz.url);
    }, function () { /* sin audio guardado */ });
  }

  // Muestras de 16 bits del audio (el WAV guardado tiene 44 bytes de cabecera).
  function muestrasDe(audio) {
    if (audio.muestras) return Promise.resolve(audio.muestras);
    return audio.wav.arrayBuffer().then(function (b) { return new Int16Array(b, 44, (b.byteLength - 44) >> 1); });
  }

  function vozElegida() {
    var id = document.getElementById('vozSelect').value;
    var lista = voces || Voz.VOCES_RESPALDO;
    return lista.concat([Voz.VOZ_CLOUDFLARE]).find(function (v) { return v.id === id; }) || Voz.VOCES_RESPALDO[0];
  }

  function guardarEleccionVoz() {
    Voz.guardarPreferencias({ voz: document.getElementById('vozSelect').value, estilo: document.getElementById('vozEstilo').value });
  }

  function marcarVozOcupada(ocupada) {
    vozOcupada = ocupada;
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="voz-probar"], [data-action="voz-generar"], #vozSelect, #vozEstilo'), function (b) {
      b.disabled = ocupada;
    });
  }

  function mostrarProgreso(fraccion, mensaje) {
    var caja = document.getElementById('vozProgreso');
    if (!caja) return;
    caja.hidden = fraccion === null;
    if (fraccion === null) return;
    caja.querySelector('progress').value = fraccion;
    document.getElementById('vozMensaje').textContent = mensaje;
  }

  function mostrarAudio(url) {
    var reproductor = document.getElementById('vozAudio');
    if (!reproductor) return;
    reproductor.src = url;
    reproductor.hidden = false;
    document.querySelector('[data-action="voz-descargar"]').hidden = false;
    actualizarRequisitosVideo();
  }

  function probarVoz(boton) {
    if (vozOcupada) return;
    guardarEleccionVoz();
    var texto = boton.textContent;
    marcarVozOcupada(true);
    boton.textContent = '⏳ Generando prueba…';
    Voz.probar(vozElegida(), document.getElementById('vozEstilo').value).then(function (blob) {
      if (audioPrueba) URL.revokeObjectURL(audioPrueba);
      audioPrueba = URL.createObjectURL(blob);
      new Audio(audioPrueba).play().catch(function () {
        aviso('El navegador bloqueó la reproducción. Pulsa otra vez "Escuchar prueba".', 'error');
      });
    }, function (err) {
      aviso(err.message, 'error');
    }).finally(function () {
      boton.textContent = texto;
      marcarVozOcupada(false);
    });
  }

  function generarAudio() {
    if (vozOcupada || !editor) return;
    guardarPendiente();
    guardarEleccionVoz();
    var proyecto = editor.proyecto;
    vozCancelada = false;
    marcarVozOcupada(true);
    mostrarProgreso(0, 'Preparando…');

    Voz.narrarProyecto(proyecto, vozElegida(), document.getElementById('vozEstilo').value, function (p) {
      if (editor && editor.proyecto === proyecto) mostrarProgreso(p.hecho / p.total, p.mensaje);
    }, function () { return vozCancelada; }).then(function (a) {
      if (audioVoz) URL.revokeObjectURL(audioVoz.url);
      var wav = Voz.aWav(a.muestras, a.frecuencia);
      audioVoz = {
        proyectoId: proyecto.id, muestras: a.muestras, wav: wav, frecuencia: a.frecuencia, segmentos: a.segmentos,
        duracion: a.duracion, url: URL.createObjectURL(wav), mp3: null
      };
      // Se guarda en el navegador para no perderlo y para poder crear el video después.
      Almacen.poner('audios', {
        proyectoId: proyecto.id, wav: wav, frecuencia: a.frecuencia, segmentos: a.segmentos,
        duracion: a.duracion, creado: new Date().toISOString()
      }).catch(function (err) { aviso(err.message, 'error'); });
      if (editor && editor.proyecto === proyecto) {
        mostrarAudio(audioVoz.url);
        aviso(a.respaldo
          ? 'La voz elegida llegó a su límite, así que se usó la voz de Cloudflare. Audio listo: ' + formatoDuracion(a.duracion * PALABRAS_POR_MINUTO / 60) + ' min'
          : 'Audio listo: ' + formatoDuracion(a.duracion * PALABRAS_POR_MINUTO / 60) + ' min');
      }
    }, function (err) {
      aviso(err.message, 'error');
    }).finally(function () {
      mostrarProgreso(null);
      marcarVozOcupada(false);
    });
  }

  function descargarMp3(boton) {
    if (!audioVoz || vozOcupada) return;
    var proyecto = obtenerProyecto(audioVoz.proyectoId);
    var nombre = nombreArchivo(proyecto ? proyecto.titulo : 'narracion').replace(/\.txt$/, '.mp3');
    var bajar = function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    };
    if (audioVoz.mp3) { bajar(audioVoz.mp3); return; }

    marcarVozOcupada(true);
    boton.disabled = true;
    mostrarProgreso(0, 'Convirtiendo a MP3…');
    var actual = audioVoz;
    muestrasDe(actual).then(function (muestras) {
      return Voz.aMp3(muestras, actual.frecuencia, function (f) {
        mostrarProgreso(f, 'Convirtiendo a MP3… ' + Math.round(f * 100) + '%');
      });
    }).then(function (blob) {
      actual.mp3 = blob;
      bajar(blob);
      aviso('MP3 descargado');
    }, function (err) {
      aviso(err.message, 'error');
    }).finally(function () {
      boton.disabled = false;
      mostrarProgreso(null);
      marcarVozOcupada(false);
    });
  }

  /* ---------------- Imágenes ---------------- */

  var galeria = null;        // galería del proyecto abierto
  var imgOcupada = false;
  var imgDetener = false;
  var urlsGaleria = [];      // direcciones temporales de las imágenes mostradas

  function prepararImagenes(p) {
    galeria = null;
    pintarGaleria();
    Imagenes.cargar(p.id).then(function (g) {
      if (!editor || editor.proyecto.id !== p.id) return;
      galeria = g;
      if (g && Imagenes.FORMATOS[g.formato]) document.getElementById('imgFormato').value = g.formato;
      pintarGaleria();
    }, function (err) {
      aviso(err.message, 'error');
    });
  }

  function numeroEscena(escenaId) {
    var i = editor ? editor.proyecto.escenas.findIndex(function (e) { return e.id === escenaId; }) : -1;
    return i + 1;
  }

  // Imágenes ya mostradas: solo las nuevas aparecen con un fundido (no en cada redibujo).
  var imagenesVistas = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function pintarGaleria() {
    var cont = document.getElementById('galeria');
    if (!cont) return;
    urlsGaleria.forEach(function (u) { URL.revokeObjectURL(u); });
    urlsGaleria = [];
    var todas = document.querySelector('[data-action="img-descargar-todas"]');

    if (!galeria || !galeria.tomas.length) {
      cont.innerHTML = '<div class="empty galeria-vacia"><div class="empty-icon">🖼️</div>' +
        '<p>Aún no hay imágenes. Primero escribe el guion; luego pulsa <strong>1. Crear descripciones visuales</strong> y <strong>2. Generar imágenes</strong>.</p></div>';
      if (todas) todas.hidden = true;
      actualizarRequisitosVideo();
      return;
    }
    var formato = Imagenes.FORMATOS[galeria.formato] || Imagenes.FORMATOS['16:9'];
    var contador = {};
    cont.innerHTML = galeria.tomas.map(function (t) {
      var n = numeroEscena(t.escenaId);
      contador[n] = (contador[n] || 0) + 1;
      var url = '';
      var nueva = false;
      if (t.imagen) {
        url = URL.createObjectURL(t.imagen);
        urlsGaleria.push(url);
        if (imagenesVistas && !imagenesVistas.has(t.imagen)) { nueva = true; imagenesVistas.add(t.imagen); }
      }
      return '' +
        '<figure class="toma" data-toma="' + esc(t.id) + '">' +
          '<div class="toma-imagen" style="aspect-ratio:' + formato.ancho + '/' + formato.alto + '">' +
            (url ? '<img src="' + url + '" alt="' + esc(t.descripcion) + '" loading="lazy"' + (nueva ? ' class="img-nueva"' : '') + '>'
              : '<div class="toma-vacia' + (t.error ? ' con-error' : '') + '">' + esc(t.error || 'Pendiente') + '</div>') +
          '</div>' +
          '<figcaption>' +
            '<strong>' + (n ? 'Escena ' + n + ' · imagen ' + contador[n] : 'Escena eliminada') + '</strong>' +
            '<span>' + esc(t.descripcion) + '</span>' +
          '</figcaption>' +
          '<div class="toma-acciones">' +
            '<button type="button" class="btn btn-sm" data-action="img-regenerar">↻ ' + (t.imagen ? 'Regenerar' : 'Generar') + '</button>' +
            (t.imagen ? '<button type="button" class="btn btn-sm" data-action="img-descargar">⬇ Descargar</button>' : '') +
          '</div>' +
        '</figure>';
    }).join('');
    if (todas) todas.hidden = !galeria.tomas.some(function (t) { return t.imagen; });
    actualizarRequisitosVideo();
  }

  function marcarImgOcupada(ocupada) {
    imgOcupada = ocupada;
    Array.prototype.forEach.call(document.querySelectorAll('[data-action^="img-"]:not([data-action="img-detener"]), #imgFormato, #imgPorEscena'), function (b) {
      b.disabled = ocupada;
    });
    var detener = document.querySelector('[data-action="img-detener"]');
    if (detener) { detener.hidden = !ocupada; detener.disabled = false; }
  }

  function progresoImg(fraccion, mensaje) {
    var caja = document.getElementById('imgProgreso');
    if (!caja) return;
    caja.hidden = fraccion === null;
    if (fraccion === null) return;
    caja.querySelector('progress').value = fraccion;
    document.getElementById('imgMensaje').textContent = mensaje;
  }

  // Paso 1: Gemini crea el plan visual (personajes, lugares, estilo y tomas).
  function crearPlanVisual() {
    if (!editor) return Promise.resolve(false);
    var proyecto = editor.proyecto;
    var hayImagenes = galeria && galeria.tomas.some(function (t) { return t.imagen; });
    var seguir = hayImagenes
      ? confirmar('¿Crear descripciones nuevas?', 'Se borrarán las imágenes actuales de este proyecto (descárgalas antes si quieres conservarlas).', 'Crear nuevas')
      : Promise.resolve(true);

    return seguir.then(function (ok) {
      if (!ok) return false;
      guardarPendiente();
      marcarImgOcupada(true);
      progresoImg(0.05, '🧠 Gemini está analizando la historia y describiendo cada imagen… (puede tardar hasta un minuto)');
      var porEscena = Number(document.getElementById('imgPorEscena').value) || 2;
      var formato = document.getElementById('imgFormato').value;
      return Imagenes.planificar(proyecto, porEscena).then(function (plan) {
        var nueva = Imagenes.nuevaGaleria(proyecto.id, formato, plan);
        return Imagenes.guardar(nueva).then(function () {
          if (!editor || editor.proyecto !== proyecto) return false;
          galeria = nueva;
          // Copia las descripciones al campo "Visual" de las escenas que lo tengan vacío.
          var cambio = false;
          proyecto.escenas.forEach(function (e) {
            if (e.visual.trim()) return;
            var textos = nueva.tomas.filter(function (t) { return t.escenaId === e.id; }).map(function (t) { return t.descripcion; });
            if (textos.length) { e.visual = textos.join('\n'); cambio = true; }
          });
          if (cambio) { cambioEnEditor(); pintarEscenas(); }
          pintarGaleria();
          aviso(nueva.tomas.length + ' descripciones visuales listas');
          return true;
        });
      }).catch(function (err) {
        aviso(err.message, 'error');
        return false;
      }).finally(function () {
        progresoImg(null);
        marcarImgOcupada(false);
      });
    });
  }

  function generarUna(toma, semilla) {
    var usarReferencia = document.getElementById('imgReferencia');
    var base = usarReferencia && usarReferencia.checked ? Imagenes.primeraImagen(galeria, toma.id) : null;
    var actual = galeria;
    return (base ? Imagenes.referenciaDesde(base) : Promise.resolve(null)).then(function (ref) {
      return Imagenes.generarToma(toma, actual, ref, semilla);
    }).then(function (blob) {
      toma.imagen = blob;
      toma.error = '';
      return Imagenes.guardar(actual);
    }, function (err) {
      toma.error = err.message;
      Imagenes.guardar(actual).catch(function () {});
      throw err;
    });
  }

  // Paso 2: dibuja todas las tomas que aún no tienen imagen.
  function generarImagenes() {
    if (imgOcupada || !editor) return;
    var proyecto = editor.proyecto;
    var preparar = galeria && galeria.tomas.length ? Promise.resolve(true) : crearPlanVisual();
    preparar.then(function (ok) {
      if (!ok || !galeria || !editor || editor.proyecto !== proyecto) return;
      galeria.formato = document.getElementById('imgFormato').value;
      var pendientes = galeria.tomas.filter(function (t) { return !t.imagen; });
      if (!pendientes.length) { aviso('Todas las imágenes ya están generadas. Usa "Regenerar" en la que quieras cambiar.'); return; }

      imgDetener = false;
      marcarImgOcupada(true);
      var hechas = 0, fallidas = 0, k = 0;
      function siguiente() {
        if (!editor || editor.proyecto !== proyecto) return Promise.resolve();
        if (imgDetener || k >= pendientes.length) return Promise.resolve();
        progresoImg(k / pendientes.length, '🖼️ Generando imagen ' + (k + 1) + ' de ' + pendientes.length + '… (unos segundos cada una)');
        var toma = pendientes[k++];
        return generarUna(toma).then(function () {
          hechas++;
        }, function (err) {
          fallidas++;
          if (err.estado === 429) { imgDetener = true; aviso(err.message, 'error'); }
        }).then(function () {
          pintarGaleria();
          return siguiente();
        });
      }
      return siguiente().then(function () {
        if (hechas) aviso(hechas + ' imagen' + (hechas === 1 ? '' : 'es') + ' generada' + (hechas === 1 ? '' : 's') + (fallidas ? ' · ' + fallidas + ' con error' : ''));
        else if (fallidas) aviso('No se pudo generar ninguna imagen. Revisa el mensaje en cada tarjeta.', 'error');
      }).finally(function () {
        progresoImg(null);
        marcarImgOcupada(false);
      });
    });
  }

  function tomaDeBoton(boton) {
    var fig = boton.closest('[data-toma]');
    if (!fig || !galeria) return null;
    var id = fig.getAttribute('data-toma');
    return galeria.tomas.find(function (t) { return t.id === id; }) || null;
  }

  function regenerarImagen(boton) {
    if (imgOcupada) return;
    var toma = tomaDeBoton(boton);
    if (!toma) return;
    galeria.formato = document.getElementById('imgFormato').value;
    marcarImgOcupada(true);
    boton.textContent = '⏳ Generando…';
    // Otra semilla para que salga una imagen distinta.
    generarUna(toma, toma.imagen ? Math.floor(Math.random() * 2000000000) : undefined).then(function () {
      aviso('Imagen generada');
    }, function (err) {
      aviso(err.message, 'error');
    }).finally(function () {
      marcarImgOcupada(false);
      pintarGaleria();
    });
  }

  function nombreImagen(toma, indice) {
    var base = nombreArchivo(editor ? editor.proyecto.titulo : 'imagen').replace(/\.txt$/, '');
    var ext = toma.imagen.type === 'image/png' ? '.png' : toma.imagen.type === 'image/webp' ? '.webp' : '.jpg';
    var n = numeroEscena(toma.escenaId);
    return base + '-' + String(indice + 1).padStart(2, '0') + (n ? '-escena-' + n : '') + ext;
  }

  function descargarBlob(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function descargarImagen(boton) {
    var toma = tomaDeBoton(boton);
    if (toma && toma.imagen) descargarBlob(toma.imagen, nombreImagen(toma, galeria.tomas.indexOf(toma)));
  }

  function descargarTodas() {
    if (!galeria) return;
    var lista = galeria.tomas.filter(function (t) { return t.imagen; });
    lista.forEach(function (t, i) {
      // Pequeña pausa entre descargas para que el navegador no las bloquee.
      setTimeout(function () { descargarBlob(t.imagen, nombreImagen(t, galeria.tomas.indexOf(t))); }, i * 400);
    });
    if (lista.length) aviso('Descargando ' + lista.length + ' imágenes. Si el navegador pregunta, permite las descargas múltiples.');
  }

  /* ---------------- Video MP4 ---------------- */

  var videoOcupado = false;
  var videoCancelado = false;
  var videoHecho = null;     // { proyectoId, blob, url, subtitulos, completo }

  // Muestra qué falta para poder crear el video.
  function actualizarRequisitosVideo() {
    var lista = document.getElementById('videoRequisitos');
    if (!lista || !editor) return;
    var id = editor.proyecto.id;
    var audio = audioVoz && audioVoz.proyectoId === id ? audioVoz : null;
    var imagenes = galeria ? galeria.tomas.filter(function (t) { return t.imagen; }).length : 0;
    var comp = Video.compatible();
    var items = [
      [!!audio, audio
        ? 'Narración lista (' + formatoDuracion(audio.duracion * PALABRAS_POR_MINUTO / 60) + ' min)' +
          (audio.segmentos && audio.segmentos.length ? '' : ' — sin datos de tiempo: vuelve a generar el audio para tener subtítulos')
        : 'Falta la narración: genera el audio en "🎙️ Voz y audio"'],
      [imagenes > 0, imagenes ? imagenes + ' imágenes listas' : 'Faltan las imágenes: genéralas en "🖼️ Imágenes de la historia"'],
      [comp.ok, comp.ok ? 'Navegador compatible' : comp.motivo]
    ];
    lista.innerHTML = items.map(function (x) {
      return '<li class="' + (x[0] ? 'ok' : 'falta') + '">' + (x[0] ? '✅ ' : '❌ ') + esc(x[1]) + '</li>';
    }).join('');
    var listo = items.every(function (x) { return x[0]; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="video-previa"], [data-action="video-crear"]'), function (b) {
      b.disabled = !listo || videoOcupado;
    });
    if (videoHecho && videoHecho.proyectoId === id) mostrarVideo();
  }

  function progresoVideo(fraccion, mensaje) {
    var caja = document.getElementById('videoProgreso');
    if (!caja) return;
    caja.hidden = fraccion === null;
    if (fraccion === null) return;
    caja.querySelector('progress').value = fraccion;
    document.getElementById('videoMensaje').textContent = mensaje;
  }

  function mostrarVideo() {
    var caja = document.getElementById('videoResultado');
    if (!caja || !videoHecho) return;
    var rep = document.getElementById('videoReproductor');
    if (rep.src !== videoHecho.url) rep.src = videoHecho.url;
    caja.hidden = false;
    document.querySelector('[data-action="video-srt"]').hidden = !videoHecho.subtitulos;
    document.getElementById('videoInfo').textContent = (videoHecho.completo ? 'Video completo' : 'Vista previa de 30 segundos') +
      ' · ' + formatoDuracion(videoHecho.duracion * PALABRAS_POR_MINUTO / 60) + ' min · ' +
      (videoHecho.blob.size / 1048576).toFixed(1) + ' MB';
  }

  function crearVideo(completo) {
    if (videoOcupado || !editor) return;
    var proyecto = editor.proyecto;
    var audio = audioVoz && audioVoz.proyectoId === proyecto.id ? audioVoz : null;
    if (!audio || !galeria) { actualizarRequisitosVideo(); return; }
    var tipoMusica = document.getElementById('videoMusica').value;
    var archivo = document.getElementById('videoArchivo').files[0] || null;

    videoOcupado = true;
    videoCancelado = false;
    document.querySelector('[data-action="video-cancelar"]').hidden = false;
    actualizarRequisitosVideo();
    progresoVideo(0, 'Preparando…');

    muestrasDe(audio).then(function (muestras) {
      return Video.crear({
        muestras: muestras,
        frecuencia: audio.frecuencia,
        segmentos: audio.segmentos,
        escenaIds: proyecto.escenas.map(function (e) { return e.id; }),
        tomas: galeria.tomas,
        formato: document.getElementById('videoFormato').value,
        musica: { tipo: tipoMusica, volumen: Number(document.getElementById('videoVolumen').value) / 100, archivo: archivo },
        subtitulos: document.getElementById('videoSubtitulos').checked,
        limite: completo ? 0 : 30
      }, function (f, msg) {
        if (editor && editor.proyecto === proyecto) progresoVideo(f, msg);
      }, function () { return videoCancelado; });
    }).then(function (r) {
      if (videoHecho) URL.revokeObjectURL(videoHecho.url);
      videoHecho = { proyectoId: proyecto.id, blob: r.blob, url: URL.createObjectURL(r.blob), subtitulos: r.subtitulos, duracion: r.duracion, completo: completo };
      // El video completo se guarda en el navegador para no perderlo al recargar y poder subirlo a YouTube.
      if (completo) {
        Almacen.poner('videos', { proyectoId: proyecto.id, blob: r.blob, subtitulos: r.subtitulos, duracion: r.duracion, fecha: new Date().toISOString() })
          .catch(function () { aviso('El video no cupo en el almacén del navegador: descárgalo para no perderlo.', 'error'); });
      }
      if (editor && editor.proyecto === proyecto) {
        mostrarVideo();
        pintarFuenteYT();
        aviso(completo ? 'Video creado. Revísalo y descárgalo.' : 'Vista previa lista');
      }
    }, function (err) {
      aviso(err.message, 'error');
    }).finally(function () {
      videoOcupado = false;
      progresoVideo(null);
      var cancelar = document.querySelector('[data-action="video-cancelar"]');
      if (cancelar) cancelar.hidden = true;
      actualizarRequisitosVideo();
    });
  }

  function descargarVideo() {
    if (!videoHecho) return;
    var base = nombreArchivo(editor ? editor.proyecto.titulo : 'video').replace(/\.txt$/, '');
    if (!videoHecho.completo) aviso('Ojo: estás descargando la vista previa de 30 segundos, no el video completo.');
    descargarBlob(videoHecho.blob, base + (videoHecho.completo ? '' : '-vista-previa') + '.mp4');
  }

  function descargarSRT() {
    if (!videoHecho || !videoHecho.subtitulos) return;
    var base = nombreArchivo(editor ? editor.proyecto.titulo : 'video').replace(/\.txt$/, '');
    descargarBlob(new Blob([Video.aSRT(videoHecho.subtitulos)], { type: 'text/plain;charset=utf-8' }), base + '.srt');
  }

  /* ---------------- Publicar en YouTube ---------------- */

  var ytOcupado = false;
  var videoGuardado = null;  // { proyectoId, blob, duracion } — último video completo guardado en el navegador

  function seccionYouTube() {
    return '' +
      '<div class="youtube-seccion">' +
        '<div class="scenes-head"><h2>📺 Publicar en YouTube</h2></div>' +
        '<div id="ytConexion" class="yt-conexion"></div>' +
        '<label>Video que se va a subir<select id="ytFuente"></select></label>' +
        '<label id="ytArchivoCaja" hidden>Archivo MP4 de tu computadora<input type="file" id="ytArchivo" accept="video/mp4,.mp4"></label>' +
        '<p class="hint" id="ytFuenteInfo"></p>' +
        '<div class="img-acciones">' +
          '<button type="button" class="btn" data-action="yt-datos-ia">✨ Crear título, descripción y etiquetas con IA</button>' +
        '</div>' +
        '<label>Título <span class="contador" id="ytTituloCuenta"></span><input type="text" id="ytTitulo" maxlength="' + YouTube.MAX_TITULO + '"></label>' +
        '<label>Descripción<textarea id="ytDescripcion" rows="8" placeholder="Los hashtags van al final de la descripción, por ejemplo: #terror #misterio"></textarea></label>' +
        '<label>Etiquetas (separadas por comas) <span class="contador" id="ytEtiquetasCuenta"></span><input type="text" id="ytEtiquetas" placeholder="historias de terror, relatos de miedo, misterio"></label>' +
        '<div class="img-controles">' +
          '<label>Visibilidad<select id="ytPrivacidad">' + opciones(YouTube.VISIBILIDADES, 'private') + '</select></label>' +
          '<label>Categoría<select id="ytCategoria">' + opciones(YouTube.CATEGORIAS, '24') + '</select></label>' +
          '<label class="check"><input type="checkbox" id="ytProgramar"> Programar la publicación</label>' +
          '<label id="ytFechaCaja" hidden>Fecha y hora (tu hora local)<input type="datetime-local" id="ytFecha"></label>' +
        '</div>' +
        '<div class="img-controles">' +
          '<label class="check"><input type="checkbox" id="ytSintetico" checked> Contiene contenido realista creado o alterado con IA (aviso que pide YouTube)</label>' +
          '<label class="check"><input type="checkbox" id="ytNinos"> Es un video hecho para niños</label>' +
        '</div>' +
        '<p class="hint" id="ytProgramarInfo" hidden>Al programar, el video se sube como privado y YouTube lo hace público solo en la fecha elegida, aunque tu computadora esté apagada.</p>' +
        '<div class="img-acciones">' +
          '<button type="button" class="btn btn-primary" data-action="yt-publicar">📤 Revisar y subir a YouTube</button>' +
          '<button type="button" class="btn btn-ghost" data-action="yt-cancelar" hidden>⏹ Cancelar subida</button>' +
        '</div>' +
        '<div id="ytProgreso" class="voz-progreso" hidden><progress max="1" value="0"></progress><p class="hint" id="ytMensaje"></p></div>' +
        '<div id="ytResultado" class="yt-resultado" hidden></div>' +
        '<h3 class="yt-subtitulo">Historial de este proyecto</h3>' +
        '<div id="ytHistorial"></div>' +
        '<p class="hint">El video va directo de tu navegador a YouTube. El permiso de Google dura 1 hora y solo vive en esta pestaña. ' +
          'Nada se sube sin que lo confirmes. La cuota gratuita de YouTube alcanza para unas pocas subidas al día. ' +
          'Mientras Google no revise tu app, YouTube puede dejar los videos en privado aunque elijas otra visibilidad. ' +
          'Los subtítulos .srt súbelos desde YouTube Studio → Subtítulos.</p>' +
      '</div>';
  }

  function prepararYouTube(p) {
    var b = YouTube.borrador(p.id) || {};
    document.getElementById('ytTitulo').value = b.titulo != null ? b.titulo : p.titulo.slice(0, YouTube.MAX_TITULO);
    document.getElementById('ytDescripcion').value = b.descripcion || '';
    document.getElementById('ytEtiquetas').value = b.etiquetas || '';
    if (YouTube.VISIBILIDADES[b.privacidad]) document.getElementById('ytPrivacidad').value = b.privacidad;
    if (YouTube.CATEGORIAS[b.categoria]) document.getElementById('ytCategoria').value = b.categoria;
    if (typeof b.sintetico === 'boolean') document.getElementById('ytSintetico').checked = b.sintetico;
    document.getElementById('ytNinos').checked = !!b.paraNinos;
    actualizarContadoresYT();
    pintarProgramarYT();
    pintarConexionYT();
    pintarFuenteYT();
    pintarHistorialYT();

    if (YouTube.clienteId()) {
      YouTube.preparar().then(pintarConexionYT, function (err) {
        var cont = document.getElementById('ytConexion');
        if (cont) cont.insertAdjacentHTML('beforeend', '<p class="hint yt-error">' + esc(err.message) + '</p>');
      });
    }

    Almacen.obtener('videos', p.id).then(function (g) {
      if (!g || !editor || editor.proyecto.id !== p.id) return;
      videoGuardado = { proyectoId: p.id, blob: g.blob, duracion: g.duracion, fecha: g.fecha };
      // Si en esta sesión aún no se creó ningún video, se muestra el guardado.
      if (!(videoHecho && videoHecho.proyectoId === p.id)) {
        if (videoHecho) URL.revokeObjectURL(videoHecho.url);
        videoHecho = { proyectoId: p.id, blob: g.blob, url: URL.createObjectURL(g.blob), subtitulos: g.subtitulos, duracion: g.duracion, completo: true };
        mostrarVideo();
      }
      pintarFuenteYT();
    }).catch(function () { /* sin video guardado */ });
  }

  function pintarConexionYT() {
    var cont = document.getElementById('ytConexion');
    if (!cont) return;
    var canal = YouTube.canal();
    if (!YouTube.clienteId()) {
      cont.innerHTML = '<p>Para conectar tu canal, primero pega el <strong>ID de cliente</strong> que creaste en Google Cloud ' +
        '(termina en <code>.apps.googleusercontent.com</code>). No es secreto. Nunca pegues aquí el "secreto del cliente".</p>' +
        '<div class="yt-fila"><input type="text" id="ytClienteId" placeholder="123456789-abc123.apps.googleusercontent.com" autocomplete="off">' +
        '<button type="button" class="btn btn-primary" data-action="yt-guardar-id">Guardar</button></div>';
    } else if (canal) {
      cont.innerHTML = '<p class="yt-conectado">✅ Conectado al canal <strong>' + esc(canal.nombre) + '</strong></p>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-action="yt-desconectar">Desconectar</button>';
    } else {
      cont.innerHTML = '<button type="button" class="btn btn-primary" data-action="yt-conectar"' + (YouTube.listo() ? '' : ' disabled') + '>🔑 Conectar mi cuenta de YouTube</button>' +
        (YouTube.listo() ? '' : '<p class="hint">Cargando el inicio de sesión de Google…</p>') +
        '<p class="hint">Google te mostrará un aviso de "app no verificada": es normal porque la app es tuya. Pulsa "Continuar".</p>';
    }
    pintarBotonPublicarYT();
  }

  // El video que se subiría: el creado aquí, el guardado o un archivo elegido.
  function videoParaSubir() {
    var sel = document.getElementById('ytFuente');
    if (!sel || !editor) return null;
    if (sel.value === 'archivo') {
      var f = document.getElementById('ytArchivo').files[0];
      return f ? { blob: f, nombre: f.name } : null;
    }
    var id = editor.proyecto.id;
    if (videoHecho && videoHecho.proyectoId === id && videoHecho.completo) return { blob: videoHecho.blob, duracion: videoHecho.duracion, nombre: 'video creado' };
    if (videoGuardado && videoGuardado.proyectoId === id) return { blob: videoGuardado.blob, duracion: videoGuardado.duracion, nombre: 'video guardado' };
    return null;
  }

  function pintarFuenteYT() {
    var sel = document.getElementById('ytFuente');
    if (!sel || !editor) return;
    var anterior = sel.value;
    var id = editor.proyecto.id;
    var propio = (videoHecho && videoHecho.proyectoId === id && videoHecho.completo) || (videoGuardado && videoGuardado.proyectoId === id);
    sel.innerHTML = (propio ? '<option value="propio">🎬 Video completo creado en Fábrica Oscura</option>' : '') +
      '<option value="archivo">📁 Elegir un MP4 de mi computadora</option>';
    sel.value = anterior === 'archivo' || !propio ? 'archivo' : 'propio';
    document.getElementById('ytArchivoCaja').hidden = sel.value !== 'archivo';
    var v = videoParaSubir();
    document.getElementById('ytFuenteInfo').textContent = v
      ? 'Listo para subir: ' + (v.blob.size / 1048576).toFixed(1) + ' MB' + (v.duracion ? ' · ' + formatoDuracion(v.duracion * PALABRAS_POR_MINUTO / 60) + ' min' : '')
      : propio ? 'Elige el archivo MP4.' : 'Aún no hay un video completo de este proyecto: créalo arriba en "🎬 Video MP4" o elige un MP4 de tu computadora.';
    pintarBotonPublicarYT();
  }

  function pintarProgramarYT() {
    var programar = document.getElementById('ytProgramar').checked;
    document.getElementById('ytFechaCaja').hidden = !programar;
    document.getElementById('ytProgramarInfo').hidden = !programar;
    document.getElementById('ytPrivacidad').disabled = programar || ytOcupado;
    if (programar && !document.getElementById('ytFecha').value) {
      // Por defecto: mañana a las 7 de la tarde.
      var f = new Date();
      f.setDate(f.getDate() + 1);
      f.setHours(19, 0, 0, 0);
      var dos = function (n) { return (n < 10 ? '0' : '') + n; };
      document.getElementById('ytFecha').value = f.getFullYear() + '-' + dos(f.getMonth() + 1) + '-' + dos(f.getDate()) + 'T19:00';
    }
  }

  function pintarBotonPublicarYT() {
    var boton = document.querySelector('[data-action="yt-publicar"]');
    if (boton) boton.disabled = ytOcupado || !YouTube.clienteId() || !videoParaSubir();
  }

  function etiquetasYT() {
    return document.getElementById('ytEtiquetas').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function actualizarContadoresYT() {
    var titulo = document.getElementById('ytTitulo').value;
    document.getElementById('ytTituloCuenta').textContent = titulo.length + '/' + YouTube.MAX_TITULO;
    var largo = YouTube.largoEtiquetas(etiquetasYT());
    var cuenta = document.getElementById('ytEtiquetasCuenta');
    cuenta.textContent = largo + '/' + YouTube.MAX_ETIQUETAS + (largo > YouTube.MAX_ETIQUETAS ? ' (las que sobren no se enviarán)' : '');
    cuenta.classList.toggle('excedido', largo > YouTube.MAX_ETIQUETAS);
  }

  function leerFormularioYT() {
    var programar = document.getElementById('ytProgramar').checked;
    return {
      titulo: document.getElementById('ytTitulo').value,
      descripcion: document.getElementById('ytDescripcion').value,
      etiquetas: etiquetasYT(),
      privacidad: programar ? 'public' : document.getElementById('ytPrivacidad').value,
      categoria: document.getElementById('ytCategoria').value,
      publicarEn: programar ? document.getElementById('ytFecha').value : '',
      sintetico: document.getElementById('ytSintetico').checked,
      paraNinos: document.getElementById('ytNinos').checked
    };
  }

  function guardarBorradorYT() {
    if (!editor) return;
    YouTube.guardarBorrador(editor.proyecto.id, {
      titulo: document.getElementById('ytTitulo').value,
      descripcion: document.getElementById('ytDescripcion').value,
      etiquetas: document.getElementById('ytEtiquetas').value,
      privacidad: document.getElementById('ytPrivacidad').value,
      categoria: document.getElementById('ytCategoria').value,
      sintetico: document.getElementById('ytSintetico').checked,
      paraNinos: document.getElementById('ytNinos').checked
    });
  }

  function cambioYT(t) {
    if (t.id === 'ytClienteId') return;
    if (t.id === 'ytFuente' || t.id === 'ytArchivo') { pintarFuenteYT(); return; }
    if (t.id === 'ytProgramar') pintarProgramarYT();
    if (t.id === 'ytTitulo' || t.id === 'ytEtiquetas') actualizarContadoresYT();
    guardarBorradorYT();
  }

  function guardarClienteIdYT() {
    try {
      YouTube.guardarClienteId(document.getElementById('ytClienteId').value);
    } catch (err) {
      aviso(err.message, 'error');
      return;
    }
    aviso('ID de cliente guardado');
    pintarConexionYT();
    YouTube.preparar().then(pintarConexionYT, function (err) { aviso(err.message, 'error'); });
  }

  // Se llama directamente desde el clic para que el navegador no bloquee la ventana de Google.
  function conectarYT() {
    var boton = document.querySelector('[data-action="yt-conectar"]');
    if (boton) boton.disabled = true;
    return YouTube.conectar().then(function (canal) {
      aviso('Conectado al canal ' + canal.nombre);
      return canal;
    }, function (err) {
      aviso(err.message, 'error');
      throw err;
    }).finally(pintarConexionYT);
  }

  function datosConIA(boton) {
    if (!editor || ytOcupado) return;
    var proyecto = editor.proyecto;
    var hayTexto = document.getElementById('ytTitulo').value.trim() !== proyecto.titulo.trim().slice(0, YouTube.MAX_TITULO) ||
      document.getElementById('ytDescripcion').value.trim();
    var seguir = hayTexto
      ? confirmar('¿Reemplazar los datos?', 'La IA escribirá un nuevo título, descripción y etiquetas en lugar de los que tienes ahora.', 'Reemplazar')
      : Promise.resolve(true);
    seguir.then(function (ok) {
      if (!ok) return;
      var v = videoParaSubir();
      var texto = boton.textContent;
      boton.disabled = true;
      boton.textContent = '✨ Escribiendo…';
      return YouTube.generarDatos(proyecto, v && v.duracion).then(function (d) {
        if (!editor || editor.proyecto !== proyecto) return;
        document.getElementById('ytTitulo').value = d.titulo;
        document.getElementById('ytDescripcion').value = d.descripcion;
        document.getElementById('ytEtiquetas').value = d.etiquetas.join(', ');
        actualizarContadoresYT();
        guardarBorradorYT();
        aviso('Datos listos. Revísalos y edítalos antes de subir.');
      }, function (err) {
        aviso(err.message, 'error');
      }).finally(function () {
        boton.disabled = false;
        boton.textContent = texto;
      });
    });
  }

  function progresoYT(fraccion, mensaje) {
    var caja = document.getElementById('ytProgreso');
    if (!caja) return;
    caja.hidden = fraccion === null;
    if (fraccion === null) return;
    caja.querySelector('progress').value = fraccion;
    document.getElementById('ytMensaje').textContent = mensaje;
  }

  function marcarYTOcupado(ocupado) {
    ytOcupado = ocupado;
    Array.prototype.forEach.call(document.querySelectorAll('.youtube-seccion input, .youtube-seccion textarea, .youtube-seccion select, [data-action="yt-datos-ia"], [data-action="yt-desconectar"]'), function (el) {
      el.disabled = ocupado;
    });
    var cancelar = document.querySelector('[data-action="yt-cancelar"]');
    if (cancelar) cancelar.hidden = !ocupado;
    if (!ocupado && document.getElementById('ytProgramar')) pintarProgramarYT();
    pintarBotonPublicarYT();
  }

  function publicarYT() {
    if (!editor || ytOcupado) return;
    // Si el permiso venció, se pide de nuevo aquí mismo (dentro del clic).
    if (!YouTube.conectado()) {
      if (!YouTube.listo()) { aviso('Primero conecta tu cuenta de YouTube.', 'error'); return; }
      conectarYT().then(function () { publicarYT(); }, function () { /* ya avisado */ });
      return;
    }
    var proyecto = editor.proyecto;
    var video = videoParaSubir();
    if (!video) { aviso('Elige el video que quieres subir.', 'error'); return; }
    if (video.blob.type && !/mp4/.test(video.blob.type)) { aviso('El archivo debe ser un video MP4.', 'error'); return; }
    var datos = leerFormularioYT();
    if (!datos.titulo.trim()) { aviso('Escribe un título para el video.', 'error'); return; }
    if (YouTube.largoEtiquetas(datos.etiquetas) > YouTube.MAX_ETIQUETAS) {
      datos.etiquetas = YouTube.normalizarEtiquetas(datos.etiquetas);
    }

    var canal = YouTube.canal();
    var cuando = datos.publicarEn
      ? 'Se subirá como privado y YouTube lo hará PÚBLICO el ' + new Date(datos.publicarEn).toLocaleString('es') + '.'
      : 'Visibilidad: ' + YouTube.VISIBILIDADES[datos.privacidad] + '.';
    var hoy = YouTube.subidasDeHoy();
    var texto = 'Canal: ' + canal.nombre + '\n' +
      'Título: ' + datos.titulo.trim() + '\n' +
      cuando + '\n' +
      'Tamaño: ' + (video.blob.size / 1048576).toFixed(1) + ' MB' +
      (hoy ? '\nHoy ya subiste ' + hoy + ' video' + (hoy === 1 ? '' : 's') + ' (la cuota gratuita es limitada).' : '') +
      '\n\n¿Confirmas que quieres subir este video a YouTube?';

    confirmar('¿Subir a YouTube?', texto, 'Sí, subir el video').then(function (ok) {
      if (!ok || !editor || editor.proyecto !== proyecto) return;
      marcarYTOcupado(true);
      document.getElementById('ytResultado').hidden = true;
      progresoYT(0, 'Preparando…');
      return YouTube.subir(video.blob, datos, function (f, msg) {
        if (editor && editor.proyecto === proyecto) progresoYT(f, msg);
      }).then(function (r) {
        var entrada = {
          fecha: new Date().toISOString(),
          proyectoId: proyecto.id,
          proyecto: proyecto.titulo,
          videoId: r.id,
          titulo: r.titulo,
          visibilidad: datos.publicarEn ? 'programado' : datos.privacidad,
          publicarEn: r.publicarEn || '',
          canal: canal.nombre
        };
        YouTube.registrar(entrada);
        if (editor && editor.proyecto === proyecto) {
          proyecto.estado = 'publicado';
          var sel = document.querySelector('[data-field="estado"]');
          if (sel) sel.value = 'publicado';
          cambioEnEditor();
          pintarResultadoYT(entrada, r.privacidad);
          pintarHistorialYT();
        } else {
          var guardado = Storage.obtener(proyecto.id);
          if (guardado) { guardado.estado = 'publicado'; Storage.guardar(guardado); }
        }
        aviso('¡Video subido a YouTube!');
      }, function (err) {
        aviso(err.message, 'error');
        var res = document.getElementById('ytResultado');
        if (res) {
          res.hidden = false;
          res.innerHTML = '<p class="yt-error">❌ ' + esc(err.message) + '</p>';
        }
      }).finally(function () {
        progresoYT(null);
        marcarYTOcupado(false);
      });
    });
  }

  function textoVisibilidad(e) {
    if (e.visibilidad === 'programado') return 'Programado para el ' + new Date(e.publicarEn).toLocaleString('es');
    return YouTube.VISIBILIDADES[e.visibilidad] || e.visibilidad;
  }

  function pintarResultadoYT(e, privacidadReal) {
    var res = document.getElementById('ytResultado');
    if (!res) return;
    var nota = e.visibilidad !== 'private' && privacidadReal === 'private' && e.visibilidad !== 'programado'
      ? '<p class="hint">YouTube lo dejó en privado. Si tu app de Google aún no está verificada, es lo esperado: revísalo en YouTube Studio.</p>'
      : '';
    res.hidden = false;
    res.innerHTML = '<p>✅ <strong>Video subido.</strong> ' + esc(textoVisibilidad(e)) + '.</p>' +
      '<p><a href="' + esc(YouTube.enlace(e.videoId)) + '" target="_blank" rel="noopener">' + esc(YouTube.enlace(e.videoId)) + '</a></p>' +
      '<div class="img-acciones">' +
        '<a class="btn btn-sm" href="' + esc(YouTube.enlaceStudio(e.videoId)) + '" target="_blank" rel="noopener">Abrir en YouTube Studio</a>' +
        '<button type="button" class="btn btn-sm" data-action="yt-estado" data-id="' + esc(e.videoId) + '">Comprobar estado</button>' +
      '</div>' + nota +
      '<p class="hint">YouTube tarda unos minutos en procesar el video antes de que se vea en alta calidad.</p>';
  }

  function filasHistorial(lista, conProyecto) {
    if (!lista.length) return '<p class="hint">Todavía no hay publicaciones.</p>';
    return '<ul class="yt-historial">' + lista.map(function (e) {
      return '<li>' +
        '<div><strong>' + esc(e.titulo) + '</strong>' +
          '<span class="muted"> · ' + esc(formatoFecha(e.fecha)) + ' · ' + esc(textoVisibilidad(e)) + ' · ' + esc(e.canal || '') + '</span>' +
          (conProyecto ? '<br><a class="muted" href="#editor/' + encodeURIComponent(e.proyectoId) + '">Proyecto: ' + esc(e.proyecto || '') + '</a>' : '') +
        '</div>' +
        '<div class="yt-historial-acciones">' +
          '<a class="btn btn-sm" href="' + esc(YouTube.enlace(e.videoId)) + '" target="_blank" rel="noopener">Ver en YouTube</a>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-action="yt-estado" data-id="' + esc(e.videoId) + '">Estado</button>' +
        '</div>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function pintarHistorialYT() {
    var cont = document.getElementById('ytHistorial');
    if (!cont || !editor) return;
    var id = editor.proyecto.id;
    cont.innerHTML = filasHistorial(YouTube.historial().filter(function (e) { return e.proyectoId === id; }), false);
  }

  function estadoYT(boton) {
    var id = boton.getAttribute('data-id');
    if (!YouTube.conectado()) { aviso('Conecta tu cuenta de YouTube para comprobar el estado.', 'error'); return; }
    boton.disabled = true;
    YouTube.estado(id).then(function (t) { aviso(t); }, function (err) { aviso(err.message, 'error'); })
      .finally(function () { boton.disabled = false; });
  }

  function vistaPublicaciones() {
    var lista = YouTube.historial();
    var id = YouTube.clienteId();
    app.innerHTML = '' +
      '<div class="page-head"><h1>Publicaciones en YouTube</h1>' +
        '<p class="muted">Historial de los videos que subiste desde Fábrica Oscura en este navegador.</p></div>' +
      '<div class="panel yt-config">' +
        '<h2>Conexión con Google</h2>' +
        (id
          ? '<p>ID de cliente guardado: <code>' + esc(id.replace(/^(\d{4})\d*-(.{4}).*$/, '$1…-$2…')) + '</code></p>' +
            '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="yt-olvidar-id">Quitar ID de cliente</button>'
          : '<p class="muted">Aún no configuras YouTube. Abre un proyecto y busca "📺 Publicar en YouTube".</p>') +
      '</div>' +
      '<div class="section">' + filasHistorial(lista, true) + '</div>';
  }

  /* ---------------- Navegación ---------------- */

  function ruta() {
    var h = location.hash.replace(/^#\/?/, '');
    var partes = h.split('/');
    return { vista: partes[0] || 'inicio', id: partes[1] ? decodeURIComponent(partes[1]) : '' };
  }

  function cerrarMenu() {
    nav.classList.remove('abierto');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Abrir menú');
  }

  function render() {
    guardarPendiente();
    var r = ruta();
    cerrarMenu();

    if (r.vista !== 'editor') editor = null;

    Array.prototype.forEach.call(nav.querySelectorAll('[data-nav]'), function (a) {
      var activo = a.getAttribute('data-nav') === r.vista || (r.vista === 'editor' && a.getAttribute('data-nav') === 'proyectos');
      a.classList.toggle('active', activo);
      if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (r.vista === 'proyectos') { vistaProyectos(); document.title = 'Proyectos — Fábrica Oscura'; }
    else if (r.vista === 'publicaciones') { vistaPublicaciones(); document.title = 'Publicaciones — Fábrica Oscura'; }
    else if (r.vista === 'ideas') { vistaIdeas(); document.title = 'Generador de ideas — Fábrica Oscura'; }
    else if (r.vista === 'editor') { vistaEditor(r.id); document.title = (editor ? editor.proyecto.titulo : 'Editor') + ' — Fábrica Oscura'; }
    else { vistaInicio(); document.title = 'Fábrica Oscura — Videos de terror y misterio'; }

    window.scrollTo(0, 0);
  }

  /* ---------------- Eventos globales ---------------- */

  document.addEventListener('click', function (e) {
    var boton = e.target.closest('[data-action]');
    if (!boton || boton.disabled) return;
    var accion = boton.getAttribute('data-action');
    var id = boton.getAttribute('data-id');

    switch (accion) {
      case 'nuevo-proyecto':
        crearProyecto({ titulo: 'Nuevo video de terror' });
        break;
      case 'eliminar': eliminarProyecto(id); break;
      case 'exportar': exportarGuion(id); break;
      case 'copiar': copiarGuion(id); break;
      case 'duplicar': duplicarProyecto(id); break;
      case 'guardar': guardarEditor(true); break;
      case 'generar-idea':
        ideaActual = Ideas.generar(subgeneroIdeas);
        pintarIdea();
        break;
      case 'generar-idea-ia': generarIdeaIA(boton); break;
      case 'narracion-ia': narracionIA(boton); break;
      case 'guion-completo': guionCompletoIA(boton); break;
      case 'voz-probar': probarVoz(boton); break;
      case 'voz-generar': generarAudio(); break;
      case 'voz-cancelar':
        vozCancelada = true;
        mostrarProgreso(0, 'Cancelando al terminar la parte actual…');
        break;
      case 'voz-descargar': descargarMp3(boton); break;
      case 'img-plan': if (!imgOcupada) crearPlanVisual(); break;
      case 'img-generar': generarImagenes(); break;
      case 'img-detener':
        imgDetener = true;
        boton.disabled = true;
        progresoImg(0, 'Deteniendo al terminar la imagen actual…');
        break;
      case 'img-regenerar': regenerarImagen(boton); break;
      case 'img-descargar': descargarImagen(boton); break;
      case 'img-descargar-todas': descargarTodas(); break;
      case 'video-previa': crearVideo(false); break;
      case 'video-crear': crearVideo(true); break;
      case 'video-cancelar':
        videoCancelado = true;
        progresoVideo(0, 'Cancelando…');
        break;
      case 'video-descargar': descargarVideo(); break;
      case 'video-srt': descargarSRT(); break;
      case 'yt-guardar-id': guardarClienteIdYT(); break;
      case 'yt-conectar': conectarYT().catch(function () { /* ya avisado */ }); break;
      case 'yt-desconectar':
        YouTube.desconectar();
        aviso('Cuenta de YouTube desconectada');
        pintarConexionYT();
        break;
      case 'yt-datos-ia': datosConIA(boton); break;
      case 'yt-publicar': publicarYT(); break;
      case 'yt-cancelar':
        YouTube.cancelar();
        progresoYT(0, 'Cancelando…');
        break;
      case 'yt-estado': estadoYT(boton); break;
      case 'yt-olvidar-id':
        confirmar('¿Quitar el ID de cliente?', 'Se desconectará tu cuenta de YouTube en esta página. El historial no se borra.', 'Quitar').then(function (ok) {
          if (!ok) return;
          YouTube.olvidarClienteId();
          vistaPublicaciones();
        });
        break;
      case 'copiar-idea':
        copiarTexto(Ideas.comoTexto(ideaActual)).then(function (ok) {
          aviso(ok ? 'Idea copiada al portapapeles' : 'No se pudo copiar la idea', ok ? '' : 'error');
        });
        break;
      case 'usar-idea':
        crearProyecto({
          titulo: ideaActual.titulo,
          subgenero: ideaActual.subgenero,
          estado: 'idea',
          descripcion: ideaActual.premisa + '\n\nGiro: ' + ideaActual.giro + '\nTono: ' + ideaActual.tono + '\nDuración sugerida: ' + ideaActual.duracion,
          escenas: Ideas.escenasDesdeIdea(ideaActual)
        });
        break;
      case 'agregar-escena':
      case 'subir-escena':
      case 'bajar-escena':
      case 'duplicar-escena':
      case 'eliminar-escena':
        if (editor) accionEscena(accion, boton);
        break;
    }
  });

  app.addEventListener('input', function (e) {
    var t = e.target;

    if (t.id === 'buscar') { filtros.texto = t.value; pintarListaProyectos(); return; }
    if (t.id === 'filtroEstado') { filtros.estado = t.value; pintarListaProyectos(); return; }
    if (t.id === 'subgeneroIdeas') {
      subgeneroIdeas = t.value;
      ideaActual = Ideas.generar(subgeneroIdeas);
      pintarIdea();
      return;
    }
    if (!editor) return;
    if (t.id === 'vozSelect' || t.id === 'vozEstilo') { guardarEleccionVoz(); return; }
    if (t.id === 'duracionObjetivo') { duracionObjetivo = Number(t.value) || 10; return; }
    if (t.id === 'videoVolumen') { document.getElementById('videoVolumenValor').textContent = t.value + '%'; return; }
    if (t.id === 'videoMusica') { document.getElementById('videoArchivoCaja').hidden = t.value !== 'archivo'; return; }
    if (t.id === 'videoFormato' || t.id === 'videoSubtitulos' || t.id === 'videoArchivo') return;
    if (/^yt[A-Z]/.test(t.id)) { cambioYT(t); return; }

    var campo = t.getAttribute('data-field');
    if (campo) {
      editor.proyecto[campo] = t.value;
      if (campo === 'titulo') document.title = (t.value || 'Editor') + ' — Fábrica Oscura';
      cambioEnEditor();
      return;
    }

    var campoEscena = t.getAttribute('data-sfield');
    if (campoEscena) {
      var i = indiceEscena(t);
      if (i < 0) return;
      var escena = editor.proyecto.escenas[i];
      escena[campoEscena] = t.value;
      if (campoEscena === 'narracion') {
        var palabras = contarPalabras(t.value);
        var etiqueta = t.closest('.scene').querySelector('[data-scene-stats]');
        etiqueta.textContent = palabras + ' palabra' + (palabras === 1 ? '' : 's') + ' · ' + formatoDuracion(palabras) + ' min';
        pintarEstadisticasEditor();
      }
      cambioEnEditor();
    }
  });

  // Si el título queda vacío al salir del campo, se restaura uno por defecto.
  app.addEventListener('focusout', function (e) {
    if (editor && e.target.getAttribute('data-field') === 'titulo' && !e.target.value.trim()) {
      e.target.value = editor.proyecto.titulo = 'Proyecto sin título';
      cambioEnEditor();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (editor && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      guardarEditor(true);
    }
  });

  menuToggle.addEventListener('click', function () {
    var abierto = nav.classList.toggle('abierto');
    menuToggle.setAttribute('aria-expanded', String(abierto));
    menuToggle.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', guardarPendiente);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') guardarPendiente();
  });

  render();
})();
