# La captura de referencia del canal h2d

`figma-extension-fx-img.json` es el payload decodificado de una captura **real de la
extensión oficial de Figma** (2026-08-07) sobre `demo/challenges.html` → `#fx-img`, la
tarjeta de imágenes, a 713px de ancho de layout.

**No se puede regenerar.** Requiere una persona con la extensión instalada, mirando esa
página, apretando el botón, y pegando el portapapeles crudo. Todo lo que este motor sabe
del formato h2d salió de decodificar esto y una captura anterior: el esquema de `assets`,
que un `<img>` viaja por `currentSrc` y no por `src`, que sólo se mandan las propiedades
cuyo valor no es el inicial, qué hay en `computedStyles`, y que los nodos de texto en
blanco también viajan. El archivo estuvo hasta hoy en un directorio temporal.

Es la ÚNICA verdad de campo que existe sobre un formato propietario, sin documentar y ya
en `version: 2`, que Figma puede cambiar en cualquier release sin aviso. Si algún día un
pegado deja de funcionar, esto es contra lo que se compara para saber qué se movió.

Se usa como oráculo en `test/verify-h2d.mjs`. Lo que ese archivo NO hace es exigir
igualdad byte a byte: hay dos diferencias deliberadas y medidas —`outlineWidth` y
`columnRuleWidth`, que su serializador manda constantes en todos los nodos mientras la
página resuelve `0px` en los dos— documentadas en `FIGMA_FINDINGS.md` y en
`src/emit/h2d.js`.
