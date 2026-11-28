// electron-builder vyhadzuje z node_modules priečinky „examples“ – GLTFLoader (načítač 3D) sa preto kopíruje k postavičke
const fs = require('fs');
const path = require('path');
const z = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm');
const ciel = path.join(__dirname, '..', 'src', 'postava', 'lib');
if (!fs.existsSync(z)) process.exit(0);
for (const f of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js']) {
  fs.mkdirSync(path.dirname(path.join(ciel, f)), { recursive: true });
  fs.copyFileSync(path.join(z, f), path.join(ciel, f));
}
console.log('three: GLTFLoader skopírovaný');
