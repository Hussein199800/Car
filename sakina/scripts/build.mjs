import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = 'www/build';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/fonts`, { recursive: true });

// الخطوط مدمجة داخل التطبيق ليعمل بلا إنترنت: الحروف العربية واللاتينية فقط لتصغير الحجم
const fonts = [
  ['amiri', 'amiri-arabic-400-normal'], ['amiri', 'amiri-arabic-700-normal'], ['amiri', 'amiri-latin-400-normal'],
  ...[300, 400, 500, 600, 700].flatMap((w) => [
    ['ibm-plex-sans-arabic', `ibm-plex-sans-arabic-arabic-${w}-normal`],
    ['ibm-plex-sans-arabic', `ibm-plex-sans-arabic-latin-${w}-normal`],
  ]),
];
for (const [pkg, file] of fonts) cpSync(`node_modules/@fontsource/${pkg}/files/${file}.woff2`, `${out}/fonts/${file}.woff2`);

await build({
  entryPoints: ['src/main.js', 'src/styles.css'],
  bundle: true,
  minify: true,
  format: 'iife',
  // يعمل على WebView أندرويد 8 (Chrome 61+) بتحويل الصياغات الحديثة
  target: ['chrome61'],
  outdir: out,
  external: ['fonts/*'],
  logLevel: 'info',
});
