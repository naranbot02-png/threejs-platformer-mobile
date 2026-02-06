import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- DOM
const $coins = document.getElementById('coins');
const $deaths = document.getElementById('deaths');
const $tip = document.getElementById('centerTip');

// Touch controls DOM
const $touch = document.getElementById('touch');
const $stickBase = document.getElementById('stickBase');
const $stick = document.getElementById('stick');
const $btnJump = document.getElementById('btnJump');
const $btnRestart = document.getElementById('btnRestart');

const isTouch = matchMedia('(pointer: coarse)').matches;
if (!isTouch) {
  // keep touch overlay hidden for desktop
  if ($touch) $touch.style.display = 'none';
}

// --- Renderer / Scene / Camera
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1020, 18, 80);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 12);

// --- Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(12, 18, 10);
sun.castShadow = false;
scene.add(sun);

// --- Materials (fallbacks)
const matGround = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 1, metalness: 0 });
const matPlatform = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 1, metalness: 0 });
const matPlayer = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7 });
const matCoin = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.25, metalness: 0.2, emissive: 0x3b2f0b, emissiveIntensity: 0.35 });
const matEnemy = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.8 });
const matGoal = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6, emissive: 0x0a2a14, emissiveIntensity: 0.25 });

// --- Assets
const loader = new GLTFLoader();
const ASSETS = {
  character: '/assets/kenney/models/character.glb',
  coin: '/assets/kenney/models/coin.glb',
  flag: '/assets/kenney/models/flag.glb',
  platform: '/assets/kenney/models/platform.glb',
  platformMedium: '/assets/kenney/models/platform-medium.glb',
  platformLarge: '/assets/kenney/models/platform-large.glb',
  brick: '/assets/kenney/models/brick.glb',
  blockCoin: '/assets/kenney/models/block-coin.glb',
};

const glbCache = new Map();
async function loadGLB(url){
  if (glbCache.has(url)) return glbCache.get(url).clone(true);
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  // Normalize materials to be non-black if any are missing
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = true;
    if (!obj.material) obj.material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  });
  glbCache.set(url, root);
  return root.clone(true);
}

// --- Helpers
const v3 = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

// Axis-aligned bounding box collision (player capsule approximated by AABB)
function aabbIntersects(a, b){
  return (a.min.x <= b.max.x && a.max.x >= b.min.x) &&
         (a.min.y <= b.max.y && a.max.y >= b.min.y) &&
         (a.min.z <= b.max.z && a.max.z >= b.min.z);
}

function makeBox(w,h,d, material){
  const geo = new THREE.BoxGeometry(w,h,d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.size = { w,h,d };
  return mesh;
}

function meshAABB(mesh){
  const { w,h,d } = mesh.userData.size;
  const p = mesh.position;
  return {
    min: v3(p.x - w/2, p.y - h/2, p.z - d/2),
    max: v3(p.x + w/2, p.y + h/2, p.z + d/2),
  };
}

// --- World
const solids = [];     // static platforms
const coins = [];      // collectible
const enemies = [];    // simple patrollers
let goal = null;

function addSolid(mesh){
  mesh.castShadow = false; mesh.receiveShadow = true;
  scene.add(mesh);
  solids.push(mesh);
}

async function addCoin(pos){
  let mesh;
  try {
    mesh = await loadGLB(ASSETS.coin);
  } catch {
    mesh = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.10, 10, 18), matCoin);
    mesh.rotation.x = Math.PI/2;
  }
  mesh.position.copy(pos);
  mesh.userData.radius = 0.55;
  scene.add(mesh);
  coins.push(mesh);
}

function addEnemy(pos, range=3.0, speed=1.2){
  const mesh = makeBox(0.8,0.8,0.8, matEnemy);
  mesh.position.copy(pos);
  mesh.userData.range = range;
  mesh.userData.speed = speed;
  mesh.userData.baseX = pos.x;
  mesh.userData.dir = 1;
  scene.add(mesh);
  enemies.push(mesh);
}

async function addGoal(pos){
  let mesh;
  try {
    mesh = await loadGLB(ASSETS.flag);
  } catch {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.4, 12), matGoal);
  }
  mesh.position.copy(pos);
  mesh.userData.radius = 0.9;
  scene.add(mesh);
  goal = mesh;
}

async function buildLevel(){
  // Clear
  for (const m of [...solids, ...coins, ...enemies]) scene.remove(m);
  solids.length = 0; coins.length = 0; enemies.length = 0;
  if (goal) scene.remove(goal);
  goal = null;

  // Ground
  const ground = makeBox(60, 1, 18, matGround);
  ground.position.set(0, -0.5, 0);
  addSolid(ground);

  // Platforms (simple path)
  const platformSpecs = [
    // x, y, z, w, h, d, kind
    [ 0, 1.2, 0,  4, 0.6, 4, 'medium' ],
    [ 5, 2.3, 0,  4, 0.6, 4, 'medium' ],
    [ 9, 3.4, 0,  3, 0.6, 4, 'small' ],
    [ 13, 4.6, 0, 3, 0.6, 4, 'small' ],
    [ 17, 5.2, 0, 4, 0.6, 4, 'medium' ],
    [ 22, 4.1, 0, 4, 0.6, 4, 'medium' ],
    [ 27, 3.0, 0, 5, 0.6, 4, 'large' ],
    [ 33, 2.2, 0, 4, 0.6, 4, 'medium' ],
    [ 38, 2.2, 0, 4, 0.6, 4, 'medium' ],
    [ 43, 3.0, 0, 4, 0.6, 4, 'medium' ],
  ];
  for (const [x,y,z,w,h,d,kind] of platformSpecs){
    const collider = makeBox(w,h,d, matPlatform);
    collider.position.set(x,y,z);
    collider.visible = false; // use model for visuals
    addSolid(collider);

    // Visual model (best effort)
    try {
      const url = kind === 'large' ? ASSETS.platformLarge : (kind === 'small' ? ASSETS.platform : ASSETS.platformMedium);
      const vis = await loadGLB(url);
      vis.position.set(x, y - 0.3, z);
      vis.scale.setScalar(1.0);
      scene.add(vis);
    } catch {
      // fallback: show collider
      collider.visible = true;
    }
  }

  // Coins
  const coinPositions = [
    v3(0, 2.2, 0),
    v3(5, 3.2, 0),
    v3(9, 4.3, 0),
    v3(13, 5.5, 0),
    v3(17, 6.2, 0),
    v3(22, 5.1, 0),
    v3(27, 4.0, 0),
    v3(33, 3.2, 0),
    v3(38, 3.2, 0),
    v3(43, 4.0, 0),
  ];
  for (const p of coinPositions) await addCoin(p);

  // Enemies (still simple boxes for gameplay)
  addEnemy(v3(9, 4.3, 0), 1.5, 1.0);
  addEnemy(v3(27, 3.9, 0), 2.2, 1.3);

  // Goal
  await addGoal(v3(47, 4.2, 0));
}

// --- Player
// Invisible collider + visible model (best effort)
const player = makeBox(0.9, 1.2, 0.9, matPlayer);
player.visible = false;
player.position.set(-2, 1.5, 0);
scene.add(player);

let playerModel = null;
async function ensurePlayerModel(){
  if (playerModel) return;
  try {
    playerModel = await loadGLB(ASSETS.character);
    playerModel.scale.setScalar(1.0);
    scene.add(playerModel);
  } catch {
    // fallback: show collider
    player.visible = true;
  }
}

const playerState = {
  vel: v3(0,0,0),
  onGround: false,
  coins: 0,
  deaths: 0,
  finished: false,
};

const spawn = v3(-2, 1.6, 0);

function syncPlayerModel(){
  if (!playerModel) return;
  playerModel.position.copy(player.position);
  playerModel.position.y -= 0.6;
}

function respawn(){
  player.position.copy(spawn);
  playerState.vel.set(0,0,0);
  playerState.onGround = false;
  playerState.deaths++;
  playerState.finished = false;
  $deaths.textContent = String(playerState.deaths);
  syncPlayerModel();
}

function resetRun(){
  buildLevel();
  playerState.coins = 0;
  $coins.textContent = '0';
  playerState.deaths = 0;
  $deaths.textContent = '0';
  respawn();
}

// --- Input
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') resetRun();
});
addEventListener('keyup', (e) => keys.delete(e.code));

// Touch state
const touchState = {
  moveX: 0, // -1..1
  jump: false,
};

if ($btnJump) {
  const down = (e) => { e.preventDefault(); touchState.jump = true; };
  const up = (e) => { e.preventDefault(); touchState.jump = false; };
  $btnJump.addEventListener('pointerdown', down);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}
if ($btnRestart) {
  $btnRestart.addEventListener('pointerdown', (e) => { e.preventDefault(); resetRun(); });
}

// Virtual joystick
let stickPointerId = null;
let stickCenter = { x: 0, y: 0 };
function setStick(dx, dy) {
  const max = 46;
  const len = Math.hypot(dx, dy);
  const k = len > max ? (max / len) : 1;
  const sx = dx * k;
  const sy = dy * k;
  if ($stick) $stick.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
  touchState.moveX = clamp(sx / max, -1, 1);
}
if ($stickBase) {
  $stickBase.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickPointerId = e.pointerId;
    $stickBase.setPointerCapture?.(stickPointerId);
    const r = $stickBase.getBoundingClientRect();
    stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setStick(e.clientX - stickCenter.x, e.clientY - stickCenter.y);
  });
  $stickBase.addEventListener('pointermove', (e) => {
    if (stickPointerId !== e.pointerId) return;
    e.preventDefault();
    setStick(e.clientX - stickCenter.x, e.clientY - stickCenter.y);
  });
  const end = (e) => {
    if (stickPointerId !== e.pointerId) return;
    e.preventDefault();
    stickPointerId = null;
    if ($stick) $stick.style.transform = 'translate(-50%, -50%)';
    touchState.moveX = 0;
  };
  $stickBase.addEventListener('pointerup', end);
  $stickBase.addEventListener('pointercancel', end);
}

// Pointer lock only on desktop
let pointerLocked = false;
if (!isTouch) {
  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock?.();
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if ($tip) $tip.style.display = pointerLocked ? 'none' : 'block';
  });
}

let yaw = 0;
let pitch = -0.15;
addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  yaw -= e.movementX * 0.002;
  pitch -= e.movementY * 0.002;
  pitch = clamp(pitch, -0.55, 0.25);
});

// --- Physics params
const GRAVITY = -22;
const MOVE_SPEED = 7.5;
const JUMP_VEL = 9.4;
const DAMPING = 10.0;

function resolveCollisions(prevPos){
  // AABB resolve with solids: separate axis by minimal penetration
  const a = meshAABB(player);
  playerState.onGround = false;

  for (const s of solids){
    const b = meshAABB(s);
    if (!aabbIntersects(a,b)) continue;

    // compute overlaps along each axis
    const ox1 = b.max.x - a.min.x;
    const ox2 = a.max.x - b.min.x;
    const oy1 = b.max.y - a.min.y;
    const oy2 = a.max.y - b.min.y;
    const oz1 = b.max.z - a.min.z;
    const oz2 = a.max.z - b.min.z;
    const px = Math.min(ox1, ox2);
    const py = Math.min(oy1, oy2);
    const pz = Math.min(oz1, oz2);

    // resolve smallest penetration
    if (py <= px && py <= pz){
      // Y
      if (prevPos.y >= player.position.y){
        // came from above? (falling)
        player.position.y += (a.min.y < b.max.y) ? (b.max.y - a.min.y) : 0;
        playerState.vel.y = Math.max(0, playerState.vel.y);
        playerState.onGround = true;
      } else {
        player.position.y -= (a.max.y > b.min.y) ? (a.max.y - b.min.y) : 0;
        playerState.vel.y = Math.min(0, playerState.vel.y);
      }
    } else if (px <= pz){
      // X
      if (player.position.x > s.position.x) player.position.x += px; else player.position.x -= px;
      playerState.vel.x = 0;
    } else {
      // Z
      if (player.position.z > s.position.z) player.position.z += pz; else player.position.z -= pz;
      playerState.vel.z = 0;
    }

    // update aabb for subsequent checks
    a.min.copy(meshAABB(player).min);
    a.max.copy(meshAABB(player).max);
  }
}

function updateCoins(dt){
  // spin and collect
  const pa = meshAABB(player);
  for (let i = coins.length-1; i>=0; i--){
    const c = coins[i];
    c.rotation.z += dt * 4.0;
    const d = c.position.distanceTo(player.position);
    if (d < 0.9){
      scene.remove(c);
      coins.splice(i,1);
      playerState.coins++;
      $coins.textContent = String(playerState.coins);
    }
  }
}

function updateEnemies(dt){
  const pa = meshAABB(player);
  for (const e of enemies){
    // patrol on x
    e.position.x += e.userData.dir * e.userData.speed * dt;
    if (Math.abs(e.position.x - e.userData.baseX) > e.userData.range) e.userData.dir *= -1;

    // player collision
    const ea = meshAABB(e);
    if (aabbIntersects(pa, ea)){
      // stomp check: if player coming from above
      if (playerState.vel.y < 0 && (pa.min.y + 0.05) > (ea.max.y - 0.35)){
        // defeat enemy
        scene.remove(e);
        e.userData.dead = true;
        playerState.vel.y = JUMP_VEL * 0.75;
      } else {
        respawn();
      }
    }
  }
  // remove dead
  for (let i=enemies.length-1;i>=0;i--){
    if (enemies[i].userData.dead) enemies.splice(i,1);
  }
}

function updateGoal(){
  if (!goal || playerState.finished) return;
  const d = goal.position.distanceTo(player.position);
  if (d < 1.1){
    playerState.finished = true;
    // show simple win message
    $tip.textContent = `You win! Coins: ${playerState.coins} · Press R to restart`;
    $tip.style.display = 'block';
  }
}

function updateCamera(dt){
  const target = player.position.clone();
  target.y += 0.8;

  const dist = 10.5;
  const off = new THREE.Vector3(
    Math.sin(yaw) * dist,
    5.0 + pitch*6.0,
    Math.cos(yaw) * dist
  );

  const desired = target.clone().add(off);
  camera.position.lerp(desired, 1 - Math.exp(-dt * 6));
  camera.lookAt(target);
}

// --- Resize
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// --- Main loop
await ensurePlayerModel();
await buildLevel();
$coins.textContent = '0';
$deaths.textContent = '0';

const clock = new THREE.Clock();

function tick(){
  const dt = Math.min(clock.getDelta(), 0.033);

  // Movement input
  let ax = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ax -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ax += 1;
  // Touch joystick
  ax += touchState.moveX;
  ax = clamp(ax, -1, 1);

  const wantJump = keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp') || touchState.jump;

  // Apply horizontal accel
  playerState.vel.x += ax * MOVE_SPEED * dt * 10;
  // damping
  playerState.vel.x -= playerState.vel.x * Math.min(1, DAMPING * dt);
  playerState.vel.z -= playerState.vel.z * Math.min(1, DAMPING * dt);

  // Gravity
  playerState.vel.y += GRAVITY * dt;

  // Jump
  if (wantJump && playerState.onGround){
    playerState.vel.y = JUMP_VEL;
    playerState.onGround = false;
  }

  // Integrate
  const prev = player.position.clone();
  player.position.x += playerState.vel.x * dt;
  player.position.y += playerState.vel.y * dt;
  player.position.z += playerState.vel.z * dt;
  syncPlayerModel();

  // Constrain z (2.5D)
  player.position.z = clamp(player.position.z, -2.0, 2.0);

  // Collisions
  resolveCollisions(prev);

  // Fail condition
  if (player.position.y < -10){
    respawn();
  }

  // Update systems
  updateCoins(dt);
  updateEnemies(dt);
  updateGoal();
  updateCamera(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();

// Expose a tiny API for debugging in console
window.__game = { resetRun };
