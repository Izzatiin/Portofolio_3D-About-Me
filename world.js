// Nawfal's World — portofolio 3D interaktif berbentuk planet mini.
// Semua model dibuat secara prosedural (tanpa file 3D), jadi ringan dan mudah diubah.
import * as THREE from "./vendor/three.module.min.js";

/* ===================== UTIL ===================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
// state modul (dideklarasikan di atas karena dunia di-boot sebelum fungsi-fungsi di bawah)
let uiState = null;
// video di panel berhenti saat panelnya ditutup, supaya suaranya tidak terus berbunyi
const pauseMedia = (el) => el.querySelectorAll("video").forEach((v) => v.pause());
let emailjsPromise = null;
let worldReady = false; // input dunia 3D baru aktif setelah semuanya selesai dibangun
const IS_TOUCH = matchMedia("(pointer: coarse)").matches;
// Panel jadi "bottom sheet" di layar sempit atau HP landscape (harus sama dengan CSS)
const SHEET_MQ = matchMedia("(max-width: 720px), (pointer: coarse) and (max-height: 500px)");
const isNarrow = () => SHEET_MQ.matches;

// RNG dengan seed supaya dunia selalu sama setiap dibuka
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261014);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

/* ===================== GEOMETRI BOLA ===================== */
const UP = new THREE.Vector3(0, 1, 0);
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

const sph = (polar, az) =>
  new THREE.Vector3(Math.sin(polar) * Math.cos(az), Math.cos(polar), Math.sin(polar) * Math.sin(az));

const angleBetween = (a, b) => Math.acos(clamp(a.dot(b), -1, 1));

function slerpDir(a, b, t) {
  const ang = angleBetween(a, b);
  if (ang < 1e-6) return a.clone();
  const s = Math.sin(ang);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * ang) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * ang) / s));
}

function anyTangent(n) {
  const a = Math.abs(n.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  return a.clone().sub(n.clone().multiplyScalar(n.dot(a))).normalize();
}

function tangentToward(from, to) {
  const t = to.clone().sub(from.clone().multiplyScalar(from.dot(to)));
  return t.lengthSq() < 1e-10 ? anyTangent(from) : t.normalize();
}

function projectTangent(v, n) {
  v.sub(_t1.copy(n).multiplyScalar(n.dot(v)));
  if (v.lengthSq() < 1e-10) v.copy(anyTangent(n));
  return v.normalize();
}

// Orientasi lokal: Y = atas (normal bola), Z = arah depan
const _m4 = new THREE.Matrix4();
function frameQuat(up, forward, out = new THREE.Quaternion()) {
  const z = _t1.copy(forward).sub(_t2.copy(up).multiplyScalar(up.dot(forward))).normalize();
  const x = _t2.crossVectors(up, z).normalize();
  return out.setFromRotationMatrix(_m4.makeBasis(x, up, z));
}

const moveAlong = (dir, tangent, ang) =>
  dir.clone().multiplyScalar(Math.cos(ang)).add(tangent.clone().multiplyScalar(Math.sin(ang))).normalize();

/* ===================== TATA LETAK DUNIA ===================== */
const R = 12;
const POLE = UP.clone();
const BASE_AZ = 0.35;

const STATIONS = [
  { id: "about", name: "Rumah Nawfal", label: "About Me", polar: 0.6, az: BASE_AZ, radius: 0.125 },
  { id: "skills", name: "Bengkel Kreatif", label: "Skills", polar: 0.64, az: BASE_AZ + Math.PI / 2, radius: 0.12 },
  { id: "work", name: "Bioskop Mini", label: "My Work", polar: 0.64, az: BASE_AZ + Math.PI, radius: 0.14 },
  // proyek terbaru: tepat di depan titik awal pemain
  { id: "izza", name: "Observatorium IZZA", label: "IZZA", polar: 0.86, az: BASE_AZ + Math.PI * 0.75, radius: 0.13 },
  { id: "contact", name: "Kantor Pos", label: "Contact", polar: 0.6, az: BASE_AZ + Math.PI * 1.5, radius: 0.12 },
];
for (const s of STATIONS) {
  s.dir = sph(s.polar, s.az);
  s.forward = tangentToward(s.dir, POLE);
  s.front = moveAlong(s.dir, s.forward, 0.19);
}
const byId = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

const POND = { dir: sph(1.08, BASE_AZ + Math.PI * 0.27), r: 0.14 };
const CAMP = { dir: sph(2.3, BASE_AZ + Math.PI * 1.15) };
const SPAWN = sph(0.1, BASE_AZ + Math.PI * 0.78);

// Jalan setapak berkelok (rangkaian busur lingkaran besar)
const PATH_ARCS = [];
function addArc(a, b) {
  const len = angleBetween(a, b);
  PATH_ARCS.push({
    a,
    b,
    n: new THREE.Vector3().crossVectors(a, b).normalize(),
    len,
    mid: a.clone().add(b).normalize(),
    half: len / 2,
  });
}
function addTrail(a, b, wiggle = 0.03, steps = 7, phase = 0) {
  const side = new THREE.Vector3().crossVectors(a, b).normalize();
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    let p = slerpDir(a, b, t);
    const off = wiggle * Math.sin(t * Math.PI * 2 + phase) * Math.sin(t * Math.PI);
    p = p.add(side.clone().multiplyScalar(off)).normalize();
    addArc(prev, p);
    prev = p;
  }
}
STATIONS.forEach((s, i) => addTrail(POLE, s.front, 0.025, 6, i * 1.3));
addTrail(byId.about.front, moveAlong(POND.dir, tangentToward(POND.dir, byId.about.front), POND.r + 0.02), 0.04, 7, 0.4);
{
  const mid = sph(1.55, BASE_AZ + Math.PI * 1.32);
  addTrail(byId.contact.front, mid, 0.05, 8, 2.1);
  addTrail(mid, moveAlong(CAMP.dir, tangentToward(CAMP.dir, mid), 0.07), 0.05, 8, 0.7);
}

function arcDist(v, arc) {
  const sd = v.dot(arc.n);
  const p = _t1.copy(v).sub(_t2.copy(arc.n).multiplyScalar(sd));
  const pl = p.length();
  if (pl > 1e-6) {
    p.divideScalar(pl);
    const da = angleBetween(arc.a, p);
    const db = angleBetween(p, arc.b);
    if (Math.abs(da + db - arc.len) < 1e-4) return Math.asin(Math.min(1, Math.abs(sd)));
  }
  return Math.min(angleBetween(v, arc.a), angleBetween(v, arc.b));
}

// cap: jarak maksimum yang dipedulikan pemanggil (mempercepat perhitungan)
function pathDist(v, cap = Infinity) {
  let d = cap;
  for (const arc of PATH_ARCS) {
    // batas bawah jarak ke busur: jarak ke titik tengah dikurangi setengah panjangnya
    if (angleBetween(v, arc.mid) - arc.half >= d) continue;
    d = Math.min(d, arcDist(v, arc));
  }
  return d;
}

const PATH_W = 0.04;

function baseNoise(v) {
  return (
    0.2 * Math.sin(v.x * 3.1 + v.y * 1.7 + 0.5) * Math.cos(v.z * 2.3 - 0.7) +
    0.15 * Math.sin(v.y * 5.3 + v.z * 3.1 + 1.9) +
    0.1 * Math.sin(v.z * 7.7 + v.x * 5.9 + 0.3) +
    0.06 * Math.sin(v.x * 11.3 - v.y * 9.1)
  );
}

function heightAt(v) {
  let h = baseNoise(v);
  let flat = 1;
  for (const s of STATIONS) flat = Math.min(flat, smooth(0.17, 0.3, angleBetween(v, s.dir)));
  flat = Math.min(flat, smooth(0.1, 0.22, angleBetween(v, POLE)));
  flat = Math.min(flat, smooth(0.08, 0.18, angleBetween(v, CAMP.dir)));
  flat = Math.min(flat, 0.45 + 0.55 * smooth(PATH_W, PATH_W + 0.06, pathDist(v, 0.2)));
  h *= flat;
  const pa = angleBetween(v, POND.dir);
  if (pa < POND.r + 0.06) h = lerp(-0.55, h, smooth(POND.r - 0.05, POND.r + 0.06, pa));
  return h;
}

const surfaceRadius = (dir) => R + heightAt(dir);

/* ===================== RENDERER & SCENE ===================== */
const canvas = $("#world");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (err) {
  renderer = null;
}

const body = document.body;
const loaderEl = $("#loader");
const loaderText = $("#loader-text");

function showFallback(message) {
  body.classList.add("no-webgl");
  body.classList.remove("is-playing", "is-loading");
  const note = document.createElement("p");
  note.className = "webgl-note";
  note.textContent = `${message} Pilih menu di atas untuk membaca isinya.`;
  $("#intro").appendChild(note);
  loaderEl.classList.add("is-done");
  initUI({ world: false });
}

window.__worldBooted = true;
if (body.classList.contains("boot-failed")) {
  // Modul datang terlambat (koneksi lambat): matikan jaring pengaman, lalu bangun dunianya seperti biasa
  window.__fallbackActive = false;
  body.classList.remove("no-webgl", "boot-failed");
  $$(".webgl-note").forEach((n) => n.remove());
  $$(".panel").forEach((p) => (p.hidden = true));
}
if (!renderer) {
  showFallback("Browser ini belum mendukung WebGL, jadi dunia 3D-nya tidak bisa tampil.");
} else {
  try {
    initWorld();
  } catch (err) {
    console.error(err);
    showFallback("Dunia 3D gagal dimuat di perangkat ini.");
  }
}

function initWorld() {
  const maxDpr = IS_TOUCH ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = IS_TOUCH ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);

  const hemi = new THREE.HemisphereLight("#e4f3ff", "#5d7d3c", 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff1d6", 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -(R + 4);
  sc.right = sc.top = R + 4;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  /* ---------- Material helper ---------- */
  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) {
      matCache.set(
        key,
        new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...opts }),
      );
    }
    return matCache.get(key);
  }
  function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, typeof material === "string" ? mat(material) : material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  // box dengan alas di y
  const box = (w, h, d, color, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z);
  const cyl = (rt, rb, h, seg, color, x = 0, y = 0, z = 0) =>
    mesh(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y + h / 2, z);

  // Atap pelana: dua bidang miring + segitiga dinding (bubungan sejajar sumbu X)
  function gableRoof(w, d, h, roofColor, wallColor, overhang = 0.2) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const tri = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    tri.translate(0, 0, -w / 2);
    const gable = mesh(tri, wallColor);
    gable.rotation.y = Math.PI / 2;
    g.add(gable);
    const ang = Math.atan2(h, d / 2);
    const run = d / 2 + overhang;
    const len = run / Math.cos(ang);
    const th = 0.12;
    for (const side of [-1, 1]) {
      const slab = mesh(new THREE.BoxGeometry(w + overhang * 2, th, len), roofColor);
      slab.rotation.x = side * ang;
      slab.position.set(0, h - (run * Math.tan(ang)) / 2 + (th / 2) / Math.cos(ang), (side * run) / 2);
      g.add(slab);
    }
    const cap = mesh(new THREE.BoxGeometry(w + overhang * 2 + 0.04, 0.09, 0.2), roofColor);
    cap.position.y = h + th / Math.cos(ang) - 0.03;
    g.add(cap);
    g.userData.slope = { ang, run, th, h };
    return g;
  }

  /* ---------- Teks di kanvas (papan nama) ---------- */
  const textRedraws = [];
  function textTexture(lines, { w = 512, h = 160, bg = "#f5e9d0", fg = "#7a4a22", border = "#d8c08f", size = 74 } = {}) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const draw = () => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, w - 10, h - 10);
      }
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const arr = Array.isArray(lines) ? lines : [lines];
      const lh = h / (arr.length + 0.4);
      arr.forEach((line, i) => {
        let fs = size / (arr.length > 1 ? 1.25 : 1);
        ctx.font = `900 ${fs}px Nunito, "Arial Rounded MT Bold", system-ui, sans-serif`;
        while (ctx.measureText(line).width > w - 40 && fs > 12) {
          fs -= 2;
          ctx.font = `900 ${fs}px Nunito, "Arial Rounded MT Bold", system-ui, sans-serif`;
        }
        ctx.fillText(line, w / 2, lh * (i + 0.7) + (arr.length > 1 ? 0 : h * 0.02));
      });
      tex.needsUpdate = true;
    };
    draw();
    textRedraws.push(draw);
    return tex;
  }
  function textPlane(lines, width, height, opts) {
    const tex = textTexture(lines, opts);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    );
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  }

  /* ---------- Tekstur gambar portofolio ---------- */
  const manager = new THREE.LoadingManager();
  const texLoader = new THREE.TextureLoader(manager);
  const loadTex = (src) => {
    const t = texLoader.load(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const texFilm = loadTex("assets/simpang-kisah.jpg");
  const texWeb = loadTex("assets/web-pertama.jpg");
  const texPhoto = loadTex("assets/foto-nawfal.jpg");
  const texIzzaScreen = loadTex("assets/izza/izza-layar.jpg");
  const texIzzaLogo = loadTex("assets/izza/izza-logo.png");
  // foto persegi di bingkai 0.62x0.68: potong sisi kiri-kanan supaya tidak gepeng
  texPhoto.repeat.set(0.62 / 0.68, 1);
  texPhoto.offset.set((1 - 0.62 / 0.68) / 2, 0);

  /* ===================== PLANET ===================== */
  const planetGeo = new THREE.IcosahedronGeometry(1, 22);
  {
    const pos = planetGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const cache = new Map(); // tiap titik dipakai ~6 segitiga, hitung sekali saja
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      let r = cache.get(key);
      if (r === undefined) cache.set(key, (r = surfaceRadius(v)));
      pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    }
    const GRASS = ["#6fa84a", "#77b14f", "#679f44", "#7cb552"].map((c) => new THREE.Color(c));
    const MEADOW = new THREE.Color("#9cbf5a");
    const DIRT = ["#c98b4f", "#c48448", "#d09658"].map((c) => new THREE.Color(c));
    const YARD = new THREE.Color("#d6aa6e");
    const SAND = new THREE.Color("#dcc690");
    const POND_BED = new THREE.Color("#3f8f9a");
    const FOREST = new THREE.Color("#5b9140");
    const c = new THREE.Vector3();
    const a = new THREE.Vector3();
    const col = new THREE.Color();
    for (let f = 0; f < pos.count; f += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.add(a.fromBufferAttribute(pos, f + k).normalize());
      c.normalize();
      const pa = angleBetween(c, POND.dir);
      const pd = pathDist(c, 0.2);
      const wob = 0.006 * Math.sin(c.x * 40 + c.z * 33);
      let nearStation = Infinity;
      for (const s of STATIONS) nearStation = Math.min(nearStation, angleBetween(c, s.dir));
      const r1 = rand();
      if (pa < POND.r - 0.02) col.copy(POND_BED);
      else if (pa < POND.r + 0.035) col.copy(SAND);
      else if (pd < PATH_W + wob) col.copy(DIRT[Math.floor(r1 * DIRT.length)]);
      else if (angleBetween(c, POLE) < 0.085 || nearStation < 0.155 || angleBetween(c, CAMP.dir) < 0.08) col.copy(YARD);
      else {
        // warna rumput bergelombang halus (bukan acak per segitiga) supaya lembut
        const n = 0.5 + 0.5 * Math.sin(c.x * 4.1 + c.z * 3.3 + 0.6) * Math.cos(c.y * 3.7 - c.x * 1.3);
        col.copy(GRASS[2]).lerp(GRASS[3], n);
        col.offsetHSL(0, 0, (r1 - 0.5) * 0.03);
        if (rand() < 0.03) col.lerp(MEADOW, 0.4);
        // sisi belakang planet sedikit lebih gelap (hutan)
        col.lerp(FOREST, smooth(1.2, 2.4, angleBetween(c, POLE)) * 0.2);
      }
      for (let k = 0; k < 3; k++) {
        colors[(f + k) * 3] = col.r;
        colors[(f + k) * 3 + 1] = col.g;
        colors[(f + k) * 3 + 2] = col.b;
      }
    }
    planetGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    planetGeo.computeVertexNormals();
  }
  const planet = new THREE.Mesh(
    planetGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  planet.receiveShadow = true;
  scene.add(planet);

  // Kolam
  {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(POND.r * R * 1.04, 28),
      new THREE.MeshStandardMaterial({
        color: "#59b9cf",
        roughness: 0.25,
        transparent: true,
        opacity: 0.88,
        flatShading: true,
      }),
    );
    water.position.copy(POND.dir).multiplyScalar(R - 0.22);
    water.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), POND.dir);
    water.receiveShadow = true;
    scene.add(water);
    // daun teratai
    for (let i = 0; i < 5; i++) {
      const d = moveAlong(POND.dir, anyTangent(POND.dir).applyAxisAngle(POND.dir, i * 1.7), 0.03 + rand() * 0.07);
      const pad = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 7), "#4c8f3a");
      pad.position.copy(d).multiplyScalar(R - 0.17);
      pad.quaternion.setFromUnitVectors(UP, d);
      scene.add(pad);
    }
  }

  /* ---------- Penempatan di permukaan ---------- */
  const colliders = []; // { dir, r } dalam radian
  function placeOnSurface(obj, dir, forward, lift = 0) {
    obj.position.copy(dir).multiplyScalar(surfaceRadius(dir) + lift);
    frameQuat(dir, forward, obj.quaternion);
    scene.add(obj);
    return obj;
  }

  /* ===================== BANGUNAN ===================== */
  const pickables = [];
  const animated = []; // fungsi (t, dt)

  function signBoard(text, w = 1.3, h = 0.42, postH = 1.0) {
    const g = new THREE.Group();
    g.add(box(0.08, postH, 0.08, "#7a4a22", -w / 2 + 0.1, 0, 0));
    g.add(box(0.08, postH, 0.08, "#7a4a22", w / 2 - 0.1, 0, 0));
    g.add(box(w + 0.08, h + 0.08, 0.06, "#8a5a33", 0, postH - 0.05, 0));
    const p = textPlane(text, w, h, { w: 512, h: Math.round((512 * h) / w) });
    p.position.set(0, postH - 0.05 + (h + 0.08) / 2, 0.035);
    g.add(p);
    return g;
  }

  // Papan nama khusus IZZA: logo asli di atas papan gelap
  function logoBoard() {
    const g = new THREE.Group();
    const w = 1.5;
    const h = 0.45;
    const postH = 0.8;
    g.add(box(0.08, postH, 0.08, "#2a2530", -w / 2 + 0.12, 0, 0));
    g.add(box(0.08, postH, 0.08, "#2a2530", w / 2 - 0.12, 0, 0));
    g.add(box(w + 0.1, h + 0.1, 0.06, "#141015", 0, postH - 0.05, 0));
    g.add(box(w + 0.1, 0.05, 0.065, "#e8702f", 0, postH - 0.05, 0));
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * (192 / 640)),
      new THREE.MeshBasicMaterial({ map: texIzzaLogo, transparent: true }),
    );
    logo.position.set(0, postH - 0.05 + (h + 0.1) / 2, 0.035);
    g.add(logo);
    return g;
  }

  // Permukaan bola melengkung turun menjauhi pusat bangunan; dipakai agar properti menapak tanah
  const groundY = (x, z) => -(x * x + z * z) / (2 * R) + 0.02;

  function buildHouse() {
    const g = new THREE.Group();
    const wall = "#f1e2c2";
    g.userData.props = [];
    g.add(box(2.7, 0.44, 2.3, "#b9a98d", 0, -0.22, 0));
    g.add(box(2.4, 1.25, 2.0, wall, 0, 0.22, 0));
    const roof = gableRoof(2.4, 2.0, 0.95, "#d9622b", wall);
    roof.position.y = 1.47;
    g.add(roof);
    g.add(box(0.32, 0.8, 0.32, "#a0522d", 0.7, 1.75, -0.35));
    g.add(box(0.46, 0.82, 0.06, "#7a4a22", 0, 0.22, 1.01));
    g.add(box(0.06, 0.06, 0.04, "#e9d48a", 0.14, 0.62, 1.05));
    for (const x of [-0.75, 0.75]) {
      g.add(box(0.5, 0.48, 0.06, "#fffaf0", x, 0.62, 1.0));
      g.add(box(0.4, 0.38, 0.07, "#9fd3e8", x, 0.67, 1.0));
      g.add(box(0.56, 0.08, 0.16, "#d9622b", x, 0.56, 1.04));
    }
    g.add(box(0.8, 0.32, 0.4, "#b9a98d", 0, -0.1, 1.25));
    // papan foto
    const easel = new THREE.Group();
    easel.add(box(0.08, 1.0, 0.08, "#7a4a22", 0, 0, 0));
    easel.add(box(0.72, 0.8, 0.06, "#8a5a33", 0, 0.75, 0));
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.68), new THREE.MeshStandardMaterial({ map: texPhoto, roughness: 0.9 }));
    photo.position.set(0, 1.15, 0.035);
    easel.add(photo);
    easel.position.set(1.75, groundY(1.75, 1.05), 1.05);
    easel.rotation.y = -0.35;
    g.add(easel);
    g.userData.props.push([1.75, 1.05, 0.22]);
    // pagar
    for (let i = 0; i < 5; i++) g.add(box(0.08, 0.72, 0.08, "#fffaf0", -1.9 + i * 0.3, -0.22, -1.2));
    g.add(box(1.3, 0.06, 0.05, "#fffaf0", -1.3, 0.38, -1.2));
    // pot bunga
    for (const x of [-0.45, 0.45]) {
      g.add(box(0.22, 0.2, 0.22, "#a0522d", x, 0.22, 1.22));
      const fl = mesh(new THREE.IcosahedronGeometry(0.15, 0), "#e8607a", x, 0.52, 1.22);
      g.add(fl);
    }
    return g;
  }

  function buildWorkshop() {
    const g = new THREE.Group();
    const wood = "#b07a45";
    const teal = "#5f9e8f";
    g.userData.props = [];
    g.add(box(2.7, 0.38, 2.1, wood, 0, -0.22, 0));
    g.add(box(2.7, 1.6, 0.16, teal, 0, 0.16, -0.97));
    g.add(box(0.16, 1.6, 1.0, teal, -1.27, 0.16, -0.5));
    g.add(box(0.16, 1.6, 1.0, teal, 1.27, 0.16, -0.5));
    const roof = box(3.0, 0.12, 2.5, "#3f7d6b", 0, 0, 0);
    roof.position.set(0, 1.73, -0.15);
    roof.rotation.x = 0.078;
    g.add(roof);
    for (const x of [-1.27, 1.27]) g.add(box(0.12, 1.45, 0.12, wood, x, 0.16, 0.95));
    // meja + laptop
    g.add(box(1.3, 0.08, 0.6, "#8a5a33", -0.4, 0.78, -0.5));
    for (const [x, z] of [[-0.95, -0.7], [0.15, -0.7], [-0.95, -0.3], [0.15, -0.3]]) g.add(box(0.07, 0.62, 0.07, "#7a4a22", x, 0.16, z));
    g.add(box(0.5, 0.03, 0.34, "#c8c8c8", -0.4, 0.86, -0.45));
    const scr = box(0.5, 0.34, 0.03, "#c8c8c8", -0.4, 0.88, -0.62);
    scr.rotation.x = -0.25;
    g.add(scr);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), new THREE.MeshBasicMaterial({ color: "#a8e0ff" }));
    glow.position.set(-0.4, 1.06, -0.595);
    glow.rotation.x = -0.25;
    g.add(glow);
    // palet & kanvas lukis
    const easel = new THREE.Group();
    const leg = (x, rz) => {
      const l = box(0.06, 1.3, 0.06, wood, x, 0, 0);
      l.rotation.z = rz;
      return l;
    };
    easel.add(leg(-0.25, -0.12), leg(0.25, 0.12));
    const art = document.createElement("canvas");
    art.width = art.height = 128;
    const actx = art.getContext("2d");
    actx.fillStyle = "#fffaf0";
    actx.fillRect(0, 0, 128, 128);
    ["#d9622b", "#e9d48a", "#59b9cf", "#4c8f3a", "#e8607a"].forEach((c, i) => {
      actx.fillStyle = c;
      actx.beginPath();
      actx.arc(20 + ((i * 37) % 100), 25 + ((i * 53) % 90), 16 + (i % 3) * 6, 0, Math.PI * 2);
      actx.fill();
    });
    const artTex = new THREE.CanvasTexture(art);
    artTex.colorSpace = THREE.SRGBColorSpace;
    const canvasArt = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.6), new THREE.MeshStandardMaterial({ map: artTex }));
    canvasArt.position.set(0, 0.95, 0.06);
    easel.add(canvasArt);
    easel.position.set(0.75, 0.16, -0.3);
    easel.rotation.y = -0.4;
    g.add(easel);
    // kamera film di tripod
    const cam = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const l = cyl(0.03, 0.03, 1.2, 5, "#3a3a3a", 0, 0, 0);
      l.position.set(Math.sin((i * Math.PI * 2) / 3) * 0.22, 0.55, Math.cos((i * Math.PI * 2) / 3) * 0.22);
      l.rotation.set(Math.cos((i * Math.PI * 2) / 3) * 0.33, 0, -Math.sin((i * Math.PI * 2) / 3) * 0.33);
      cam.add(l);
    }
    cam.add(box(0.55, 0.38, 0.3, "#2b2b2b", 0, 1.12, 0));
    const lens = cyl(0.1, 0.13, 0.3, 8, "#1b1b1b", 0, 0, 0);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.3, 0.28);
    cam.add(lens);
    const reels = [];
    for (const z of [-0.12, 0.2]) {
      const reel = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), "#4a4a4a");
      reel.rotation.z = Math.PI / 2;
      reel.position.set(0, 1.68, z);
      reel.userData.dynamic = true;
      cam.add(reel);
      reels.push(reel);
    }
    cam.position.set(1.85, groundY(1.85, 0.9), 0.9);
    g.userData.props.push([1.85, 0.9, 0.3]);
    cam.rotation.y = -0.5;
    g.add(cam);
    animated.push((t) => reels.forEach((r) => (r.rotation.x = t * 1.6)));
    // kotak-kotak peralatan
    const gy = groundY(-1.75, 0.7);
    g.add(box(0.4, 0.3, 0.3, "#d9622b", -1.75, gy, 0.7));
    g.add(box(0.3, 0.25, 0.3, "#e9d48a", -1.7, gy + 0.3, 0.72));
    g.userData.props.push([-1.72, 0.7, 0.24]);
    return g;
  }

  function buildCinema() {
    const g = new THREE.Group();
    const red = "#c94f3d";
    g.userData.props = [];
    g.add(box(3.1, 0.42, 2.4, "#b9a98d", 0, -0.24, 0));
    g.add(box(2.9, 1.9, 2.1, red, 0, 0.18, -0.05));
    g.add(box(3.0, 0.18, 2.2, "#f1e2c2", 0, 2.08, -0.05));
    // pintu ganda
    g.add(box(0.9, 1.0, 0.06, "#3a2a22", 0, 0.18, 1.02));
    g.add(box(0.04, 1.0, 0.07, "#e9d48a", 0, 0.18, 1.03));
    // marquee + lampu
    const marquee = box(3.1, 0.14, 0.75, "#f7dcaa", 0, 1.42, 1.2);
    g.add(marquee);
    const ns = textPlane("NOW SHOWING", 2.2, 0.3, { bg: "#2b2b2b", fg: "#f7dcaa", border: "#e9d48a", h: 70, size: 46 });
    ns.position.set(0, 1.75, 1.04);
    g.add(ns);
    const bulbs = [];
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.05, 0),
        new THREE.MeshStandardMaterial({ color: "#ffe9a8", emissive: "#ffcc4d", emissiveIntensity: 1 }),
      );
      b.position.set(-1.45 + i * 0.264, 1.48, 1.58);
      g.add(b);
      bulbs.push(b);
    }
    animated.push((t) =>
      bulbs.forEach((b, i) => (b.material.emissiveIntensity = (Math.floor(t * 3) + i) % 3 === 0 ? 0.15 : 1.4)),
    );
    // layar besar di atap: cuplikan film
    g.add(box(0.12, 0.6, 0.12, "#3a3a3a", -0.6, 2.26, -0.3));
    g.add(box(0.12, 0.6, 0.12, "#3a3a3a", 0.6, 2.26, -0.3));
    g.add(box(1.74, 1.04, 0.12, "#2b2b2b", 0, 2.7, -0.3));
    const film = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: texFilm }));
    film.position.set(0, 3.22, -0.235);
    g.add(film);
    // kios monitor: situs web pertama
    const kiosk = new THREE.Group();
    kiosk.add(box(0.12, 0.9, 0.12, "#3a3a3a", 0, 0, 0));
    kiosk.add(box(1.1, 0.58, 0.1, "#2b2b2b", 0, 0.85, 0));
    const web = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.48), new THREE.MeshBasicMaterial({ map: texWeb }));
    web.position.set(0, 1.14, 0.055);
    kiosk.add(web);
    kiosk.add(box(0.5, 0.06, 0.35, "#3a3a3a", 0, 0, 0));
    kiosk.position.set(-2.05, groundY(-2.05, 0.9), 0.9);
    kiosk.rotation.y = 0.45;
    g.add(kiosk);
    g.userData.props.push([-2.05, 0.9, 0.3]);
    // poster samping
    const poster = textPlane(["SIMPANG", "KISAH"], 0.6, 0.72, { w: 256, h: 300, bg: "#1f4a36", fg: "#f7dcaa", border: "#e9d48a", size: 64 });
    poster.position.set(1.0, 0.76, 1.01);
    g.add(poster);
    // popcorn!
    const pop = new THREE.Group();
    pop.add(cyl(0.16, 0.12, 0.34, 8, "#e04a3a", 0, 0, 0));
    for (let i = 0; i < 6; i++) pop.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), "#fff6dc", Math.sin(i) * 0.08, 0.38 + (i % 2) * 0.05, Math.cos(i * 2) * 0.08));
    pop.position.set(1.75, groundY(1.75, 1.25), 1.25);
    g.add(pop);
    g.userData.props.push([1.75, 1.25, 0.2]);
    return g;
  }

  // Observatorium IZZA: kubah + teleskop, ponsel raksasa pemutar video promo, patung maskot Zet
  let izzaScreen = null;
  function buildObservatory() {
    const g = new THREE.Group();
    g.userData.props = [];
    const cream = "#ece6da";
    const white = "#f6f3ec";
    const orange = "#e8702f";
    const dark = "#1d1a20";
    g.add(box(3.0, 0.42, 2.7, "#b9a98d", 0, -0.22, 0));
    g.add(cyl(1.15, 1.2, 1.2, 14, cream, 0, 0.2, -0.15));
    g.add(cyl(1.21, 1.21, 0.16, 14, orange, 0, 1.3, -0.15));
    // kubah putih dengan celah gelap menghadap depan
    g.add(mesh(new THREE.SphereGeometry(1.12, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 1.46, -0.15));
    g.add(mesh(new THREE.SphereGeometry(1.135, 3, 7, Math.PI / 2 - 0.16, 0.32, 0, Math.PI / 2), dark, 0, 1.46, -0.15));
    const scope = cyl(0.13, 0.17, 1.15, 8, "#3a3540");
    scope.position.set(0, 1.95, 0.25);
    scope.rotation.x = 0.85;
    g.add(scope);
    // pintu & jendela bulat
    g.add(box(0.62, 0.95, 0.06, white, 0, 0.2, 1.03));
    g.add(box(0.5, 0.86, 0.08, orange, 0, 0.2, 1.05));
    g.add(box(0.06, 0.06, 0.04, "#fff3dc", 0.14, 0.62, 1.1));
    for (const x of [-0.72, 0.72]) {
      const win = cyl(0.17, 0.17, 0.06, 10, "#2c3a5c");
      win.rotation.x = Math.PI / 2;
      win.position.set(x, 0.85, 0.82);
      win.rotation.y = Math.atan2(x, 0.97);
      g.add(win);
    }
    // antena parabola di belakang
    const dish = new THREE.Group();
    dish.add(box(0.1, 0.9, 0.1, "#8a8a92", 0, 0, 0));
    const bowl = mesh(new THREE.SphereGeometry(0.42, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2.6), "#d7d7dd");
    bowl.rotation.x = Math.PI + 0.6;
    bowl.position.set(0, 1.05, 0);
    dish.add(bowl);
    dish.position.set(1.45, groundY(1.45, -1.0), -1.0);
    dish.rotation.y = 0.6;
    g.add(dish);
    g.userData.props.push([1.45, -1.0, 0.3]);
    // lampu suar berkedip di puncak kubah
    const beacon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.08, 0),
      new THREE.MeshStandardMaterial({ color: "#ffb07a", emissive: "#ff7a2f", emissiveIntensity: 1.5 }),
    );
    beacon.position.set(0, 2.62, -0.15);
    g.add(beacon);
    g.add(box(0.04, 0.1, 0.04, "#8a8a92", 0, 2.52, -0.15));
    animated.push((t) => (beacon.material.emissiveIntensity = Math.sin(t * 3) > 0.3 ? 1.8 : 0.2));

    // ponsel raksasa: layar menampilkan video promo saat pemain mendekat
    const phone = new THREE.Group();
    phone.add(box(0.5, 0.08, 0.36, "#2a2530", 0, 0, 0));
    phone.add(box(0.1, 0.5, 0.1, "#2a2530", 0, 0.05, 0));
    phone.add(box(1.22, 2.18, 0.14, "#141015", 0, 0.5, 0));
    phone.add(box(0.26, 0.05, 0.02, "#2a2530", 0, 2.55, 0.075));
    izzaScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 1.92),
      new THREE.MeshBasicMaterial({ map: texIzzaScreen, toneMapped: false }),
    );
    izzaScreen.position.set(0, 1.59, 0.073);
    phone.add(izzaScreen);
    phone.position.set(-2.05, groundY(-2.05, 0.45), 0.45);
    phone.rotation.y = 0.42;
    g.add(phone);
    g.userData.props.push([-2.05, 0.45, 0.35]);

    // patung Zet (huruf Z yang terlipat)
    const zet = new THREE.Group();
    zet.add(cyl(0.42, 0.48, 0.25, 10, "#cbbfa8"));
    const body = new THREE.Group();
    body.userData.dynamic = true;
    body.add(box(0.72, 0.32, 0.5, cream, 0.05, 0.25, 0));
    const torso = box(0.46, 0.62, 0.44, "#e2d9c7", 0, 0, 0);
    torso.position.set(-0.08, 0.86, 0);
    torso.rotation.z = 0.32;
    body.add(torso);
    body.add(box(0.1, 0.1, 0.02, orange, 0.02, 0.86, 0.23));
    const arm = box(0.28, 0.14, 0.16, "#e2d9c7", 0, 0, 0);
    arm.position.set(0.22, 0.62, 0.18);
    arm.rotation.z = -0.4;
    body.add(arm);
    const head = new THREE.Group();
    head.position.set(0.02, 1.38, 0);
    head.add(box(0.8, 0.46, 0.52, "#f1ebde", 0, -0.23, 0));
    head.add(box(0.07, 0.15, 0.02, "#141015", 0.06, -0.24, 0.265));
    head.add(box(0.07, 0.15, 0.02, "#141015", 0.24, -0.24, 0.265));
    body.add(head);
    zet.add(body);
    zet.position.set(1.85, groundY(1.85, 0.85), 0.85);
    zet.rotation.y = -0.5;
    g.add(zet);
    g.userData.props.push([1.85, 0.85, 0.42]);
    animated.push((t) => {
      head.rotation.z = Math.sin(t * 1.6) * 0.08;
      head.position.y = 1.38 + Math.abs(Math.sin(t * 1.6)) * 0.03;
      arm.rotation.z = -0.4 + Math.sin(t * 3.2) * 0.25;
    });
    return g;
  }

  // Video promo IZZA di layar ponsel raksasa: baru dimuat saat pemain mendekat
  let izzaVideo = null;
  let izzaVideoTex = null;
  function setIzzaVideo(on) {
    if (!izzaScreen || REDUCED) return;
    if (on && !izzaVideo) {
      izzaVideo = document.createElement("video");
      const mp4 = izzaVideo.canPlayType('video/mp4; codecs="avc1.640028"');
      const src = mp4 ? "assets/izza/izza-promo-1.mp4" : "assets/izza/izza-promo-1.webm";
      Object.assign(izzaVideo, { src, muted: true, loop: true, playsInline: true });
      izzaVideo.setAttribute("muted", "");
      izzaVideo.setAttribute("playsinline", "");
      izzaVideoTex = new THREE.VideoTexture(izzaVideo);
      izzaVideoTex.colorSpace = THREE.SRGBColorSpace;
      izzaVideo.addEventListener("playing", () => {
        izzaScreen.material.map = izzaVideoTex;
        izzaScreen.material.needsUpdate = true;
      });
    }
    if (!izzaVideo) return;
    if (on && izzaVideo.paused) izzaVideo.play().catch(() => {});
    else if (!on && !izzaVideo.paused) izzaVideo.pause();
  }

  function buildPostOffice() {
    const g = new THREE.Group();
    const wall = "#e8eef2";
    g.userData.props = [];
    g.add(box(2.6, 0.42, 2.2, "#b9a98d", 0, -0.22, 0));
    g.add(box(2.3, 1.25, 1.9, wall, 0, 0.2, 0));
    g.add(box(2.32, 0.35, 1.92, "#3b6ea5", 0, 0.2, 0));
    const roof = gableRoof(2.3, 1.9, 0.85, "#8a5a3b", wall);
    roof.position.y = 1.45;
    g.add(roof);
    g.add(box(0.58, 0.86, 0.05, "#fffaf0", -0.45, 0.2, 0.955));
    g.add(box(0.5, 0.8, 0.06, "#24466e", -0.45, 0.2, 0.97));
    g.add(box(0.55, 0.42, 0.06, "#9fd3e8", 0.5, 0.65, 0.96));
    // papan "POS" ditempel rata di bidang atap depan
    const sign = textPlane("✉ POS", 1.0, 0.3, { bg: "#e3742f", fg: "#fffaf0", border: "#fffaf0", h: 154, size: 84 });
    {
      const { ang, run, th, h } = roof.userData.slope;
      const n = new THREE.Vector3(0, Math.cos(ang), Math.sin(ang));
      const c = new THREE.Vector3(0, h - (run * Math.tan(ang)) / 2 + th / 2 / Math.cos(ang), run / 2);
      sign.position.copy(c).addScaledVector(n, th / 2 + 0.012);
      sign.position.y += roof.position.y;
      sign.rotation.x = -(Math.PI / 2 - ang);
    }
    g.add(sign);
    // kotak surat besar
    const mb = new THREE.Group();
    mb.add(box(0.12, 0.6, 0.12, "#3a3a3a", 0, 0, 0));
    mb.add(box(0.55, 0.6, 0.45, "#e3742f", 0, 0.6, 0));
    const top = mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.45, 10, 1, false, Math.PI / 2, Math.PI), "#e3742f");
    top.rotation.x = Math.PI / 2;
    top.position.set(0, 1.2, 0);
    mb.add(top);
    mb.add(box(0.3, 0.05, 0.02, "#2b2b2b", 0, 1.0, 0.235));
    const flag = new THREE.Group();
    flag.userData.dynamic = true;
    flag.add(box(0.04, 0.4, 0.04, "#c0392b", 0, 0, 0));
    flag.add(box(0.04, 0.14, 0.18, "#c0392b", 0, 0.26, 0.08));
    flag.position.set(0.3, 0.85, 0);
    mb.add(flag);
    mb.position.set(1.55, groundY(1.55, 1.05), 1.05);
    g.add(mb);
    g.userData.props.push([1.55, 1.05, 0.3]);
    animated.push((t) => (flag.rotation.x = -0.6 + Math.sin(t * 2) * 0.25));
    // pesawat kertas berputar
    const pg = new THREE.BufferGeometry();
    pg.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0.3, -0.2, 0, -0.2, 0, 0.02, -0.15, 0, 0, 0.3, 0, 0.02, -0.15, 0.2, 0, -0.2, 0, 0, 0.3, 0, -0.08, -0.15, 0, 0.02, -0.15], 3),
    );
    pg.computeVertexNormals();
    const plane = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: "#fffaf0", side: THREE.DoubleSide, flatShading: true }));
    plane.castShadow = true;
    const orbit = new THREE.Group();
    orbit.userData.dynamic = true;
    orbit.add(plane);
    plane.position.set(1.6, 0, 0);
    orbit.position.y = 2.6;
    g.add(orbit);
    animated.push((t) => {
      orbit.rotation.y = t * 0.9;
      plane.position.y = Math.sin(t * 2.2) * 0.2;
      plane.rotation.z = 0.35;
    });
    // tumpukan paket
    const py = groundY(-1.55, 0.9);
    g.add(box(0.4, 0.3, 0.35, "#c4935c", -1.55, py, 0.9));
    g.add(box(0.3, 0.22, 0.3, "#d6aa6e", -1.5, py + 0.3, 0.9));
    g.userData.props.push([-1.52, 0.9, 0.24]);
    return g;
  }

  // Gabungkan semua bagian statis (tanpa tekstur/animasi) dalam satu grup menjadi satu mesh
  // berwarna per-vertex: ratusan draw call jadi beberapa saja, jauh lebih ringan di HP.
  const _inv = new THREE.Matrix4();
  const _rel = new THREE.Matrix4();
  const mergedMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  function mergeStatic(group) {
    group.updateMatrixWorld(true);
    _inv.copy(group.matrixWorld).invert();
    const parts = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p && p !== group; p = p.parent) if (p.userData.dynamic) return;
      const m = o.material;
      if (!m.isMeshStandardMaterial || m.map || m.transparent || m.side !== THREE.FrontSide) return;
      if (m.emissive && m.emissive.getHex() !== 0) return;
      parts.push(o);
    });
    if (parts.length < 2) return;
    const geos = parts.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld));
      return { g, color: o.material.color };
    });
    const total = geos.reduce((n, { g }) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let off = 0;
    for (const { g, color } of geos) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      for (let i = 0; i < n; i++) {
        col[(off + i) * 3] = color.r;
        col[(off + i) * 3 + 1] = color.g;
        col[(off + i) * 3 + 2] = color.b;
      }
      off += n;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mm = new THREE.Mesh(merged, mergedMat);
    mm.castShadow = true;
    mm.receiveShadow = true;
    mm.userData.station = group.userData.station;
    for (const o of parts) {
      o.parent.remove(o);
      o.geometry.dispose();
    }
    group.add(mm);
  }

  // Bangunan yang menghalangi pandangan ke karakter dibuat transparan sementara
  const fadeables = [];
  function makeFadeable(group) {
    const mats = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      mats.push(o.material);
    });
    group.userData.fade = { mats, cur: 1, target: 1 };
    fadeables.push(group);
  }

  const builders = {
    about: buildHouse,
    skills: buildWorkshop,
    work: buildCinema,
    izza: buildObservatory,
    contact: buildPostOffice,
  };
  for (const s of STATIONS) {
    const g = builders[s.id]();
    g.traverse((o) => (o.userData.station = s.id));
    placeOnSurface(g, s.dir, s.forward, -0.02);
    s.group = g;
    pickables.push(g);
    mergeStatic(g);
    makeFadeable(g);
    colliders.push({ dir: s.dir, r: s.radius });
    g.updateMatrixWorld(true);
    for (const [x, z, r] of g.userData.props || []) {
      colliders.push({ dir: g.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r: r / R });
    }
    // papan nama di depan bangunan
    const sb = s.id === "izza" ? logoBoard() : signBoard(s.label.toUpperCase(), 1.2, 0.36, 0.75);
    const side = new THREE.Vector3().crossVectors(s.dir, s.forward).normalize();
    const sd = moveAlong(moveAlong(s.dir, s.forward, 0.165), side, 0.085);
    sb.traverse((o) => (o.userData.station = s.id));
    placeOnSurface(sb, sd, s.forward, -0.02);
    mergeStatic(sb);
    pickables.push(sb);
    s.signDir = sd;
    colliders.push({ dir: sd, r: 0.03 });
  }

  // Tiang penunjuk arah di alun-alun
  let signpost = null;
  {
    const post = new THREE.Group();
    post.add(cyl(0.07, 0.08, 2.65, 6, "#7a4a22"));
    post.add(mesh(new THREE.IcosahedronGeometry(0.1, 0), "#e9d48a", 0, 2.7, 0));
    STATIONS.forEach((s, i) => {
      const t = tangentToward(POLE, s.dir);
      const arm = new THREE.Group();
      arm.rotation.y = Math.atan2(-t.z, t.x);
      const y = 2.55 - i * 0.22;
      const board = new THREE.Group();
      board.add(box(0.95, 0.24, 0.05, "#8a5a33", 0.5, -0.12, 0));
      const tipShape = new THREE.Shape();
      tipShape.moveTo(0, -0.12);
      tipShape.lineTo(0.18, 0);
      tipShape.lineTo(0, 0.12);
      const tip = mesh(new THREE.ExtrudeGeometry(tipShape, { depth: 0.05, bevelEnabled: false }), "#8a5a33");
      tip.position.set(0.975, 0, -0.025);
      board.add(tip);
      const label = textPlane(s.label, 0.88, 0.2, { w: 352, h: 80, size: 50, border: null, bg: "#f5e9d0" });
      label.position.set(0.5, 0, 0.03);
      board.add(label);
      const label2 = label.clone();
      label2.rotation.y = Math.PI;
      label2.position.z = -0.03;
      board.add(label2);
      board.position.y = y;
      arm.add(board);
      post.add(arm);
    });
    placeOnSurface(post, POLE, new THREE.Vector3(0, 0, 1), -0.05);
    colliders.push({ dir: POLE, r: 0.02 });
    mergeStatic(post);
    makeFadeable(post);
    signpost = post;
  }

  // Api unggun rahasia di balik planet
  let campLight;
  {
    const camp = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      camp.add(mesh(new THREE.DodecahedronGeometry(0.15, 0), "#8b8c84", Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55));
    }
    for (const r of [0.5, -0.5]) {
      const log = cyl(0.08, 0.08, 0.9, 6, "#6b4423");
      log.rotation.set(Math.PI / 2, 0, r);
      log.position.set(0, 0.1, 0);
      camp.add(log);
    }
    const flames = [];
    [["#ff8c2b", 0.32, 0.8], ["#ffd34d", 0.2, 0.55]].forEach(([c, r, h]) => {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(r, h, 6),
        new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2, flatShading: true }),
      );
      f.position.y = 0.15 + h / 2;
      camp.add(f);
      flames.push(f);
    });
    campLight = new THREE.PointLight("#ffa040", 6, 6, 1.6);
    campLight.position.y = 0.8;
    camp.add(campLight);
    for (const z of [-1.1, 1.1]) {
      const bench = cyl(0.14, 0.14, 1.0, 6, "#7a4a22");
      bench.rotation.set(0, 0, Math.PI / 2);
      bench.position.set(0.5, 0.14, z);
      camp.add(bench);
    }
    placeOnSurface(camp, CAMP.dir, tangentToward(CAMP.dir, POLE), -0.03);
    mergeStatic(camp);
    colliders.push({ dir: CAMP.dir, r: 0.05 });
    camp.updateMatrixWorld(true);
    for (const [x, z] of [[0.25, -1.1], [0.75, -1.1], [0.25, 1.1], [0.75, 1.1]]) {
      colliders.push({ dir: camp.localToWorld(new THREE.Vector3(x, 0, z)).normalize(), r: 0.2 / R });
    }
    animated.push((t) => {
      flames.forEach((f, i) => {
        f.scale.set(1 + Math.sin(t * 9 + i) * 0.08, 1 + Math.sin(t * 13 + i * 2) * 0.15, 1 + Math.cos(t * 8 + i) * 0.08);
        f.rotation.y = t * (i ? -2 : 1.5);
      });
      campLight.intensity = 5 + Math.sin(t * 11) * 1.2;
    });
  }

  /* ===================== VEGETASI (instanced) ===================== */
  const randomDir = () => {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
  };
  function blocked(d, margin = 0) {
    if (angleBetween(d, POLE) < 0.2 + margin) return true;
    if (angleBetween(d, SPAWN) < 0.08) return true;
    for (const s of STATIONS) {
      if (angleBetween(d, s.dir) < 0.27 + margin) return true;
      if (angleBetween(d, s.front) < 0.14 + margin) return true;
      if (angleBetween(d, s.signDir) < 0.16 + margin) return true;
    }
    if (angleBetween(d, POND.dir) < POND.r + 0.06 + margin) return true;
    if (angleBetween(d, CAMP.dir) < 0.17 + margin) return true;
    if (pathDist(d, 0.3) < PATH_W + 0.035 + margin) return true;
    return false;
  }

  const trees = [];
  for (let tries = 0; tries < 9000 && trees.length < 260; tries++) {
    const d = randomDir();
    if (blocked(d)) continue;
    // lebih rapat di sisi bawah/belakang, lebih jarang dekat alun-alun
    const ap = angleBetween(d, POLE);
    if (ap < 0.9 && rand() < 0.55) continue;
    if (trees.some((t) => angleBetween(t.dir, d) < 0.07)) continue;
    trees.push({ dir: d, s: 0.75 + rand() * 0.6, yaw: rand() * Math.PI * 2, pine: rand() < 0.62 });
  }

  const dummy = new THREE.Object3D();
  function instanced(geo, color, list, setup, { shadow = true, colors } = {}) {
    const im = new THREE.InstancedMesh(geo, mat(color), list.length);
    list.forEach((item, i) => {
      setup(item, dummy);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (colors) im.setColorAt(i, new THREE.Color(colors[i % colors.length]).offsetHSL(0, 0, (rand() - 0.5) * 0.06));
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return im;
  }
  const placeDummy = (item, o, lift = -0.06) => {
    o.position.copy(item.dir).multiplyScalar(surfaceRadius(item.dir) + lift);
    frameQuat(item.dir, anyTangent(item.dir).applyAxisAngle(item.dir, item.yaw || 0), o.quaternion);
    o.scale.setScalar(item.s || 1);
  };

  const pines = trees.filter((t) => t.pine);
  const rounds = trees.filter((t) => !t.pine);
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.13, 0.7, 5).translate(0, 0.35, 0);
  instanced(trunkGeo, "#7a5230", trees, placeDummy);
  const pineGeoA = new THREE.ConeGeometry(0.62, 1.05, 6).translate(0, 1.05, 0);
  const pineGeoB = new THREE.ConeGeometry(0.46, 0.85, 6).translate(0, 1.6, 0);
  const pineColors = ["#2f6b3a", "#3c7d3f", "#285c34", "#356f3b"];
  instanced(pineGeoA, "#ffffff", pines, placeDummy, { colors: pineColors });
  instanced(pineGeoB, "#ffffff", pines, placeDummy, { colors: pineColors });
  const roundGeoA = new THREE.IcosahedronGeometry(0.6, 0).translate(0, 1.1, 0);
  const roundGeoB = new THREE.IcosahedronGeometry(0.42, 0).translate(0.25, 1.55, 0.1);
  const roundColors = ["#4f8f3a", "#5c9a3c", "#467f35"];
  instanced(roundGeoA, "#ffffff", rounds, placeDummy, { colors: roundColors });
  instanced(roundGeoB, "#ffffff", rounds, placeDummy, { colors: roundColors });
  trees.forEach((t) => colliders.push({ dir: t.dir, r: (0.22 * t.s) / R }));

  // batu
  const rocks = [];
  for (let tries = 0; tries < 3000 && rocks.length < 46; tries++) {
    const d = randomDir();
    if (blocked(d, -0.02)) continue;
    if (trees.some((t) => angleBetween(t.dir, d) < 0.05)) continue;
    rocks.push({ dir: d, s: 0.5 + rand() * 1.2, yaw: rand() * 6 });
  }
  instanced(new THREE.DodecahedronGeometry(0.32, 0).scale(1, 0.7, 1.1), "#ffffff", rocks, (it, o) => placeDummy(it, o, 0), {
    colors: ["#9a9a92", "#8b8c84", "#a7a59a"],
  });
  rocks.forEach((r) => r.s > 1.1 && colliders.push({ dir: r.dir, r: (0.3 * r.s) / R }));

  // semak
  const bushes = [];
  for (let tries = 0; tries < 3000 && bushes.length < 70; tries++) {
    const d = randomDir();
    if (blocked(d, -0.03)) continue;
    bushes.push({ dir: d, s: 0.6 + rand() * 0.6, yaw: rand() * 6 });
  }
  instanced(new THREE.IcosahedronGeometry(0.35, 0).scale(1, 0.75, 1).translate(0, 0.2, 0), "#ffffff", bushes, placeDummy, {
    colors: ["#5a9a3e", "#4c8a37", "#68a845"],
  });

  // rumput & bunga (tanpa bayangan supaya ringan)
  const tufts = [];
  for (let tries = 0; tries < 5000 && tufts.length < 420; tries++) {
    const d = randomDir();
    if (pathDist(d, 0.1) < PATH_W + 0.01 || angleBetween(d, POND.dir) < POND.r + 0.03) continue;
    if (STATIONS.some((s) => angleBetween(d, s.dir) < 0.13)) continue;
    tufts.push({ dir: d, s: 0.6 + rand() * 0.8, yaw: rand() * 6 });
  }
  instanced(new THREE.ConeGeometry(0.07, 0.4, 3).translate(0, 0.16, 0), "#ffffff", tufts, placeDummy, {
    shadow: false,
    colors: ["#8cc55a", "#7ab84d", "#9fd166"],
  });
  const flowers = [];
  for (let tries = 0; tries < 5000 && flowers.length < 190; tries++) {
    const d = randomDir();
    if (blocked(d, -0.15)) continue;
    if (pathDist(d, 0.1) < PATH_W + 0.01 || angleBetween(d, POND.dir) < POND.r + 0.04) continue;
    if (STATIONS.some((s) => angleBetween(d, s.dir) < 0.17)) continue;
    const near = STATIONS.some((s) => angleBetween(d, s.dir) < 0.5) || angleBetween(d, POLE) < 0.45;
    if (!near && rand() < 0.7) continue;
    flowers.push({ dir: d, s: 0.7 + rand() * 0.6, yaw: rand() * 6 });
  }
  instanced(new THREE.IcosahedronGeometry(0.08, 0).translate(0, 0.14, 0), "#ffffff", flowers, placeDummy, {
    shadow: false,
    colors: ["#f2d04b", "#f07a6a", "#ffffff", "#c58be0", "#f29bc0"],
  });

  /* ===================== AWAN ===================== */
  const clouds = new THREE.Group();
  scene.add(clouds);
  const cloudList = [];
  for (let i = 0; i < 11; i++) {
    const c = new THREE.Group();
    // tiap awan punya material sendiri agar bisa memudar saat dekat kamera
    const cm = new THREE.MeshStandardMaterial({ color: "#fdfcf7", flatShading: true, roughness: 1, transparent: true });
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + rand() * 0.6, 0), cm);
      // gumpalan rapat tanpa sumbu panjang, supaya dari sudut mana pun tidak terlihat seperti tiang
      const ca = k * 2.4;
      const cr = k ? 0.6 : 0;
      p.position.set(Math.cos(ca) * cr, rand() * 0.3, Math.sin(ca) * cr);
      p.scale.set(1.15, 0.7, 1);
      c.add(p);
    }
    c.userData.mat = cm;
    cloudList.push(c);
    const d = randomDir();
    c.position.copy(d).multiplyScalar(R + 6 + rand() * 2.5);
    frameQuat(d, tangentToward(d, POLE), c.quaternion);
    c.scale.setScalar(0.7 + rand() * 0.5);
    clouds.add(c);
  }

  /* ===================== KARAKTER ===================== */
  function buildCharacter() {
    const root = new THREE.Group();
    const bodyG = new THREE.Group();
    root.add(bodyG);
    const skin = "#c98d63";
    const shirt = "#262626";
    const pants = "#3a4252";
    bodyG.add(mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.46, 8), shirt, 0, 0.66, 0));
    bodyG.add(mesh(new THREE.BoxGeometry(0.17, 0.09, 0.03), "#c0392b", 0, 0.7, 0.21));
    const hood = mesh(new THREE.TorusGeometry(0.15, 0.06, 5, 10), shirt, 0, 0.88, -0.02);
    hood.rotation.x = Math.PI / 2;
    bodyG.add(hood);
    const head = new THREE.Group();
    head.position.y = 1.07;
    bodyG.add(head);
    head.add(mesh(new THREE.IcosahedronGeometry(0.21, 1), skin));
    const hair = mesh(new THREE.SphereGeometry(0.225, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.52), "#151515", 0, 0.03, -0.015);
    head.add(hair);
    head.add(mesh(new THREE.BoxGeometry(0.36, 0.2, 0.14), "#151515", 0, -0.04, -0.13));
    head.add(mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), "#111111", 0, 0.01, 0.19));
    const legs = [];
    for (const x of [-0.1, 0.1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.44, 0);
      pivot.add(mesh(new THREE.BoxGeometry(0.13, 0.38, 0.14), pants, 0, -0.19, 0));
      pivot.add(mesh(new THREE.BoxGeometry(0.14, 0.07, 0.21), "#f2f2f2", 0, -0.4, 0.03));
      bodyG.add(pivot);
      legs.push(pivot);
    }
    const arms = [];
    for (const x of [-0.27, 0.27]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.85, 0);
      pivot.rotation.z = x > 0 ? -0.12 : 0.12;
      pivot.add(mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), shirt, 0, -0.19, 0));
      pivot.add(mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), skin, 0, -0.42, 0));
      bodyG.add(pivot);
      arms.push(pivot);
    }
    root.scale.setScalar(1.05);
    return { root, bodyG, legs, arms, head };
  }
  const hero = buildCharacter();
  scene.add(hero.root);

  /* ===================== STATE PEMAIN ===================== */
  const player = {
    dir: SPAWN.clone(),
    pos: new THREE.Vector3(),
    heading: tangentToward(SPAWN, byId.izza.front),
    y: 0,
    vy: 0,
    grounded: true,
    speed: 0,
    walkPhase: 0,
  };
  // Arah awal sengaja tidak lurus ke tiang penunjuk di tengah alun-alun
  const camFwd = tangentToward(SPAWN, byId.izza.front);
  let camPitch = 0.8;
  let zoom = 1;
  const PLAYER_R = 0.28 / R;
  const WALK = 4.2;
  const RUN = 6.6;
  const GRAVITY = 22;

  function resetPlayer() {
    player.dir.copy(SPAWN);
    player.heading.copy(tangentToward(SPAWN, byId.izza.front));
    camFwd.copy(player.heading);
    player.y = 0;
    player.vy = 0;
    player.speed = 0;
    player.grounded = true;
    player.walkPhase = 0;
    jumpQueued = false;
    camPitch = 0.8;
    zoom = 1;
  }

  /* ===================== INPUT ===================== */
  const keys = new Set();
  const joy = { x: 0, y: 0, active: false };
  let jumpQueued = false;

  const KEYMAP = {
    KeyW: "w", ArrowUp: "w", KeyS: "s", ArrowDown: "s", KeyA: "a", ArrowLeft: "a", KeyD: "d", ArrowRight: "d",
  };
  const keyEls = { w: $(".k-w"), a: $(".k-a"), s: $(".k-s"), d: $(".k-d"), space: $(".k-space") };
  const typingTarget = (e) => {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  };

  addEventListener("keydown", (e) => {
    if (!worldReady) return;
    if (e.code === "Escape") {
      if (ui.openId) {
        ui.closePanel();
        e.preventDefault();
      }
      return;
    }
    if (typingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space/Enter pada tombol/tautan yang sedang difokus (pengguna keyboard) tetap berfungsi normal
    if ((e.code === "Space" || e.code === "Enter") && e.target.closest?.("button, a")) return;
    const k = KEYMAP[e.code];
    if (mode === "intro" && (k || e.code === "Space") && !ui.openId) {
      startPlaying();
      e.preventDefault();
      return;
    }
    if (mode !== "play") return;
    const inPanel = e.target.closest && e.target.closest(".panel");
    if (k) {
      if (inPanel && e.code.startsWith("Arrow")) return; // biarkan panel bisa di-scroll
      keys.add(k);
      keyEls[k]?.classList.add("is-down");
      e.preventDefault();
    } else if (e.code === "Space") {
      if (inPanel && e.target.tagName === "BUTTON") return;
      jumpQueued = true;
      keyEls.space?.classList.add("is-down");
      e.preventDefault();
    } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      keys.add("shift");
    } else if ((e.code === "KeyE" || (e.code === "Enter" && !inPanel)) && nearStation) {
      ui.openPanel(nearStation.id, { auto: false });
      e.preventDefault();
    }
  });
  addEventListener("keyup", (e) => {
    const k = KEYMAP[e.code];
    if (k) {
      keys.delete(k);
      keyEls[k]?.classList.remove("is-down");
    }
    if (e.code === "Space") keyEls.space?.classList.remove("is-down");
    if (e.code.startsWith("Shift")) keys.delete("shift");
  });
  function releaseKeys() {
    keys.clear();
    Object.values(keyEls).forEach((el) => el?.classList.remove("is-down"));
  }
  addEventListener("blur", () => {
    releaseKeys();
  });

  // Joystick sentuh
  const joyEl = $("#joystick");
  const stickEl = $("#stick");
  let joyPointer = null;
  const joyMove = (e) => {
    const r = joyEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width * 0.36;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = dx / max;
    joy.y = -dy / max;
  };
  joyEl.addEventListener("pointerdown", (e) => {
    hideTouchHint();
    joyPointer = e.pointerId;
    joyEl.setPointerCapture(e.pointerId);
    joy.active = true;
    joyMove(e);
  });
  joyEl.addEventListener("pointermove", (e) => e.pointerId === joyPointer && joyMove(e));
  const joyEnd = (e) => {
    if (e.pointerId !== joyPointer) return;
    joyPointer = null;
    joy.active = false;
    joy.x = joy.y = 0;
    stickEl.style.transform = "";
  };
  joyEl.addEventListener("pointerup", joyEnd);
  joyEl.addEventListener("pointercancel", joyEnd);
  $("#jump-btn").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    jumpQueued = true;
  });

  // Drag kamera, pinch zoom, klik bangunan
  const pointers = new Map();
  let dragMoved = 0;
  let pinchDist = 0;
  let introSpin = 0;
  let introTilt = 0.95;
  let lastInteract = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  canvas.addEventListener("pointerdown", (e) => {
    if (!worldReady) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    body.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (!IS_TOUCH) hoverCheck(e);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    lastInteract = performance.now();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist) zoom = clamp(zoom * (pinchDist / d), 0.55, 1.8);
      pinchDist = d;
      return;
    }
    if (mode === "play") {
      camFwd.applyAxisAngle(player.dir, -dx * 0.006);
      camPitch = clamp(camPitch + dy * 0.004, 0.25, 1.25);
    } else if (mode === "intro") {
      introSpin -= dx * 0.006;
      introTilt = clamp(introTilt + dy * 0.004, 0.1, 1.45);
    }
  });
  const pointerEnd = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!pointers.size) body.classList.remove("is-dragging");
    if (dragMoved < 6 && e.type === "pointerup") clickPick(e);
  };
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (mode === "play") zoom = clamp(zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.55, 1.8);
    },
    { passive: false },
  );

  function pickAt(e) {
    // label bangunan hanya visual (agar drag kamera tetap jalan); klik dicek di sini
    for (const l of labelItems) {
      if (!l.shown) continue;
      const r = l.el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return l.s.id;
    }
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([planet, ...pickables], true);
    return hits.length && hits[0].object.userData.station ? hits[0].object.userData.station : null;
  }
  function clickPick(e) {
    if (mode === "transition") return;
    const id = pickAt(e);
    if (id) ui.openPanel(id, { auto: false });
  }
  let hoverT = 0;
  function hoverCheck(e) {
    const now = performance.now();
    if (now - hoverT < 90) return;
    hoverT = now;
    canvas.style.cursor = pickAt(e) ? "pointer" : "";
  }

  /* ===================== LABEL HTML ===================== */
  const labelsEl = $("#labels");
  const labelItems = STATIONS.map((s) => {
    const el = document.createElement("div");
    el.className = "place-label";
    el.textContent = s.label;
    labelsEl.appendChild(el);
    const tall = s.id === "work" ? 4.0 : s.id === "izza" ? 3.3 : 3.0;
    const pos = s.dir.clone().multiplyScalar(R + tall);
    return { el, pos, n: pos.clone().normalize(), s, x: -1, y: -1, shown: true };
  });

  // Ukuran elemen HTML yang memengaruhi tata letak 3D (diukur ulang saat resize)
  const layout = { navBottom: 60, introBottom: 260, introRight: innerWidth };
  function measureLayout() {
    layout.navBottom = $(".nav-pills").getBoundingClientRect().bottom;
    let bottom = 0;
    let right = 0;
    for (const el of $("#intro").children) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      bottom = Math.max(bottom, r.bottom);
      right = Math.max(right, r.right);
    }
    layout.introBottom = bottom;
    layout.introRight = right;
  }
  const introBeside = () => layout.introRight < innerWidth * 0.6;

  const _proj = new THREE.Vector3();
  const _camN = new THREE.Vector3();
  function updateLabels() {
    _camN.copy(camera.position).normalize();
    const horizon = R / camera.position.length();
    const minY = (mode === "intro" && !introBeside() ? layout.introBottom : layout.navBottom) + 26;
    for (const l of labelItems) {
      let show = l.n.dot(_camN) > horizon - 0.12 && ui.openId !== l.s.id;
      let x = 0;
      let y = 0;
      if (show) {
        _proj.copy(l.pos).project(camera);
        x = Math.round((_proj.x * 0.5 + 0.5) * innerWidth);
        y = Math.round((-_proj.y * 0.5 + 0.5) * innerHeight);
        show = _proj.z < 1 && x > -40 && x < innerWidth + 40 && y > minY && y < innerHeight + 20;
      }
      if (show !== l.shown) {
        l.el.classList.toggle("is-hidden", !show);
        l.shown = show;
      }
      if (show && (x !== l.x || y !== l.y)) {
        l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        l.x = x;
        l.y = y;
      }
    }
  }

  /* ===================== KAMERA ===================== */
  const camState = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), target: new THREE.Vector3() };

  // Planet intro dimuat di ruang layar yang benar-benar kosong (di bawah atau di samping teks)
  function introFit() {
    const W = innerWidth;
    const H = innerHeight;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    let x0 = 12;
    let x1 = W - 12;
    let y0 = layout.introBottom + 44;
    const y1 = H - 12;
    if (introBeside()) {
      x0 = layout.introRight + 16;
      y0 = layout.navBottom + 64;
    }
    let diam = Math.min(x1 - x0, y1 - y0);
    diam = Math.max(diam, Math.min(W, H) * 0.42); // jangan sampai terlalu kecil
    const cx = (x0 + x1) / 2;
    const cy = Math.min(y1 - diam / 2, Math.max((y0 + y1) / 2, y0 + diam / 2));
    const fit = Math.atan((diam / H) * tanV);
    return {
      D: (R * 1.12) / Math.sin(fit),
      shiftX: Math.atan(((cx - W / 2) / (W / 2)) * tanH),
      shiftY: Math.atan(((cy - H / 2) / (H / 2)) * tanV),
    };
  }
  const _dir = new THREE.Vector3();
  const _su = new THREE.Vector3();
  const _right = new THREE.Vector3();
  function introPose(out) {
    const { D, shiftX, shiftY } = introFit();
    const a = BASE_AZ + Math.PI * 0.78 + introSpin;
    const tilt = introTilt;
    out.pos.set(Math.cos(a) * Math.cos(tilt) * D, Math.sin(tilt) * D, Math.sin(a) * Math.cos(tilt) * D);
    out.up.set(0, 1, 0);
    _dir.copy(out.pos).normalize().negate();
    _su.copy(UP).addScaledVector(_dir, -UP.dot(_dir)).normalize();
    _right.crossVectors(_dir, _su);
    out.up.copy(_su);
    out.target
      .copy(_su)
      .multiplyScalar(D * Math.tan(shiftY))
      .addScaledVector(_right, -D * Math.tan(shiftX));
    return out;
  }
  function followPose(out) {
    const portrait = camera.aspect < 0.8 ? 1.35 : 1;
    const dist = 11.5 * zoom * portrait;
    const up = player.dir;
    out.pos
      .copy(player.pos)
      .addScaledVector(up, Math.sin(camPitch) * dist)
      .addScaledVector(camFwd, -Math.cos(camPitch) * dist);
    // jangan sampai kamera masuk ke tanah
    const minR = surfaceRadius(_dir.copy(out.pos).normalize()) + 1.2;
    if (out.pos.length() < minR) out.pos.setLength(minR);
    out.up.copy(up);
    out.target.copy(player.pos).addScaledVector(up, 0.9);
    return out;
  }
  function applyCam(p) {
    camera.position.copy(p.pos);
    camera.up.copy(p.up);
    camera.lookAt(p.target);
  }

  /* ===================== MODE ===================== */
  let mode = "intro"; // intro | transition | play
  const trans = { t: 0, dur: 1.8, next: "play", queued: null };
  const tmpPose = () => ({ pos: new THREE.Vector3(), up: new THREE.Vector3(), target: new THREE.Vector3() });
  const poseA = tmpPose();
  const poseB = tmpPose();

  function snapshot(out) {
    out.pos.copy(camState.pos);
    out.up.copy(camState.up);
    out.target.copy(camState.target);
    return out;
  }
  const hudEl = $("#hud");
  const promptEl = $("#hud-prompt");
  const promptText = $("#hud-prompt-text");
  const touchHint = $("#touch-hint");
  let hintTimer = 0;
  const hideTouchHint = () => touchHint.classList.add("is-gone");

  function startPlaying() {
    if (!worldReady) return;
    if (mode === "transition") {
      trans.queued = trans.next === "play" ? null : "play";
      return;
    }
    if (mode !== "intro") return;
    mode = "transition";
    trans.t = 0;
    trans.dur = REDUCED ? 0.01 : 1.9;
    trans.next = "play";
    snapshot(poseA);
    body.classList.add("is-playing");
    hudEl.inert = false;
    if (ui.openId && isNarrow()) ui.closePanel();
    if (IS_TOUCH) {
      touchHint.classList.remove("is-gone");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(hideTouchHint, 8000);
    }
  }
  function goHome() {
    if (mode === "transition") {
      trans.queued = trans.next === "intro" ? null : "intro";
      return;
    }
    if (mode !== "play") return;
    mode = "transition";
    trans.t = 0;
    trans.dur = REDUCED ? 0.01 : 1.6;
    trans.next = "intro";
    snapshot(poseA);
    ui.closePanel();
    body.classList.remove("is-playing");
    hudEl.inert = true;
    promptEl.hidden = true;
    releaseKeys();
    player.speed = 0;
    nearStation = null;
    setIzzaVideo(false);
    hideTouchHint();
  }
  // Setelah diklik mouse, lepas fokus supaya Space/Enter berikutnya dipakai untuk bermain
  const blurIfMouse = (e) => e.detail > 0 && e.currentTarget.blur();
  $("#explore-btn").addEventListener("click", (e) => {
    blurIfMouse(e);
    startPlaying();
  });
  $("#home-btn").addEventListener("click", (e) => {
    blurIfMouse(e);
    goHome();
  });

  /* ===================== UI ===================== */
  const ui = initUI({ world: true });
  promptEl.addEventListener("click", (e) => {
    blurIfMouse(e);
    if (nearStation) ui.openPanel(nearStation.id, { auto: false });
  });

  /* ===================== UPDATE ===================== */
  let nearStation = null;
  let campFound = false;
  const moveDir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const _cross = new THREE.Vector3();

  function updatePlayer(dt) {
    const up = player.dir;
    // input relatif kamera
    let ix = 0;
    let iz = 0;
    if (keys.has("w")) iz += 1;
    if (keys.has("s")) iz -= 1;
    if (keys.has("a")) ix -= 1;
    if (keys.has("d")) ix += 1;
    if (joy.active) {
      ix += joy.x;
      iz += joy.y;
    }
    const mag = Math.min(1, Math.hypot(ix, iz));
    right.crossVectors(camFwd, up).normalize();
    moveDir.copy(camFwd).multiplyScalar(iz).addScaledVector(right, ix);
    const targetSpeed = mag > 0.05 ? (keys.has("shift") || mag > 0.95 && joy.active ? RUN : WALK) * mag : 0;
    player.speed = lerp(player.speed, targetSpeed, 1 - Math.exp(-dt * 10));

    if (mag > 0.05) {
      moveDir.normalize();
      // putar badan ke arah gerak (pakai sudut, supaya bisa berbalik 180° tanpa "jalan mundur")
      const k = 1 - Math.exp(-dt * 12);
      const ang = Math.atan2(_cross.crossVectors(player.heading, moveDir).dot(up), player.heading.dot(moveDir));
      player.heading.applyAxisAngle(up, ang * k);
      projectTangent(player.heading, up);
    }
    if (player.speed > 0.01) {
      const stepDir = mag > 0.05 ? moveDir : player.heading;
      let nd = moveAlong(up, stepDir, (player.speed * dt) / R);
      // tabrakan sederhana di ruang sudut
      for (let iter = 0; iter < 2; iter++) {
        for (const c of colliders) {
          const lim = c.r + PLAYER_R;
          const a = angleBetween(nd, c.dir);
          if (a < lim) {
            const away = tangentToward(c.dir, nd);
            // menabrak tepat di tengah: belokkan sedikit supaya bisa menyusur, tidak tersangkut
            if (away.dot(stepDir) < -0.9) {
              // geser menyusur sejauh satu langkah saja (tidak melompat)
              const onRight = _cross.crossVectors(stepDir, up).dot(c.dir) > 0;
              const slide = Math.min(0.6, (player.speed * dt) / R / Math.sin(lim));
              away.applyAxisAngle(c.dir, onRight ? -slide : slide);
            }
            nd = moveAlong(c.dir, away, lim + 1e-4);
          }
        }
      }
      // transport paralel arah kamera & badan
      player.dir.copy(nd);
    }
    projectTangent(camFwd, player.dir);
    projectTangent(player.heading, player.dir);

    // lompat & gravitasi
    if (jumpQueued && player.grounded) {
      player.vy = 7.2;
      player.grounded = false;
    }
    jumpQueued = false;
    player.vy -= GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.grounded = true;
    }
    player.pos.copy(player.dir).multiplyScalar(surfaceRadius(player.dir) + player.y);
  }

  function updateHeroPose(dt, t) {
    hero.root.position.copy(player.pos);
    frameQuat(player.dir, player.heading, hero.root.quaternion);
    const moving = player.speed > 0.2;
    player.walkPhase += dt * (moving ? player.speed * 2.4 : 0);
    const swing = moving ? Math.sin(player.walkPhase) * Math.min(0.9, player.speed * 0.17) : 0;
    const air = !player.grounded;
    hero.legs[0].rotation.x = air ? -0.5 : swing;
    hero.legs[1].rotation.x = air ? 0.3 : -swing;
    hero.arms[0].rotation.x = air ? -2.4 : -swing * 0.9;
    hero.arms[1].rotation.x = air ? -2.4 : swing * 0.9;
    hero.bodyG.position.y = moving && !air ? Math.abs(Math.sin(player.walkPhase)) * 0.06 : Math.sin(t * 2) * 0.012;
    hero.head.rotation.y = moving ? 0 : Math.sin(t * 0.7) * 0.3;
  }

  function updateProximity() {
    let near = null;
    for (const s of STATIONS) if (angleBetween(player.dir, s.front) < 0.11) near = s;
    if (near !== nearStation) {
      nearStation = near;
      if (near) {
        // desktop: panel samping terbuka otomatis; layar sentuh/sempit: tampilkan tombol "Masuk"
        if (!isNarrow() && !IS_TOUCH && (!ui.openId || ui.openAuto)) ui.openPanel(near.id, { auto: true });
        promptText.textContent = `Masuk ${near.name}`;
      } else if (ui.openAuto) {
        ui.closePanel();
      }
    }
    const showPrompt = !!nearStation && ui.openId !== nearStation.id && mode === "play";
    // putar video di ponsel raksasa hanya saat pemain berada di sekitar observatorium
    const dIzza = angleBetween(player.dir, byId.izza.dir);
    if (dIzza < 0.42) setIzzaVideo(true);
    else if (dIzza > 0.55) setIzzaVideo(false);
    if (promptEl.hidden === showPrompt) promptEl.hidden = !showPrompt;
    if (!campFound && angleBetween(player.dir, CAMP.dir) < 0.16) {
      campFound = true;
      ui.toast("🔥 Kamu menemukan api unggun rahasia! Terima kasih sudah menjelajah sejauh ini.");
    }
  }

  const sunDir = new THREE.Vector3();
  const _sunN = new THREE.Vector3();
  const _sunR = new THREE.Vector3();
  function updateSun() {
    // matahari mengikuti kamera supaya sisi yang dilihat selalu terang
    const camN = _sunN.copy(camera.position).normalize();
    const camRight = _sunR.crossVectors(camera.up, camN).normalize();
    sunDir.copy(camN).addScaledVector(camera.up, 0.9).addScaledVector(camRight, -0.6).normalize();
    sun.position.copy(sunDir).multiplyScalar(45);
    sun.target.position.set(0, 0, 0);
  }

  // Bangunan/tiang yang menutupi karakter dibuat tembus pandang
  const occRay = new THREE.Raycaster();
  const _occT = new THREE.Vector3();
  const _occD = new THREE.Vector3();
  const occHits = new Set();
  let occTick = 0;
  function updateOcclusion(dt) {
    if (mode !== "play") {
      occHits.clear();
    } else if (occTick++ % 3 === 0) {
      occHits.clear();
      _occT.copy(player.pos).addScaledVector(player.dir, 0.7);
      _occD.copy(_occT).sub(camera.position);
      const dist = _occD.length();
      occRay.set(camera.position, _occD.divideScalar(dist));
      occRay.far = Math.max(0, dist - 0.6);
      for (const h of occRay.intersectObjects(fadeables, true)) {
        let o = h.object;
        while (o && !o.userData.fade) o = o.parent;
        if (o) occHits.add(o);
      }
      // tiang penunjuk yang melintang dekat kamera juga dipudarkan
      if (signpost && !occHits.has(signpost)) {
        _occT.copy(signpost.position).addScaledVector(POLE, 1.4);
        const t = clamp(_occT.clone().sub(camera.position).dot(_occD), 0, dist);
        const closest = _cw.copy(camera.position).addScaledVector(_occD, t);
        if (t < dist - 1.2 && closest.distanceTo(_occT) < 1.3) occHits.add(signpost);
      }
    }
    for (const g of fadeables) {
      const f = g.userData.fade;
      f.target = occHits.has(g) ? 0.25 : 1;
      if (f.cur === f.target) continue;
      f.cur = lerp(f.cur, f.target, 1 - Math.exp(-dt * 10));
      if (Math.abs(f.cur - f.target) < 0.01) f.cur = f.target;
      const transparent = f.cur < 1;
      for (const m of f.mats) {
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = f.cur;
      }
    }
  }

  // Awan memudar saat terlalu dekat kamera
  const _cw = new THREE.Vector3();
  function updateClouds(dt) {
    clouds.rotation.y += dt * 0.02;
    clouds.rotation.x = Math.sin(elapsed * 0.05) * 0.1;
    const introText = mode !== "play" && !introBeside();
    // saat bermain, awan yang berada di antara kamera dan karakter disembunyikan
    const heroDist = mode === "play" ? camera.position.distanceTo(player.pos) : Infinity;
    for (const c of cloudList) {
      c.getWorldPosition(_cw);
      const d = _cw.distanceTo(camera.position);
      let op = smooth(2.5, 7, d);
      if (heroDist !== Infinity) op = Math.min(op, smooth(heroDist - 1, heroDist + 3, d));
      if (introText) {
        // jangan sampai awan menutupi judul/tombol intro
        _cw.project(camera);
        const sy = (-_cw.y * 0.5 + 0.5) * innerHeight;
        op = Math.min(op, smooth(layout.introBottom, layout.introBottom + 60, sy));
      }
      c.userData.mat.opacity = op;
      c.visible = d > 1.5 && op > 0.01;
    }
  }

  // Saat panel samping terbuka, geser gambar 3D ke kiri supaya karakter tetap di tengah area yang terlihat
  let viewOff = 0;
  function updateViewOffset(dt) {
    const target = ui.openId && !isNarrow() ? ui.openPanelWidth() / 2 : 0;
    if (viewOff === target) return;
    viewOff = lerp(viewOff, target, 1 - Math.exp(-dt * 8));
    if (Math.abs(viewOff - target) < 0.5) viewOff = target;
    if (viewOff > 0.5) camera.setViewOffset(innerWidth, innerHeight, viewOff, 0, innerWidth, innerHeight);
    else camera.clearViewOffset();
    body.style.setProperty("--view-off", `${Math.round(viewOff)}px`);
  }

  const clock = new THREE.Clock();
  let elapsed = 0;
  let firstFrame = true;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    if (mode === "play" || mode === "transition") {
      if (mode === "play") updatePlayer(dt);
      else player.pos.copy(player.dir).multiplyScalar(surfaceRadius(player.dir) + player.y);
    } else {
      player.pos.copy(player.dir).multiplyScalar(surfaceRadius(player.dir));
      if (!REDUCED && performance.now() - lastInteract > 2500 && !pointers.size) introSpin += dt * 0.08;
    }
    updateHeroPose(dt, elapsed);

    if (mode === "intro") {
      introPose(poseB);
      camState.pos.lerp(poseB.pos, firstFrame ? 1 : 1 - Math.exp(-dt * 6));
      camState.up.lerp(poseB.up, 1 - Math.exp(-dt * 6)).normalize();
      camState.target.lerp(poseB.target, firstFrame ? 1 : 1 - Math.exp(-dt * 6));
      if (firstFrame) {
        camState.pos.copy(poseB.pos);
        camState.up.copy(poseB.up);
        camState.target.copy(poseB.target);
      }
    } else if (mode === "transition") {
      trans.t += dt;
      const k = easeInOut(clamp(trans.t / trans.dur, 0, 1));
      if (trans.next === "play") followPose(poseB);
      else introPose(poseB);
      const r = lerp(poseA.pos.length(), poseB.pos.length(), k);
      camState.pos.copy(slerpDir(_dir.copy(poseA.pos).normalize(), _occD.copy(poseB.pos).normalize(), k)).multiplyScalar(r);
      camState.up.copy(poseA.up).lerp(poseB.up, k).normalize();
      camState.target.copy(poseA.target).lerp(poseB.target, k);
      if (trans.t >= trans.dur) {
        mode = trans.next;
        if (mode === "intro") {
          resetPlayer();
          introTilt = 0.95;
        }
        const queued = trans.queued;
        trans.queued = null;
        if (queued === "play") startPlaying();
        else if (queued === "intro") goHome();
      }
    } else {
      followPose(poseB);
      const k = 1 - Math.exp(-dt * 7);
      camState.pos.lerp(poseB.pos, k);
      camState.up.lerp(poseB.up, k).normalize();
      camState.target.lerp(poseB.target, 1 - Math.exp(-dt * 14));
    }
    updateViewOffset(dt);
    applyCam(camState);

    if (mode === "play") updateProximity();
    updateSun();
    updateClouds(dt);
    updateOcclusion(dt);
    for (const fn of animated) fn(elapsed, dt);
    updateLabels();

    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      maybeHideLoader();
    }
    requestAnimationFrame(frame);
  }

  /* ===================== LOADING ===================== */
  let texturesDone = false;
  let loaderHidden = false;
  manager.onProgress = (_url, loaded, total) => {
    loaderText.textContent = `Memuat… ${Math.round((loaded / total) * 100)}%`;
  };
  manager.onLoad = () => {
    texturesDone = true;
    maybeHideLoader();
  };
  manager.onError = () => {
    texturesDone = true;
    maybeHideLoader();
  };
  function maybeHideLoader(force = false) {
    if (loaderHidden || (!force && (!texturesDone || firstFrame))) return;
    loaderHidden = true;
    loaderEl.classList.add("is-done");
    body.classList.remove("is-loading");
  }
  setTimeout(() => maybeHideLoader(true), 6000);

  // gambar ulang papan nama & ukur ulang tata letak setelah font siap
  if (document.fonts?.ready)
    document.fonts.ready.then(() => {
      textRedraws.forEach((d) => d());
      measureLayout();
    });

  /* ===================== RESIZE ===================== */
  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    if (camera.view?.enabled) camera.setViewOffset(innerWidth, innerHeight, viewOff, 0, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
    renderer.setSize(innerWidth, innerHeight);
    measureLayout();
    ui.sync();
  }
  addEventListener("resize", onResize);
  onResize();

  // Debug kecil untuk pengujian otomatis
  window.__world = {
    get mode() { return mode; },
    player,
    stations: STATIONS,
    teleport(id) {
      const s = byId[id];
      if (!s) return;
      player.dir.copy(moveAlong(s.front, s.forward, 0.04));
      player.heading.copy(s.forward).negate();
      projectTangent(player.heading, player.dir);
      camFwd.copy(player.heading);
    },
    renderer,
    camera,
  };

  worldReady = true;
  requestAnimationFrame(frame);
}

/* ===================== UI: panel, menu, efek ketik, form ===================== */
function initUI({ world = false } = {}) {
  if (uiState) return uiState;
  const panels = Object.fromEntries($$(".panel").map((p) => [p.id.replace("panel-", ""), p]));
  const pills = $$(".pill");
  const backdrop = $("#panel-backdrop");
  let returnFocus = null;
  const blurIfMouse = (e) => e.detail > 0 && e.currentTarget.blur();

  const state = {
    openId: null,
    openAuto: false,
    openPanel(id, { auto = false } = {}) {
      const p = panels[id];
      if (!p) return;
      if (state.openId && state.openId !== id) {
        pauseMedia(panels[state.openId]);
        panels[state.openId].hidden = true;
      }
      if (!auto && !state.openId) {
        // kembalikan fokus hanya untuk pengguna keyboard (bukan setelah klik mouse)
        const a = document.activeElement;
        returnFocus = a && a !== document.body && a.matches(":focus-visible") ? a : null;
      }
      p.hidden = false;
      $(".panel-scroll", p).scrollTop = 0;
      state.openId = id;
      state.openAuto = auto;
      state.sync();
      pills.forEach((b) => {
        const on = b.dataset.go === id;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-expanded", String(on));
      });
      if (!auto) {
        p.setAttribute("tabindex", "-1");
        p.focus({ preventScroll: true });
      }
      if (id === "contact") loadEmailJS().catch(() => {});
    },
    closePanel() {
      if (!state.openId) return;
      const p = panels[state.openId];
      const hadFocus = p.contains(document.activeElement);
      pauseMedia(p);
      p.hidden = true;
      state.openId = null;
      state.openAuto = false;
      state.sync();
      pills.forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-expanded", "false");
      });
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
      else if (hadFocus) document.activeElement.blur();
      returnFocus = null;
    },
    // backdrop hanya untuk bottom sheet yang dibuka manual (dihitung ulang saat layar diputar)
    sync() {
      const sheet = !!state.openId && isNarrow() && !state.openAuto;
      backdrop.hidden = !sheet;

    },
    openPanelWidth() {
      return state.openId ? panels[state.openId].offsetWidth + 16 : 0;
    },
    toast(msg) {
      const t = document.createElement("div");
      t.className = "toast paper-chip";
      t.setAttribute("role", "status");
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.classList.add("is-gone"), 4500);
      setTimeout(() => t.remove(), 5200);
    },
  };

  pills.forEach((b) =>
    b.addEventListener("click", (e) => {
      blurIfMouse(e);
      if (state.openId === b.dataset.go) state.closePanel();
      else state.openPanel(b.dataset.go, { auto: false });
    }),
  );
  $$(".panel-close").forEach((b) =>
    b.addEventListener("click", (e) => {
      blurIfMouse(e);
      state.closePanel();
    }),
  );
  backdrop.addEventListener("click", () => state.closePanel());
  // tombol di dalam panel yang membuka panel lain (mis. "Lihat IZZA" di My Work)
  $$("[data-open]").forEach((b) =>
    b.addEventListener("click", (e) => {
      blurIfMouse(e);
      state.openPanel(b.dataset.open, { auto: false });
    }),
  );
  if (IS_TOUCH) document.body.classList.add("is-touch");
  // posisi bawah menu atas (bisa dua baris di HP kecil) dipakai CSS untuk menata elemen di bawahnya
  const syncNav = () =>
    document.documentElement.style.setProperty("--nav-bottom", `${Math.round($(".nav-pills").getBoundingClientRect().bottom)}px`);
  syncNav();
  addEventListener("resize", syncNav);
  document.fonts?.ready.then(syncNav);

  // Tanpa dunia 3D: Escape tetap menutup panel
  if (!world) {
    addEventListener("keydown", (e) => e.key === "Escape" && state.closePanel());
    addEventListener("resize", () => state.sync());
  }

  initTyping();
  initContactForm();
  uiState = state;
  return state;
}

function initTyping() {
  const el = $("#typing-text");
  if (!el) return;
  const phrases = ["Linguistik Indonesia", "Video Editor", "Content Creator", "Pembelajar Otodidak", "Tech Enthusiast", "Visual Storyteller", "Pembuat IZZA, AI Lokal"];
  if (REDUCED) return;
  let pi = 0;
  let ci = phrases[0].length;
  let deleting = true;
  let wait = 2200;
  const step = () => {
    const word = phrases[pi];
    if (deleting) {
      ci--;
      if (ci <= 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
        wait = 400;
      } else wait = 45;
    } else {
      ci++;
      if (ci >= phrases[pi].length) {
        deleting = true;
        wait = 2000;
      } else wait = 90;
    }
    el.textContent = (deleting ? word : phrases[pi]).slice(0, Math.max(0, ci));
    setTimeout(step, wait);
  };
  setTimeout(step, wait);
}

// EmailJS dimuat saat dibutuhkan saja, supaya CDN yang lambat tidak menahan dunia 3D
function loadEmailJS() {
  if (window.emailjs) return Promise.resolve(window.emailjs);
  if (emailjsPromise) return emailjsPromise;
  emailjsPromise = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.emailjs.com/dist/email.min.js";
    sc.async = true;
    const giveUp = () => {
      clearTimeout(timer);
      emailjsPromise = null;
      sc.remove();
      reject(new Error("emailjs"));
    };
    const timer = setTimeout(giveUp, 8000); // CDN macet: jangan biarkan tombol "Mengirim…" selamanya
    sc.onload = () => {
      clearTimeout(timer);
      if (window.emailjs) resolve(window.emailjs);
      else giveUp();
    };
    sc.onerror = giveUp;
    document.head.appendChild(sc);
  });
  return emailjsPromise;
}

function initContactForm() {
  const form = $("#contact-form");
  const status = $("#form-status");
  if (!form) return;
  const EMAIL = "nawfalarfa14@gmail.com";
  let inited = false;

  const fail = (text) => {
    const href =
      `mailto:${EMAIL}?subject=${encodeURIComponent(`Pesan dari ${form.user_name.value || "pengunjung portofolio"}`)}` +
      `&body=${encodeURIComponent(form.message.value)}`;
    const link = document.createElement("a");
    link.href = href;
    link.textContent = "kirim lewat aplikasi email";
    status.className = "form-status err";
    status.replaceChildren(`${text} Kamu bisa `, link, ".");
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    status.className = "form-status";
    status.textContent = "Mengirim…";
    loadEmailJS()
      .then((ej) => {
        if (!inited) {
          ej.init("sm08AnEPv9i2Vfjzu");
          inited = true;
        }
        return ej.sendForm("service_jtnlzjh", "template_1g0ebr8", form).then(() => {
          status.className = "form-status ok";
          status.textContent = "✅ Pesan terkirim! Terima kasih, nanti aku balas ya.";
          form.reset();
        }, () => fail("❌ Pesan gagal terkirim."));
      })
      .catch(() => fail("Layanan email sedang tidak bisa dimuat."))
      .finally(() => (btn.disabled = false));
  });
}
