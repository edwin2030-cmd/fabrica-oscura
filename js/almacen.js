/* ==========================================================
   Almacén del navegador (IndexedDB) para archivos grandes:
   imágenes y audio de cada proyecto. localStorage no sirve
   para esto porque solo admite unos pocos megas.
   ========================================================== */

var Almacen = (function () {
  'use strict';

  var NOMBRE = 'fabricaOscura';
  var VERSION = 2;                       // 1: imágenes · 2: + audio
  var TABLAS = ['imagenes', 'audios'];

  var promesaBD = null;
  function bd() {
    if (!promesaBD) {
      promesaBD = new Promise(function (resolver, rechazar) {
        if (!window.indexedDB) { rechazar(new Error('Este navegador no permite guardar archivos grandes.')); return; }
        var pet = indexedDB.open(NOMBRE, VERSION);
        pet.onupgradeneeded = function () {
          TABLAS.forEach(function (t) {
            if (!pet.result.objectStoreNames.contains(t)) pet.result.createObjectStore(t, { keyPath: 'proyectoId' });
          });
        };
        pet.onsuccess = function () { resolver(pet.result); };
        pet.onerror = function () { promesaBD = null; rechazar(new Error('No se pudo abrir el almacén del navegador.')); };
      });
    }
    return promesaBD;
  }

  function operar(tabla, modo, accion) {
    return bd().then(function (db) {
      return new Promise(function (resolver, rechazar) {
        var tx = db.transaction(tabla, modo);
        var pet = accion(tx.objectStore(tabla));
        tx.oncomplete = function () { resolver(pet && pet.result); };
        tx.onerror = tx.onabort = function () {
          var e = tx.error;
          rechazar(new Error(e && e.name === 'QuotaExceededError'
            ? 'El navegador se quedó sin espacio. Descarga y borra los archivos de otros proyectos.'
            : 'No se pudieron guardar los archivos en el navegador.'));
        };
      });
    });
  }

  return {
    obtener: function (tabla, proyectoId) {
      return operar(tabla, 'readonly', function (s) { return s.get(proyectoId); }).then(function (r) { return r || null; });
    },
    poner: function (tabla, dato) {
      return operar(tabla, 'readwrite', function (s) { return s.put(dato); });
    },
    borrar: function (tabla, proyectoId) {
      return operar(tabla, 'readwrite', function (s) { return s.delete(proyectoId); });
    }
  };
})();
