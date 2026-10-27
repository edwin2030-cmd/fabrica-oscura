/* ==========================================================
   Generador de ideas de terror y misterio
   NO usa inteligencia artificial: combina al azar elementos
   escritos a mano para inspirar nuevas historias.
   ========================================================== */

var Ideas = (function () {
  'use strict';

  var SUBGENEROS = {
    paranormal: 'Paranormal',
    psicologico: 'Terror psicológico',
    leyenda: 'Leyenda urbana',
    misterio: 'Misterio sin resolver',
    folclore: 'Folclore latinoamericano',
    grabaciones: 'Grabaciones encontradas'
  };

  var PROTAGONISTAS = [
    'una enfermera del turno de noche',
    'un estudiante de arquitectura',
    'una madre que acaba de mudarse con su hija',
    'un guardia de seguridad a punto de jubilarse',
    'una creadora de videos de exploración urbana',
    'un camionero que cubre rutas nocturnas',
    'una restauradora de muebles antiguos',
    'un técnico de telefonía rural',
    'una periodista de un diario local',
    'un sacerdote recién llegado al pueblo',
    'una niña de diez años que no puede dormir',
    'un taxista del último turno'
  ];

  var TONOS = [
    'Atmósfera lenta y opresiva, con silencios largos',
    'Narración íntima en primera persona, como una confesión',
    'Estilo documental, con fechas, nombres y "pruebas"',
    'Tensión creciente con sustos espaciados',
    'Melancólico e inquietante, más tristeza que sangre',
    'Ritmo rápido, con cortes bruscos y finales de escena abiertos'
  ];

  var GANCHOS = [
    '{P} juró que lo que ocurrió esa noche fue real. Nadie le creyó… hasta ahora.',
    'Esta historia me la contó {p}. Me pidió que no la publicara. No le hice caso.',
    'Si escuchas tres golpes en tu puerta después de las tres de la mañana, no abras. {P} lo hizo.',
    'Nadie sabe exactamente qué pasó. Solo quedan unas notas escritas por {p}.',
    'Antes de empezar, apaga la luz. {P} también pensó que era solo un rumor.',
    '¿Alguna vez has sentido que alguien te mira mientras duermes? {P} lo sintió durante cuarenta noches seguidas.',
    'Lo que vas a escuchar está basado en el relato de {p}. Algunos detalles todavía no tienen explicación.'
  ];

  var DATOS = {
    paranormal: {
      titulos: ['La habitación que nadie alquila', 'Voces en el piso de arriba', 'El huésped del espejo', 'Lo que respira en la pared', 'La casa que recuerda', 'No apagues la radio'],
      lugares: ['una casa colonial heredada', 'un hotel de carretera casi vacío', 'un hospital psiquiátrico clausurado', 'un edificio de departamentos de los años cincuenta', 'una iglesia abandonada en las afueras', 'un orfanato convertido en museo'],
      premisas: [
        '{P} empieza a escuchar pasos cada noche a la misma hora en {l}, aunque no vive nadie más allí.',
        'En {l}, {p} descubre una habitación tapiada que no aparece en ningún plano.',
        '{P} encuentra en {l} fotografías antiguas en las que siempre aparece la misma figura al fondo.',
        'Después de mudarse a {l}, {p} nota que los objetos aparecen colocados como si alguien preparara una visita.',
        '{P} acepta pasar una noche en {l} por dinero, sin saber por qué nadie ha durado más de dos horas.'
      ],
      giros: [
        'La presencia no quiere hacerle daño: intenta advertirle de alguien vivo.',
        'Los pasos son los suyos, grabados semanas antes de llegar.',
        'La figura de las fotos es el propio protagonista, décadas más viejo.',
        'Quien vivía allí nunca se fue: el protagonista es el intruso en su tiempo.',
        'La casa repite cada noche el último día de sus antiguos dueños.'
      ]
    },
    psicologico: {
      titulos: ['El otro yo', 'Nadie más lo ve', 'La cuenta regresiva', 'Mi vecino no tiene cara', 'Duermo con los ojos abiertos', 'Las instrucciones'],
      lugares: ['un departamento pequeño en el centro de la ciudad', 'una cabaña aislada en la montaña', 'una oficina que funciona de noche', 'un pueblo donde todos se conocen', 'una clínica del sueño', 'una casa idéntica a la de su infancia'],
      premisas: [
        '{P} empieza a recibir notas escritas con su propia letra que no recuerda haber escrito, siempre en {l}.',
        'Durante una estancia en {l}, {p} se da cuenta de que su familia cambia pequeños detalles de sus recuerdos.',
        '{P} encuentra en {l} un diario que describe con exactitud lo que hará al día siguiente.',
        'Tras un accidente, {p} vuelve a {l} y todos insisten en que nunca se fue.',
        '{P} empieza a ver en {l} a una persona que nadie más puede ver, y cada día está un paso más cerca.'
      ],
      giros: [
        'El protagonista lleva años muerto y nadie se atreve a decírselo.',
        'Las notas son de una versión de sí mismo que intenta salvarlo.',
        'Todo es un experimento y el espectador forma parte de él.',
        'La persona que se acerca es su reflejo, que ya no quiere seguir imitándolo.',
        'Los recuerdos falsos eran los verdaderos.'
      ]
    },
    leyenda: {
      titulos: ['La niña del paradero', 'El ascensor del piso trece', 'La autoestopista', 'El número que no debes llamar', 'La curva del diablo', 'El juego de medianoche'],
      lugares: ['una carretera sin iluminación', 'un edificio de oficinas vacío', 'una estación de tren abandonada', 'una escuela durante las vacaciones', 'un túnel bajo la ciudad', 'un puente donde ocurren accidentes'],
      premisas: [
        '{P} recoge en {l} a una joven empapada que pide que la lleven a una dirección que ya no existe.',
        'Un rumor dice que en {l} se cumple un deseo si sigues un ritual. {P} decide probarlo.',
        '{P} recibe en {l} una llamada de un número que pertenece a alguien fallecido hace años.',
        'Cada año, en la misma fecha, algo vuelve a {l}. Este año, {p} está allí.',
        '{P} encuentra en {l} un juego infantil con reglas escritas a mano y una advertencia: "nunca pierdas".'
      ],
      giros: [
        'La leyenda la inició el propio protagonista, sin recordarlo.',
        'El ritual no cumple deseos: los intercambia.',
        'La llamada viene del futuro, no del pasado.',
        'Cada persona que cuenta la historia se convierte en parte de ella.',
        'Nadie que haya ganado el juego ha vuelto para contarlo.'
      ]
    },
    misterio: {
      titulos: ['El pasajero 47', 'Las luces de 1987', 'La desaparición de la familia Ríos', 'Coordenadas', 'El último mensaje', 'La señal'],
      lugares: ['un pueblo minero abandonado', 'un barco encontrado a la deriva', 'una antena de radio en el desierto', 'una carretera donde desaparecen autos', 'una isla sin habitantes', 'un archivo policial olvidado'],
      premisas: [
        '{P} investiga la desaparición de todo un pueblo en {l}, donde la cena seguía servida en las mesas.',
        'En {l}, {p} encuentra una caja con cartas sin abrir dirigidas a personas desaparecidas.',
        '{P} capta en {l} una transmisión que repite números y su propio nombre.',
        'Un expediente cerrado lleva a {p} hasta {l}, donde todos los testigos cuentan exactamente la misma historia, palabra por palabra.',
        '{P} descubre que en {l} los relojes se detienen siempre a la misma hora.'
      ],
      giros: [
        'Los desaparecidos siguen allí, pero en otro momento del tiempo.',
        'El caso nunca fue cerrado: alguien lo mantiene abierto para atraer investigadores.',
        'Las coordenadas no indican un lugar, sino una fecha.',
        'Los testigos están repitiendo un guion que alguien les dio.',
        'El protagonista es uno de los desaparecidos y no lo sabe.'
      ]
    },
    folclore: {
      titulos: ['El silbido en el llano', 'La que llora en el río', 'El perro negro del camino', 'La luz mala', 'El hombre del sombrero', 'Las brujas del cerro'],
      lugares: ['un pueblo junto a un río', 'un llano interminable', 'una hacienda antigua', 'un cerro donde nadie sube de noche', 'un camino de tierra entre plantaciones', 'un mercado que cierra al anochecer'],
      premisas: [
        '{P} escucha en {l} un silbido que parece lejano, aunque los ancianos dicen que eso significa que está muy cerca.',
        'En {l}, {p} ve una mujer vestida de blanco que llora junto al agua y pregunta por sus hijos.',
        '{P} vuelve a {l} para el funeral de su abuela y encuentra un amuleto con instrucciones para "cuando él regrese".',
        'Una luz flota cada noche sobre {l}. {P} decide seguirla a pesar de las advertencias.',
        '{P} se pierde en {l} y un perro negro de ojos rojos empieza a acompañarle en silencio.'
      ],
      giros: [
        'La criatura no persigue: protege a quien la ve de algo peor.',
        'La abuela hizo un pacto, y la deuda pasó a su nieto.',
        'La leyenda era real, pero los culpables fueron los habitantes del pueblo.',
        'El protagonista es descendiente directo de quien originó la maldición.',
        'Los ancianos que advierten son los mismos que alimentan la leyenda.'
      ]
    },
    grabaciones: {
      titulos: ['Cinta 14', 'Archivo recuperado', 'La cámara seguía grabando', 'Transmisión interrumpida', 'Último video subido', 'Grabación de seguridad 03:17'],
      lugares: ['un sanatorio abandonado', 'un bosque donde se pierde la señal', 'una casa vendida a mitad de precio', 'un sótano sellado', 'un campamento de verano cerrado', 'una mina inundada'],
      premisas: [
        'Se encontró una cámara en {l}. El último video lo grabó {p}, y dura exactamente una hora más de lo que debería.',
        '{P} instala cámaras de seguridad en {l}. Cada mañana revisa las grabaciones y hay un minuto que falta.',
        'Un canal de exploración dejó de publicar después de visitar {l}. {P} encuentra el material sin editar.',
        '{P} transmite en vivo desde {l}, pero los comentarios del chat describen algo que está detrás de la cámara.',
        'Unas cintas VHS etiquetadas con fechas futuras aparecen en {l}. {P} empieza a verlas en orden.'
      ],
      giros: [
        'Quien sostiene la cámara en el último video no es el protagonista.',
        'El minuto que falta contiene una grabación del espectador.',
        'El canal nunca dejó de publicar: alguien sigue subiendo videos.',
        'Las cintas muestran el futuro, y la última está en blanco.',
        'La transmisión sigue en vivo meses después.'
      ]
    }
  };

  var DURACIONES = ['8 a 10 minutos', '10 a 12 minutos', '12 a 15 minutos', '15 a 20 minutos'];

  function azar(lista) {
    return lista[Math.floor(Math.random() * lista.length)];
  }

  function mayuscula(t) {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function rellenar(plantilla, protagonista, lugar) {
    return plantilla
      .replace(/\{P\}/g, mayuscula(protagonista))
      .replace(/\{p\}/g, protagonista)
      .replace(/\{l\}/g, lugar || '');
  }

  // subgenero: clave de SUBGENEROS o 'todos'
  function generar(subgenero) {
    var clave = DATOS[subgenero] ? subgenero : azar(Object.keys(DATOS));
    var d = DATOS[clave];
    var protagonista = azar(PROTAGONISTAS);
    var lugar = azar(d.lugares);
    return {
      subgenero: clave,
      titulo: azar(d.titulos),
      protagonista: mayuscula(protagonista),
      lugar: mayuscula(lugar),
      premisa: rellenar(azar(d.premisas), protagonista, lugar),
      giro: azar(d.giros),
      gancho: rellenar(azar(GANCHOS), protagonista, lugar),
      tono: azar(TONOS),
      duracion: azar(DURACIONES)
    };
  }

  // Estructura de escenas sugerida (plantilla) para empezar un guion a partir de una idea.
  function escenasDesdeIdea(idea) {
    return [
      {
        titulo: 'Gancho inicial',
        narracion: idea.gancho,
        visual: 'Plano oscuro y lento de ' + idea.lugar.toLowerCase() + '. Título del video al final.',
        sonido: 'Silencio, zumbido grave de fondo.',
        notas: 'Primeros 15 segundos: deben atrapar al espectador.'
      },
      {
        titulo: 'Presentación',
        narracion: idea.premisa,
        visual: 'Presentar al protagonista: ' + idea.protagonista.toLowerCase() + '.',
        sonido: 'Música ambiental suave.',
        notas: 'Explica quién es el protagonista y por qué está en ese lugar.'
      },
      {
        titulo: 'Los primeros sucesos',
        narracion: '',
        visual: '',
        sonido: '',
        notas: 'Describe los primeros hechos extraños. Empiezan siendo pequeños y fáciles de ignorar.'
      },
      {
        titulo: 'Escalada',
        narracion: '',
        visual: '',
        sonido: '',
        notas: 'Los sucesos se intensifican. El protagonista ya no puede negarlos.'
      },
      {
        titulo: 'El giro',
        narracion: '',
        visual: '',
        sonido: '',
        notas: 'Giro sugerido: ' + idea.giro
      },
      {
        titulo: 'Cierre',
        narracion: '',
        visual: '',
        sonido: '',
        notas: 'Final inquietante. Invita a comentar, dar me gusta y suscribirse.'
      }
    ];
  }

  function comoTexto(idea) {
    return [
      idea.titulo.toUpperCase(),
      'Subgénero: ' + SUBGENEROS[idea.subgenero],
      '',
      'Premisa: ' + idea.premisa,
      'Protagonista: ' + idea.protagonista,
      'Lugar: ' + idea.lugar,
      'Giro: ' + idea.giro,
      'Gancho: ' + idea.gancho,
      'Tono: ' + idea.tono,
      'Duración sugerida: ' + idea.duracion
    ].join('\n');
  }

  return {
    SUBGENEROS: SUBGENEROS,
    generar: generar,
    escenasDesdeIdea: escenasDesdeIdea,
    comoTexto: comoTexto
  };
})();
