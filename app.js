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

// UI Elements & Print Elements
const consoleDiv = document.getElementById('debug-console');
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');
const notesInput = document.getElementById('notes-input');

// Print Elements
const btnScreenshot = document.getElementById('btn-screenshot');
const printImg = document.getElementById('print-snapshot');
const printDate = document.getElementById('print-date');
const printFile = document.getElementById('print-filename');
const printNotesDst = document.getElementById('print-notes-dest');

init();
animate();

function log(msg) {/* No-op para limpiar UI */ }

function init() {
    const container = document.getElementById('scene-container');
    scene = new THREE.Scene();
    // Fondo normal para visionado (se quitará al capturar)
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.Fog(BG_COLOR, 15, 60);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(6, 4, 6);

    // ALPHA: TRUE es clave para que el PNG salga transparente
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const spotLight = new THREE.SpotLight(0x00f0ff, 8.0);
    spotLight.position.set(-6, 4, -4);
    spotLight.lookAt(0, 0, 0);
    scene.add(spotLight);

    // GRID Y FONDO (Se ocultarán al imprimir)
    const grid = new THREE.GridHelper(30, 30, 0x333333, 0x111111);
    grid.name = "floor_grid"; // Nombrar para encontrarlo fácil
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 1, 0);
    controls.update();

    window.addEventListener('dragover', (e) => { e.preventDefault(); loadingDiv.style.display = 'flex'; }, false);
    window.addEventListener('dragleave', (e) => { loadingDiv.style.display = 'none'; }, false);
    window.addEventListener('drop', (e) => {
        e.preventDefault(); loadingDiv.style.display = 'none';
        if (e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]);
    }, false);

    setupModeButtons();

    // CAPTURA INTELIGENTE
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
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    currentFileName = file.name;

    loadingDiv.style.display = 'flex';
    loadingDiv.querySelector('p').innerText = "CARGANDO...";

    loader.load(url, function (gltf) {
        if (currentModel) { scene.remove(currentModel); mixer = null; allActions = []; originalMaterials.clear(); }

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
        const matClay = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 });
        const matWire = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true });

        currentModel.traverse((obj) => {
            if (obj.isMesh) {
                if (mode === 'ORIG') { if (originalMaterials.has(obj.uuid)) obj.material = originalMaterials.get(obj.uuid); }
                else if (mode === 'CLAY') obj.material = matClay;
                else if (mode === 'WIRE') obj.material = matWire;
            }
        });
    };
    btnOrig.onclick = () => setMode('ORIG'); btnClay.onclick = () => setMode('CLAY'); btnWire.onclick = () => setMode('WIRE');
}

// --- CAPTURA TRANSPARENTE 3.1 ---
function captureTransparentView() {
    if (!renderer) return;

    // 1. GUARDAR ESTADO ACTUAL
    const oldBg = scene.background;
    const oldFog = scene.fog;
    const grid = scene.getObjectByName('floor_grid');
    if (grid) grid.visible = false; // Ocultar rejilla

    // 2. PREPARAR TRANSPARENCIA
    scene.background = null; // Quitar fondo (transparente)
    scene.fog = null;        // Quitar niebla

    // 3. RENDERIZAR FRAME LIMPIO
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');

    // 4. RESTAURAR ESTADO NORMAL
    scene.background = oldBg;
    scene.fog = oldFog;
    if (grid) grid.visible = true;

    // 5. INYECTAR EN HTML IMPRESIÓN
    printImg.src = dataURL;
    printFile.textContent = currentFileName;
    printDate.textContent = new Date().toLocaleDateString();

    // Transferir Notas
    const userNotes = notesInput.value.trim();
    printNotesDst.innerText = userNotes || "Sin observaciones registradas.";

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
