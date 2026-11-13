# Fotos de los retos del Lab CV

Cada carpeta es un reto de la pestaña «Retos» del Lab CV. La web no incluye fotos: hay que
ponerlas aquí, con una licencia que permita usarlas en clase (por ejemplo, CC0 o fotos propias).

Mientras un reto no tenga fotos, su tarjeta dice que faltan y no se puede cargar.

Git solo sigue este README y los `manifest.json`: las fotos están en `.gitignore`, porque
la constitución del proyecto prohíbe subir conjuntos de datos al repositorio. Para publicarlas,
cópialas en esta carpeta al desplegar o decide explícitamente versionarlas (con `git add -f`).

## Cómo añadir las fotos

1. Copia las fotos en la carpeta del reto, con una subcarpeta por clase si quieres
   (`huskyWolf/husky/01.jpg`, `huskyWolf/wolf/01.jpg`…).
2. Escribe sus rutas en el `manifest.json` de la carpeta, relativas a esa carpeta:

```json
{
  "classes": {
    "husky": ["husky/01.jpg", "husky/02.jpg"],
    "wolf": ["wolf/01.jpg", "wolf/02.jpg"]
  },
  "test": [
    { "file": "test/husky-nieve.jpg", "label": "Husky en la nieve" }
  ]
}
```

- `classes`: fotos de entrenamiento por clase. Las claves no se pueden cambiar: son las que
  usa la app (abajo).
- `test`: fotos para explicar después de entrenar, las que delatan la trampa. Aparecen como
  «Fotos de prueba del reto» junto al botón de congelar imagen.

Las fotos se recortan al cuadrado central y se reducen a 224 × 224 px, igual que una foto
subida por el alumnado. Con 15–30 fotos por clase basta.

## Retos y lo que necesita cada uno

| Carpeta | Clases | Trampa que deben tener las fotos | Fotos de prueba |
|---|---|---|---|
| `huskyWolf` | `husky`, `wolf` | Todos los lobos sobre nieve; los huskies sobre hierba, en casa o en la calle. | Un husky en la nieve; un lobo sin nieve. |
| `fewCats` | `dog`, `cat` | Muchos perros (unos 30) y pocos gatos (unos 5). | Algunos gatos que no estén en el entrenamiento. |
| `orangeBall` | `orange`, `ball` | Naranjas (fruta) y pelotas de colores, ninguna pelota naranja. | Una pelota naranja (de baloncesto, por ejemplo). |
