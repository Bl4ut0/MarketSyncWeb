import * as THREE from 'three';

const marketUrl = new URL('https://mstest.bl4ut0.dev/');
const interactionRange = 2.3;
const approachHint = 'Approach a broker beneath a colored awning.';
const coats = [0xb65d42, 0x61a28b, 0x6972ab];
const brokers = [
  { flavor: 'forever', label: 'Forever', x: -8, z: -3 },
  { flavor: 'classicEra', label: 'Classic Era', x: -4, z: -3 },
  { flavor: 'anniversary', label: 'Anniversary', x: 0, z: -3 },
  { flavor: 'classic', label: 'Classic Progression', x: 4, z: -3 },
  { flavor: 'retail', label: 'Retail', x: 8, z: -3 },
];
const world = document.querySelector('#world');
const character = document.querySelector('#character');
const nameField = document.querySelector('#name');
const coatField = document.querySelector('#coat');
const hint = document.querySelector('#hint');
const interact = document.querySelector('#interact');
const auction = document.querySelector('#auction');
const auctionTitle = document.querySelector('#auction-title');
const listings = document.querySelector('#auction-listings');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  document.querySelector('#error').hidden = false;
  character.hidden = true;
}
if (renderer) start(renderer);

function start(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8bd8b);
  scene.fog = new THREE.FogExp2(0xe8bd8b, 0.023);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 120);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.23;
  const canvas = renderer.domElement;
  world.append(canvas);
  scene.add(new THREE.HemisphereLight(0xffe8bd, 0x54797e, 2.1));
  const sun = new THREE.DirectionalLight(0xffd49f, 2.3);
  sun.position.set(-18, 17, 9);
  scene.add(sun);

  const cube = new THREE.BoxGeometry();
  const materials = new Map();
  const mat = (color) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
    return materials.get(color);
  };
  function box(parent, x, y, z, width, height, depth, color) {
    const mesh = new THREE.Mesh(cube, mat(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    parent.add(mesh);
    return mesh;
  }
  const shadow = new THREE.MeshBasicMaterial({ color: 0x192321, transparent: true, opacity: 0.27, depthWrite: false });
  const shadowShape = new THREE.CircleGeometry(0.41, 20);
  function person(x, z, color) {
    const model = new THREE.Group();
    const body = box(model, 0, .86, 0, .48, .58, .33, color);
    box(model, 0, 1.29, 0, .32, .34, .31, 0xd7a679);
    box(model, 0, 1.5, 0, .43, .12, .39, 0x40322a);
    box(model, 0, .62, 0, .49, .10, .34, 0x49332a);
    const limbs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * .13, .57, 0);
      box(leg, 0, -.22, 0, .18, .46, .18, 0x32363b);
      box(leg, 0, -.49, .035, .20, .13, .27, 0x442e24);
      model.add(leg);
      limbs.push(leg);
      box(model, side * .31, .84, 0, .14, .43, .15, color);
    }
    const grounding = new THREE.Mesh(shadowShape, shadow);
    grounding.rotation.x = -Math.PI / 2;
    grounding.position.y = .018;
    model.add(grounding);
    model.position.set(x, 0, z);
    scene.add(model);
    return { model, body, limbs };
  }

  box(scene, 0, -.48, 0, 105, .26, 105, 0x39757b);
  for (let i = 0; i < 84; i++) {
    const x = Math.sin(i * 41.8) * 47;
    const z = Math.cos(i * 63.3) * 44;
    box(scene, x, -.343, z, .4 + i % 5 * .35, .008, .025, i % 2 ? 0x7eaea4 : 0x598f90);
  }
  const wood = [0x996741, 0xa37348, 0xa77a53, 0x946849, 0xb27e50];
  for (let i = 0; i < 31; i++) {
    box(scene, 0, -.13, -9.5 + i * .55, 24, .26, .535, wood[i % wood.length]);
  }
  for (const x of [-11.7, 11.7]) {
    box(scene, x, .65, -1.24, .16, .16, 16.7, 0x583e31);
    for (let z = -9; z <= 7; z += 2) box(scene, x, .2, z, .28, 1.35, .28, 0x674734);
  }
  for (const z of [-9.55, 7.03]) {
    box(scene, 0, .66, z, 24, .16, .18, 0x583e31);
    for (let x = -11.7; x <= 11.7; x += 2.6) box(scene, x, .22, z, .3, 1.4, .3, 0x674734);
  }
  const signStyles = ['#da9e61', '#7caa91', '#c37965', '#d1ba76', '#89a9cc'];
  function sign(label, stroke) {
    const paint = document.createElement('canvas');
    paint.width = 512;
    paint.height = 112;
    const context = paint.getContext('2d');
    context.fillStyle = '#183331';
    context.fillRect(0, 0, 512, 112);
    context.strokeStyle = stroke;
    context.lineWidth = 9;
    context.strokeRect(8, 8, 496, 96);
    context.font = 'bold 41px Georgia';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#fff0ca';
    context.fillText(label, 256, 58, 450);
    const texture = new THREE.CanvasTexture(paint);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(2.75, .60), new THREE.MeshBasicMaterial({ map: texture }));
  }
  const brokerHitboxes = [];
  const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const ringShape = new THREE.RingGeometry(.43, .49, 32);
  const gold = new THREE.MeshBasicMaterial({ color: 0xffd472 });
  const mutedGold = new THREE.MeshBasicMaterial({ color: 0xb89667 });
  brokers.forEach((broker, i) => {
    const { x, z, label } = broker;
    const colors = [0xA7643c, 0x527e64, 0xa64e40, 0x998047, 0x526b88];
    box(scene, x, .69, z - 1.6, 2.65, 1.37, .75, 0x714d35);
    box(scene, x, 1.42, z - 1.6, 2.85, .15, .92, 0xc78a50);
    for (const side of [-1, 1]) box(scene, x + side * 1.45, 1.64, z - 2, .15, 3.28, .15, 0x5c402d);
    const awning = box(scene, x, 3.16, z - 1.7, 3.35, .16, 1.85, colors[i]);
    awning.rotation.x = -.18;
    const labelMesh = sign(label, signStyles[i]);
    labelMesh.position.set(x, 2.83, z - .73);
    scene.add(labelMesh);
    const { model, body } = person(x, z, colors[i]);
    body.material = body.material.clone();
    broker.body = body;
    broker.ring = new THREE.Mesh(ringShape, gold);
    broker.ring.rotation.x = -Math.PI / 2;
    broker.ring.position.y = .025;
    broker.ring.visible = false;
    model.add(broker.ring);

    const hitbox = new THREE.Mesh(cube, hitboxMaterial);
    hitbox.position.y = .8;
    hitbox.scale.set(.85, 1.6, .48);
    hitbox.userData.broker = broker;
    model.add(hitbox);
    brokerHitboxes.push(hitbox);
  });
  for (const x of [-10.5, 10.5]) {
    for (const z of [-6.8, 4.7]) {
      box(scene, x, 1.33, z, .17, 2.66, .17, 0x513a2b);
      box(scene, x, 2.54, z, .35, .43, .35, 0xfbd48a).material = new THREE.MeshBasicMaterial({color: 0xffcf79});
      box(scene, x, 2.8, z, .46, .13, .46, 0x503928);
    }
  }
  for (const x of [-17, 15]) {
    const boat = new THREE.Mesh(new THREE.CylinderGeometry(1, .66, .75, 8), mat(0x623e30));
    boat.position.set(x, -.04, -6);
    boat.scale.z = 3.5;
    scene.add(boat);
    box(scene, x, 1.8, -6, .15, 3.6, .15, 0x69452d);
    box(scene, x, 2.25, -6, 2.5, 1.9, .06, 0xcfbb8b).rotation.y = .32;
  }
  for (let i = 0; i < 15; i++) {
    const x = (i - 7) * 6;
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + (i % 4), 0), mat(i % 2 ? 0x627768 : 0x536d66));
    hill.position.set(x, .3, -24 - i % 3 * 4);
    hill.scale.set(1.4, .8 + (i % 3) * .21, 1);
    scene.add(hill);
  }

  const avatar = person(0, 4.35, coats[0]);
  const position = avatar.model.position;
  const target = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const hits = [];
  const keys = new Set();
  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  let playing = false;
  let nearby;
  let hovered;
  let pointerOnCanvas = false;
  let previous = performance.now();

  function inRange(broker) {
    return Math.hypot(position.x - broker.x, position.z - broker.z) < interactionRange;
  }
  function useBroker(broker) {
    if (!broker || auction.open || !inRange(broker)) return;
    const url = new URL('/harbor-auction', marketUrl);
    url.searchParams.set('flavor', broker.flavor);
    if (listings.src !== url.href) listings.src = url.href;
    auctionTitle.textContent = `${broker.label} Auction House`;
    keys.clear();
    pointerOnCanvas = false;
    auction.showModal();
  }
  document.querySelector('#close-auction').addEventListener('click', () => auction.close());
  auction.addEventListener('close', () => canvas.focus());
  window.addEventListener('message', (event) => {
    if (event.origin === marketUrl.origin && event.source === listings.contentWindow &&
        event.data?.type === 'marketsync:close-auction') auction.close();
  });
  function updatePointer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1,
      1 - 2 * (event.clientY - bounds.top) / bounds.height);
  }
  function brokerUnderPointer() {
    hits.length = 0;
    raycaster.setFromCamera(pointer, camera);
    raycaster.intersectObjects(brokerHitboxes, false, hits);
    return hits[0]?.object.userData.broker;
  }
  function updateBrokerHover(broker) {
    if (hovered !== broker) {
      if (hovered) {
        hovered.ring.visible = false;
        hovered.body.material.emissiveIntensity = 0;
      }
      hovered = broker;
    }

    const reachable = hovered && inRange(hovered);
    if (hovered) {
      hovered.ring.visible = true;
      hovered.ring.material = reachable ? gold : mutedGold;
      hovered.body.material.emissive.setHex(0xffc765);
      hovered.body.material.emissiveIntensity = reachable ? .46 : .22;
    }
    canvas.style.cursor = hovered ? (reachable ? 'pointer' : 'not-allowed') : '';
    let message = nearby ? `${nearby.label} Auction House` : approachHint;
    if (hovered) message = `${hovered.label} broker · ${reachable ? 'Right-click to talk' : 'Move closer'}`;
    if (hint.textContent !== message) hint.textContent = message;
  }
  function enterHarbor() {
    const name = nameField.value.trim() || 'Traveler';
    document.querySelector('#player').textContent = name;
    avatar.body.material = mat(coats[Number(coatField.value)]);
    document.querySelector('#arrival').hidden = true;
    document.querySelector('#hud').hidden = false;
    hint.textContent = approachHint;
    playing = true;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Harbor. Move with WASD or arrow keys. Right-click a broker or press E to talk.');
    canvas.focus();
  }
  document.querySelector('#enter').addEventListener('click', enterHarbor);
  nameField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) enterHarbor();
  });
  interact.addEventListener('click', () => useBroker(nearby));
  canvas.addEventListener('pointermove', (event) => {
    pointerOnCanvas = event.pointerType !== 'touch';
    updatePointer(event);
  });
  canvas.addEventListener('pointerleave', () => { pointerOnCanvas = false; });
  canvas.addEventListener('contextmenu', (event) => {
    if (!playing || event.button !== 2) return;
    updatePointer(event);
    const broker = brokerUnderPointer();
    if (!broker) return;
    event.preventDefault();
    useBroker(broker);
  });
  window.addEventListener('keydown', (event) => {
    if (!playing || auction.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (movementKeys.has(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
    if (event.code === 'KeyE' && !event.repeat) useBroker(nearby);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    pointerOnCanvas = false;
  });
  for (const button of document.querySelectorAll('[data-key]')) {
    button.addEventListener('pointerdown', (event) => {
      button.setPointerCapture(event.pointerId);
      keys.add(button.dataset.key);
    });
    button.addEventListener('lostpointercapture', () => keys.delete(button.dataset.key));
  }
  function resize() {
    camera.aspect = world.clientWidth / Math.max(1, world.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(world.clientWidth, world.clientHeight, false);
  }
  window.addEventListener('resize', resize);
  resize();
  const active = (first, second) => Number(keys.has(first) || keys.has(second));
  function draw(now) {
    const dt = Math.min((now - previous) / 1000, .05);
    previous = now;
    const dx = active('KeyD', 'ArrowRight') - active('KeyA', 'ArrowLeft');
    const dz = active('KeyS', 'ArrowDown') - active('KeyW', 'ArrowUp');
    if (playing && (dx || dz)) {
      const speed = 4.1 * dt / Math.hypot(dx, dz);
      position.x = THREE.MathUtils.clamp(position.x + dx * speed, -11.1, 11.1);
      position.z = THREE.MathUtils.clamp(position.z + dz * speed, -1.75, 6.55);
      avatar.model.rotation.y = Math.atan2(dx, dz);
      avatar.limbs[0].rotation.x = Math.sin(now * .014) * .57;
      avatar.limbs[1].rotation.x = -avatar.limbs[0].rotation.x;
    } else {
      for (const limb of avatar.limbs) limb.rotation.x = 0;
    }
    const next = brokers.find(inRange);
    if (next !== nearby) {
      nearby = next;
      interact.hidden = !nearby;
      if (nearby) interact.textContent = `Talk to ${nearby.label} broker`;
    }
    if (playing) {
      const distance = camera.aspect < 1 ? 7 : 8.4;
      target.set(position.x, 5.4, position.z + distance);
      camera.position.lerp(target, 1 - Math.exp(-dt * 5));
      camera.lookAt(camera.position.x, .88, camera.position.z - distance - 1.2);
      camera.updateMatrixWorld();
      updateBrokerHover(pointerOnCanvas ? brokerUnderPointer() : undefined);
    } else {
      camera.position.set(12, 12, 23);
      camera.lookAt(0, 0, -2);
    }
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(draw);
}
