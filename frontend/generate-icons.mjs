// generate-icons.mjs
// Genera iconos WeyBot desde bot.png:
//   - frontend/public/icons/   (PWA icons)
//   - android mipmap folders   (APK Android icons)

import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Localizar bot.png (puede estar en public/ o ../public/)
const candidates = [
  resolve(__dirname, 'public/bot.png'),
  resolve(__dirname, '../public/bot.png'),
  resolve(__dirname, 'public/bot.svg'),
  resolve(__dirname, '../public/bot.svg'),
];

const SRC = candidates.find(p => existsSync(p));
if (!SRC) {
  console.error('ERROR: No se encontro bot.png en ninguna de las rutas esperadas:');
  candidates.forEach(c => console.error('  -', c));
  process.exit(1);
}

const PWA_DIR      = resolve(__dirname, 'public/icons');
const ANDROID_RES  = resolve(__dirname, 'src-capacitor/android/app/src/main/res');
const THEME_BG     = { r: 13, g: 27, b: 62, alpha: 1 }; // #0D1B3E
const TRANSPARENT  = { r: 0, g: 0, b: 0, alpha: 0 };

const PWA_SIZES = [
  { name: 'favicon.ico',            size: 64  },
  { name: 'icon-128x128.png',       size: 128 },
  { name: 'icon-192x192.png',       size: 192 },
  { name: 'icon-256x256.png',       size: 256 },
  { name: 'icon-384x384.png',       size: 384 },
  { name: 'icon-512x512.png',       size: 512 },
  { name: 'apple-icon-120x120.png', size: 120 },
  { name: 'apple-icon-152x152.png', size: 152 },
  { name: 'apple-icon-167x167.png', size: 167 },
  { name: 'apple-icon-180x180.png', size: 180 },
  { name: 'ms-icon-144x144.png',    size: 144 },
];

const MIPMAP_SIZES = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

async function run() {
  console.log('Generando iconos WeyBot desde:', SRC);
  console.log('');

  // 1. Iconos PWA
  console.log('Iconos PWA ->', PWA_DIR);
  mkdirSync(PWA_DIR, { recursive: true });
  for (const { name, size } of PWA_SIZES) {
    const out = resolve(PWA_DIR, name);
    await sharp(SRC)
      .resize(size, size, { fit: 'contain', background: THEME_BG })
      .flatten({ background: THEME_BG })
      .png()
      .toFile(out);
    console.log('  OK', name, size + 'x' + size);
  }

  // Favicon en root de frontend/public
  await sharp(SRC)
    .resize(64, 64, { fit: 'contain', background: THEME_BG })
    .flatten({ background: THEME_BG })
    .png()
    .toFile(resolve(__dirname, 'public/favicon.ico'));
  console.log('  OK favicon.ico (frontend/public/)');
  console.log('');

  // 2. Iconos Android Mipmap (APK)
  console.log('Iconos Android mipmap ->', ANDROID_RES);
  for (const { dir, size } of MIPMAP_SIZES) {
    const outDir = resolve(ANDROID_RES, dir);
    mkdirSync(outDir, { recursive: true });

    // Icono legacy plano (cuadrado / standard)
    await sharp(SRC)
      .resize(size, size, { fit: 'contain', background: THEME_BG })
      .flatten({ background: THEME_BG })
      .png()
      .toFile(resolve(outDir, 'ic_launcher.png'));

    // Icono legacy redondo
    await sharp(SRC)
      .resize(size, size, { fit: 'contain', background: THEME_BG })
      .flatten({ background: THEME_BG })
      .png()
      .toFile(resolve(outDir, 'ic_launcher_round.png'));

    // Icono adaptativo Android (Foreground transparente dentro de safe-zone 62%)
    const fgSize = Math.round(size * 0.62);
    const padTop = Math.floor((size - fgSize) / 2);
    const padBottom = size - fgSize - padTop;
    const padLeft = Math.floor((size - fgSize) / 2);
    const padRight = size - fgSize - padLeft;

    await sharp(SRC)
      .resize(fgSize, fgSize, { fit: 'contain', background: TRANSPARENT })
      .extend({
        top: padTop,
        bottom: padBottom,
        left: padLeft,
        right: padRight,
        background: TRANSPARENT
      })
      .png()
      .toFile(resolve(outDir, 'ic_launcher_foreground.png'));

    console.log('  OK', dir, '(' + size + 'x' + size + 'px)');
  }

  console.log('');
  console.log('Todos los iconos se han generado con exito!');
}

run().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
