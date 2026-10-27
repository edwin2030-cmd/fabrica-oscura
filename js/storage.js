/* ==========================================================
   Almacenamiento de proyectos en localStorage
   Todo se guarda únicamente en este navegador.
   ========================================================== */

var Storage = (function () {
  'use strict';

  var CLAVE = 'fabricaOscura.proyectos.v1';

  function generarId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function ahora() {
    return new Date().toISOString();
  }

  function texto(valor) {
    return typeof valor === 'string' ? valor : '';
  }

  function nuevaEscena(datos) {
    datos = datos || {};
    return {
      id: generarId(),
      titulo: texto(datos.titulo),
      narracion: texto(datos.narracion),
      visual: texto(datos.visual),
      sonido: texto(datos.sonido),
      notas: texto(datos.notas)
    };
  }

  function nuevoProyecto(datos) {
    datos = datos || {};
    var fecha = ahora();
    var escenas = Array.isArray(datos.escenas) && datos.escenas.length
      ? datos.escenas.map(nuevaEscena)
      : [nuevaEscena({ titulo: 'Gancho inicial' })];
    return {
      id: generarId(),
      titulo: texto(datos.titulo) || 'Proyecto sin título',
      subgenero: texto(datos.subgenero) || 'paranormal',
      estado: texto(datos.estado) || 'idea',
      descripcion: texto(datos.descripcion),
      escenas: escenas,
      creado: fecha,
      actualizado: fecha
    };
  }

  // Repara datos incompletos o antiguos para que la app nunca falle al leerlos.
  function normalizar(p) {
    if (!p || typeof p !== 'object' || !p.id) return null;
    return {
      id: String(p.id),
      titulo: texto(p.titulo) || 'Proyecto sin título',
      subgenero: texto(p.subgenero) || 'paranormal',
      estado: texto(p.estado) || 'idea',
      descripcion: texto(p.descripcion),
      escenas: Array.isArray(p.escenas)
        ? p.escenas.filter(Boolean).map(function (e) {
            return {
              id: e.id ? String(e.id) : generarId(),
              titulo: texto(e.titulo),
              narracion: texto(e.narracion),
              visual: texto(e.visual),
              sonido: texto(e.sonido),
              notas: texto(e.notas)
            };
          })
        : [],
      creado: texto(p.creado) || ahora(),
      actualizado: texto(p.actualizado) || ahora()
    };
  }

  function leerTodos() {
    try {
      var datos = JSON.parse(localStorage.getItem(CLAVE) || '[]');
      return Array.isArray(datos) ? datos.map(normalizar).filter(Boolean) : [];
    } catch (e) {
      console.error('No se pudieron leer los proyectos:', e);
      return [];
    }
  }

  function escribirTodos(lista) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(lista));
      return true;
    } catch (e) {
      console.error('No se pudieron guardar los proyectos:', e);
      return false;
    }
  }

  function listar() {
    return leerTodos().sort(function (a, b) {
      return b.actualizado.localeCompare(a.actualizado);
    });
  }

  function obtener(id) {
    return leerTodos().find(function (p) { return p.id === id; }) || null;
  }

  // Inserta o actualiza. Devuelve true si se guardó correctamente.
  function guardar(proyecto) {
    var lista = leerTodos();
    proyecto.actualizado = ahora();
    var copia = JSON.parse(JSON.stringify(proyecto));
    var i = lista.findIndex(function (p) { return p.id === proyecto.id; });
    if (i >= 0) lista[i] = copia; else lista.push(copia);
    return escribirTodos(lista);
  }

  function eliminar(id) {
    var lista = leerTodos();
    var filtrada = lista.filter(function (p) { return p.id !== id; });
    return filtrada.length !== lista.length && escribirTodos(filtrada);
  }

  function duplicar(id) {
    var original = obtener(id);
    if (!original) return null;
    var copia = nuevoProyecto({
      titulo: original.titulo + ' (copia)',
      subgenero: original.subgenero,
      estado: original.estado,
      descripcion: original.descripcion,
      escenas: original.escenas
    });
    if (!original.escenas.length) copia.escenas = [];
    return guardar(copia) ? copia : null;
  }

  return {
    listar: listar,
    obtener: obtener,
    guardar: guardar,
    eliminar: eliminar,
    duplicar: duplicar,
    nuevoProyecto: nuevoProyecto,
    nuevaEscena: nuevaEscena
  };
})();
