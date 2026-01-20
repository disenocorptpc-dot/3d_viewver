import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURACIÓN ---
const BG_COLOR = 0x0f1115;

// --- VARIABLES GLOBALES ---
let camera, scene, renderer, mixer;
let allActions = [];
let currentModel = null;
let originalMaterials = new Map();
let currentFileName = "Sin Archivo";
let raycaster, mouse; // Para interacción 3D

// UI Elements & Print Elements
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');
const notesInput = document.getElementById('notes-input');
const layersList = document.getElementById('layers-list');
const floatingLabel = document.getElementById('floating-label'); // NEW

// Print Elements
const btnScreenshot = document.getElementById('btn-screenshot');
const printImg = document.getElementById('print-snapshot');
const printDate = document.getElementById('print-date');
const printFile = document.getElementById('print-filename');
const printNotesDst = document.getElementById('print-notes-dest');

init();
animate();

function log(msg) { } // No-op

function init() {
    const container = document.getElementById('scene-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.Fog(BG_COLOR, 15, 60);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(6, 4, 6);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2); scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5); dirLight.position.set(5, 12, 8); dirLight.castShadow = true; scene.add(dirLight);
    const spotLight = new THREE.SpotLight(0x00f0ff, 8.0); spotLight.position.set(-6, 4, -4); spotLight.lookAt(0, 0, 0); scene.add(spotLight);
    const grid = new THREE.GridHelper(30, 30, 0x333333, 0x111111); grid.name = "floor_grid"; scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.05; controls.target.set(0, 1, 0); controls.update();

    // INTERACCIÓN
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    window.addEventListener('dragover', (e) => { e.preventDefault(); loadingDiv.style.display = 'flex'; }, false);
    window.addEventListener('dragleave', (e) => { loadingDiv.style.display = 'none'; }, false);
    window.addEventListener('drop', (e) => {
        e.preventDefault(); loadingDiv.style.display = 'none';
        if (e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]);
    }, false);

    setupModeButtons();
    btnScreenshot.addEventListener('click', captureTransparentView);
    window.addEventListener('resize', onWindowResize);

    slider.addEventListener('input', (e) => {
        const percent = parseFloat(e.target.value);
        sliderVal.innerText = percent + '%';
        if (mixer && allActions.length > 0) {
            let maxDuration = 0;
            allActions.forEach(action => { if (action.getClip().duration > maxDuration) maxDuration = action.getClip().duration; });
            if (maxDuration === 0) return;
            const targetTime = maxDuration * (percent / 100);
            allActions.forEach(action => action.time = targetTime);
            mixer.update(0);
        }
    });

    log('Engine v4.0 listo.');
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    currentFileName = file.name;

    loadingDiv.style.display = 'flex'; loadingDiv.querySelector('p').innerText = "CARGANDO...";

    loader.load(url, function (gltf) {
        if (currentModel) { scene.remove(currentModel); mixer = null; allActions = []; originalMaterials.clear(); floatingLabel.style.display = 'none'; }

        const model = gltf.scene;
        currentModel = model;
        scene.add(model);

        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = true; obj.receiveShadow = true;
                if (obj.material) originalMaterials.set(obj.uuid, obj.material);
            }
        });

        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        const size = box.getSize(new THREE.Vector3());
        model.position.y += size.y * 0.1;

        // V4.0 GENERAR CAPAS
        generateLayersUI(model);

        loadingDiv.style.display = 'none';
        document.getElementById('system-status').innerText = `Modelo: ${file.name}\nSize: ${size.x.toFixed(2)}x${size.y.toFixed(2)}`;

        if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            allActions = [];
            gltf.animations.forEach(clip => {
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; action.play();
                allActions.push(action);
            });
            allActions.forEach(a => a.time = 0); mixer.update(0);
        }
        URL.revokeObjectURL(url);
    }, undefined, (err) => { console.error(err); });
}

// --- V4.0 GESTOR DE CAPAS ---
function generateLayersUI(model) {
    layersList.innerHTML = ''; // Limpiar lista

    // Buscar objetos directos o grupos relevantes
    const objects = [];

    // Si la jerarquia es plana, buscar meshes. Si es compleja, buscar hijos directos.
    // Estrategia simple: Listar hijos directos de la escena root del GLTF
    model.children.forEach(child => {
        // Ignorar camaras/luces si vinieran exportadas
        if (child.type === 'Mesh' || child.type === 'Group' || child.type === 'Object3D') {
            objects.push(child);
        }
    });

    if (objects.length === 0) {
        layersList.innerHTML = '<p style="font-size:0.7rem; color:#666">No se detectaron capas.</p>';
        return;
    }

    objects.forEach(obj => {
        const div = document.createElement('div');
        div.className = 'layer-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = obj.visible;
        checkbox.onchange = (e) => {
            obj.visible = e.target.checked;
        };

        const label = document.createElement('span');
        label.className = 'layer-name';
        label.innerText = obj.name || "Sin Nombre";

        // Click en nombre para resaltar? (Futuro)

        div.appendChild(checkbox);
        div.appendChild(label);
        layersList.appendChild(div);
    });
}

// --- V4.0 INTERACCIÓN ETIQUETAS ---
function onPointerDown(event) {
    if (!currentModel) return;

    // Calcular coord raton relativo al canvas
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(currentModel, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const objName = hit.object.name || "Objeto";

        // Mostrar Etiqueta
        showLabel(event.clientX, event.clientY, objName);

        // Efecto visual (flash)
        const mat = hit.object.material;
        if (mat && mat.emissive) {
            const oldEmissive = mat.emissive.getHex();
            mat.emissive.setHex(0x00ffff);
            setTimeout(() => mat.emissive.setHex(oldEmissive), 200);
        }
    } else {
        hideLabel();
    }
}

function showLabel(x, y, text) {
    floatingLabel.innerText = text;
    floatingLabel.style.display = 'block';

    // Ajustar posición para que quede encima del ratón
    // Y que no se salga de la pantalla
    const labelW = floatingLabel.offsetWidth;
    const labelH = floatingLabel.offsetHeight;

    floatingLabel.style.left = (x - labelW / 2) + 'px';
    floatingLabel.style.top = (y - labelH - 10) + 'px';

    // Animar entrada
    floatingLabel.style.opacity = 0;
    setTimeout(() => floatingLabel.style.opacity = 1, 10);
}
function hideLabel() {
    floatingLabel.style.display = 'none';
}

function setupModeButtons() {
    const btnOrig = document.getElementById('mode-original');
    const btnClay = document.getElementById('mode-clay');
    const btnWire = document.getElementById('mode-wire');
    const setMode = (mode) => {
        [btnOrig, btnClay, btnWire].forEach(b => b.classList.remove('active'));
        if (mode === 'ORIG') btnOrig.classList.add('active');
        if (mode === 'CLAY') btnClay.classList.add('active');
        if (mode === 'WIRE') btnWire.classList.add('active');

        if (!currentModel) return;

        // WIRE
        const matWire = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true });

        // V4.0 SMART CLAY (Random Colors)
        // Usamos un mapa para que el color sea persistente por UUID
        const colorMap = new Map();

        currentModel.traverse((obj) => {
            if (obj.isMesh) {
                if (mode === 'ORIG') {
                    if (originalMaterials.has(obj.uuid)) obj.material = originalMaterials.get(obj.uuid);
                }
                else if (mode === 'CLAY') {
                    // Generar color aleatorio pero estable basado en su nombre o ID
                    let randColor;
                    if (colorMap.has(obj.uuid)) {
                        randColor = colorMap.get(obj.uuid);
                    } else {
                        // Generar color pastel
                        const h = Math.random();
                        const s = 0.5 + Math.random() * 0.2; // Sat media
                        const l = 0.6 + Math.random() * 0.2; // Light alta
                        randColor = new THREE.Color().setHSL(h, s, l);
                        colorMap.set(obj.uuid, randColor);
                    }
                    obj.material = new THREE.MeshStandardMaterial({ color: randColor, roughness: 0.8 });
                }
                else if (mode === 'WIRE') {
                    obj.material = matWire;
                }
            }
        });
    };
    btnOrig.onclick = () => setMode('ORIG'); btnClay.onclick = () => setMode('CLAY'); btnWire.onclick = () => setMode('WIRE');
}

function captureTransparentView() {
    if (!renderer) return;
    const oldBg = scene.background; const oldFog = scene.fog; const grid = scene.getObjectByName('floor_grid');
    if (grid) grid.visible = false; scene.background = null; scene.fog = null;
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    scene.background = oldBg; scene.fog = oldFog; if (grid) grid.visible = true;
    printImg.src = dataURL;
    printFile.textContent = currentFileName;
    printDate.textContent = new Date().toLocaleDateString();
    printNotesDst.innerText = notesInput.value.trim() || "Sin observaciones registradas.";
    alert("Captura Transparente Lista.\nRevisa el texto y dale a 'Imprimir PDF'.");
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}
function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }
