import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@huggingface/transformers` arrastra `onnxruntime-node`, que carga
   * binarios nativos (`.node`) con `require` en runtime. Si el bundler
   * lo toca, la carga del modelo falla. Se deja afuera y se resuelve
   * desde `node_modules` como en Node normal.
   */
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

  /**
   * Los pesos del modelo no se commitean (266 MB, repo público, y GitHub
   * corta en 100 MB): los baja `npm run descargar:modelo` durante el
   * build a `.modelos/`. El file tracing de Next no puede adivinar esa
   * dependencia porque no hay ningún `import` que apunte ahí —
   * transformers.js arma la ruta en runtime— así que hay que declararla
   * a mano o la función se despliega sin el modelo y la búsqueda queda
   * siempre en modo degradado.
   *
   * La clave es la ruta de la route, y las rutas son relativas a la raíz
   * del proyecto.
   */
  outputFileTracingIncludes: {
    "/api/lecciones/buscar": [
      "./.modelos/**/*",
      "./node_modules/onnxruntime-node/bin/**/*",
    ],
  },
};

export default nextConfig;
