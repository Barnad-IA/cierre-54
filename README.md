# Vueltabajero Event Planner

Editor local para distribuir instalaciones en el perímetro del evento en Cartagena. Vite, React y TypeScript sirven el plano SVG y el visor Three.js con React Three Fiber y Drei. Los proyectos, escenarios y archivos importados se guardan en IndexedDB mediante Dexie. Zustand gestiona el editor y su historial.

## Arranque

En PowerShell, desde esta carpeta:

```powershell
npm ci
npm run dev
```

Abre [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Usa el mismo navegador y la misma dirección para recuperar el guardado local. Las comprobaciones se ejecutan con `npm run lint`, `npm test` y `npm run build`. Para servir el build localmente, ejecuta `npm run preview`.

## Terreno y coordenadas

- `public/data/terreno.kml` es una copia del KML de referencia y se carga al iniciar en un navegador sin proyecto guardado. El editor calcula 26 vértices exteriores, unos 7.431,4 m² y 729,77 m de perímetro. **Importar → Terreno KML** permite sustituirlo. Si el archivo predeterminado falta, el editor identifica el polígono de práctica.
- El importador acepta un `Polygon` con anillo exterior e interiores opcionales. Conserva los vértices y retira el punto de cierre redundante. Transforma longitud y latitud de [WGS84 a UTM 18N](https://epsg.io/32618) con Proj4 y resta el primer vértice proyectado. Para obtener UTM absoluto, suma el origen mostrado en **Ayuda** a las coordenadas locales.
- X crece al este y Y al norte de cuadrícula. La elevación es relativa al suelo plano del editor. Se conservan las altitudes del KML como datos de origen. No hay modelo digital de elevaciones. Three.js recibe `[X, elevación, -Y]` y el giro positivo lleva el eje este hacia el norte.
- La imagen es opcional. Para calibrar una ortofoto introduce al menos tres controles no alineados como `u v X Y`, con píxeles desde la esquina superior izquierda y metros locales. El ajuste estima traslación, giro y escala uniforme. Muestra el error RMS y rechaza controles con error máximo superior a 0,50 m. Las imágenes de referencia que acompañan al proyecto carecen de controles y quedan fuera del plano.

## Edición

1. Dibuja polígonos con **Dibujar zona** o edita sus vértices en **Zonas**. Define las áreas autorizadas y las reservas de acceso, circulación, emergencia, carretera, exclusión u obstáculos. La superficie libre se calcula como la unión de las zonas autorizadas dentro del terreno, menos las reservas y las huellas.
2. Arrastra un modelo al plano o haz clic en el catálogo y después en el plano. Mueve objetos con el puntero y usa **Propiedades** para posición, giro, elevación, dimensiones, estado, costo y observaciones. Mayús + clic amplía la selección. Los objetos bloqueados conservan su posición y los ocultos siguen contando para análisis e inventario.
3. En 2D, usa la rueda para acercar y Alt + arrastre para desplazar. La rejilla muestra los metros individuales al acercar. Las herramientas miden distancias, secciones de paso entre dos puntos, áreas poligonales y distancia mínima entre huellas. En 3D puedes orbitar, acercar y desplazar la cámara. El recorrido usa WASD y captura del puntero en navegadores compatibles.
4. Los escenarios A, B y C tienen sus propios objetos y zonas. El historial de deshacer y rehacer conserva hasta 50 ediciones durante la sesión. El escenario activo y todos los datos del proyecto se recuperan al recargar una vez que aparece **Guardado local**.

Las áreas y alertas usan intersecciones y uniones planas de huellas rectangulares rotadas. El contacto de bordes tiene separación cero y cuenta como colisión únicamente si hay área de solapamiento. La ocupación mide la unión de huellas de todo el escenario, incluidas las que quedan fuera del terreno. La aplicación permite conservar posiciones con alertas. La autorización del suelo, la verificación de rutas y el aforo corresponden a la revisión humana.

## Modelos y exportaciones

- `public/models/` contiene copias de GLB de Blender. **Añadir modelo** admite GLB y glTF. Para un glTF con recursos separados, selecciona también los archivos de malla y texturas. Los originales se guardan en IndexedDB y las instancias comparten geometrías y materiales. Si falla un modelo, la instancia conserva sus datos y aparece una primitiva.
- Configura dimensiones, metros por unidad, giro de origen y desplazamiento del anclaje de la malla. Los ejes con dimensiones declaradas se ajustan a esas medidas. Los ejes sin medida conservan la escala de malla; las primitivas de dimensiones pendientes usan un símbolo orientativo. La huella se calcula con el ancho y fondo declarados y se centra en X/Y. Un anclaje distinto de cero corrige la posición visual de la malla. Las medidas estimadas al importar se marcan como provisionales.
- **Proyecto JSON** incluye el esquema v1, todos los escenarios, modelos subidos y ortofoto. **Inventario CSV** agrupa por elemento y dimensiones del escenario activo y suma sus huellas individuales. **Plano PNG** y **Plano PDF a escala** usan el perímetro completo. El PDF tiene tamaño de página personalizado según la escala elegida. Imprime al 100 % y verifica la regla.
- Las imágenes y modelos se procesan localmente. Para conservar una copia independiente del navegador, exporta el JSON.

## Código

| Archivo | Responsabilidad |
| --- | --- |
| `src/geo.ts` | Proyección, KML, huellas, mediciones y análisis con polyclip-ts |
| `src/editor.ts` | Estado, escenarios, selección y undo/redo |
| `src/plan.tsx` / `src/scene.tsx` | Visores 2D y 3D |
| `src/models.ts` / `src/ortho.ts` | Archivos de modelo y ajuste de ortofoto |
| `src/storage.ts` / `src/exports.tsx` | Persistencia, intercambio e informes |
| `tests/` | Proyección, medición, colisión, calibración y persistencia |


## Referencia aérea del evento y longitud

El selector Fondo aéreo permite alternar entre las imágenes con árboles, sin árboles y el plano sin imagen. Ambas variantes se alinean visualmente con la captura anotada y el KML. La línea azul discontinua aproxima el trazado visto en la captura. Se muestran la distancia recorrida por la línea y la distancia recta entre los extremos. La imagen elegida es una textura plana de contexto en 3D. Para la línea georreferenciada, exporta la capa «largo» como un archivo KML con un solo LineString e impórtala con **Importar → Línea «largo» (KML)**. La línea importada se guarda con el proyecto y se dibuja también en las exportaciones de plano. Las medidas de Google Earth en la segunda captura corresponden al polígono mostrado allí. El editor calcula métricas planas desde las coordenadas del archivo KML.

## Publicar una vista del evento en Vercel

1. Abre el escenario que quieras compartir y elige **Exportar → Compartir evento**. Usa **Vista previa** para revisar el plano, la vista 3D y el recorrido.
2. Elige un nombre para el enlace y descarga el archivo público. Guárdalo con el mismo nombre dentro de `public/eventos/` y súbelo al repositorio junto con el código.
3. Importa el repositorio de GitHub en Vercel con el preset **Vite**. El comando de compilación es `npm run build` y la salida es `dist`.
4. En el diálogo **Compartir evento**, pon la dirección de producción de Vercel y copia el enlace. Tiene la forma `https://tu-proyecto.vercel.app/?evento=nombre-del-evento`.

La vista pública lee el JSON desplegado. Incluye los objetos visibles del escenario activo y sus modelos. Los cambios posteriores requieren volver a exportar y subir el archivo. Si conservas su nombre, puedes seguir usando el mismo enlace.
