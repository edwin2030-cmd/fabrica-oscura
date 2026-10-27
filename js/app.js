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
    setTimeout(function () {
      el.classList.add('saliendo');
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
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
          '<div class="feature"><div class="feature-icon">💾</div><h3>Guardado automático</h3><p>Tus proyectos se guardan solos en este navegador mientras escribes.</p></div>' +
          '<div class="feature"><div class="feature-icon">📱</div><h3>En cualquier pantalla</h3><p>Funciona en computadoras, tabletas y teléfonos.</p></div>' +
        '</div>' +
      '</section>' +

      '<section class="section roadmap">' +
        '<strong>Próximas etapas de la fábrica</strong> <span class="badge-soon">aún no disponibles</span>' +
        '<ul><li>Guion completo con IA en un solo clic</li><li>Imágenes y montaje del video</li></ul>' +
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
            '<p class="hint">La voz lee la narración de todas las escenas, en orden. El audio no se guarda: descárgalo antes de cerrar la página.</p>' +
          '</div>' +
        '</aside>' +
        '<section>' +
          '<div class="scenes-head"><h2>Escenas</h2>' +
            '<button type="button" class="btn btn-sm" data-action="agregar-escena">+ Añadir escena</button></div>' +
          '<div class="scene-list" id="listaEscenas"></div>' +
          '<button type="button" class="btn add-scene-big" data-action="agregar-escena">+ Añadir escena al final</button>' +
        '</section>' +
      '</div>';

    pintarEscenas();
    prepararPanelVoz();
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
      return IA.escribirNarracion(proyecto, i).then(function (texto) {
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
  var audioVoz = null;     // { proyectoId, muestras, frecuencia, url, mp3 }
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

    var grupos = [];
    paises.forEach(function (pais) {
      [['male', 'masculinas'], ['female', 'femeninas']].forEach(function (g) {
        grupos.push([pais + ' — voces ' + g[1], latinas.filter(function (v) { return paisVoz(v) === pais && v.genero === g[0]; })]);
      });
    });
    grupos.push(['Voces básicas masculinas', lista.filter(function (v) { return !v.latina && v.genero === 'male'; })]);
    grupos.push(['Voces básicas femeninas', lista.filter(function (v) { return !v.latina && v.genero === 'female'; })]);

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
    // Si ya se generó el audio de este proyecto en esta visita, se vuelve a mostrar.
    if (audioVoz && editor && audioVoz.proyectoId === editor.proyecto.id) mostrarAudio(audioVoz.url);
  }

  function vozElegida() {
    var id = document.getElementById('vozSelect').value;
    var lista = voces || Voz.VOCES_RESPALDO;
    return lista.find(function (v) { return v.id === id; }) || Voz.VOCES_RESPALDO[0];
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
      audioVoz = { proyectoId: proyecto.id, muestras: a.muestras, frecuencia: a.frecuencia, url: URL.createObjectURL(Voz.aWav(a.muestras, a.frecuencia)), mp3: null };
      if (editor && editor.proyecto === proyecto) {
        mostrarAudio(audioVoz.url);
        aviso('Audio listo: ' + formatoDuracion(a.duracion * PALABRAS_POR_MINUTO / 60) + ' min');
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
    Voz.aMp3(actual.muestras, actual.frecuencia, function (f) {
      mostrarProgreso(f, 'Convirtiendo a MP3… ' + Math.round(f * 100) + '%');
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
      case 'voz-probar': probarVoz(boton); break;
      case 'voz-generar': generarAudio(); break;
      case 'voz-cancelar':
        vozCancelada = true;
        mostrarProgreso(0, 'Cancelando al terminar la parte actual…');
        break;
      case 'voz-descargar': descargarMp3(boton); break;
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
