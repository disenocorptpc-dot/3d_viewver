import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURACIÓN ---
const BG_COLOR = 0x0f1115;

// --- VARIABLES GLOBALES ---
let camera, scene, renderer, mixer;
let allActions = [];
let currentModel = null;
let originalMaterials = new Map(); // Para guardar los materiales originales

// UI Elements
const consoleDiv = document.getElementById('debug-console');
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');

// Print Elements
const btnScreenshot = document.getElementById('btn-screenshot');
const printImg = document.getElementById('print-snapshot');

init();
animate();

function log(msg) {
    if (consoleDiv) consoleDiv.innerHTML = `> ${msg}<br>${consoleDiv.innerHTML}`;
    console.log(msg);
}

function init() {
    const container = document.getElementById('scene-container');

    // 1. ESCENA
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.Fog(BG_COLOR, 15, 60);

    // 2. CÁMARA
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(6, 4, 6);

    // 3. RENDERER (PreserveDrawingBuffer para Screenshots)
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. LUCES
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    const spotLight = new THREE.SpotLight(0x00f0ff, 8.0);
    spotLight.position.set(-6, 4, -4);
    spotLight.lookAt(0, 0, 0);
    spotLight.penumbra = 0.5;
    scene.add(spotLight);

    const grid = new THREE.GridHelper(30, 30, 0x333333, 0x111111);
    scene.add(grid);

    // 5. CONTROLES
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 1, 0);
    controls.update();

    // 6. DRAG & DROP
    window.addEventListener('dragover', (e) => { e.preventDefault(); loadingDiv.style.display = 'flex'; }, false);
    window.addEventListener('dragleave', (e) => { loadingDiv.style.display = 'none'; }, false);
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        loadingDiv.style.display = 'none';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]);
    }, false);

    // 7. BOTONES DE MODO
    setupModeButtons();

    // 8. SCREENSHOT SYSTEM
    btnScreenshot.addEventListener('click', captureView);

    window.addEventListener('resize', onWindowResize);

    // SLIDER
    slider.addEventListener('input', (e) => {
        const percent = parseFloat(e.target.value);
        sliderVal.innerText = percent + '%';

        if (mixer && allActions.length > 0) {
            let maxDuration = 0;
            allActions.forEach(action => {
                if (action.getClip().duration > maxDuration) maxDuration = action.getClip().duration;
            });
            if (maxDuration === 0) return;
            const targetTime = maxDuration * (percent / 100);
            allActions.forEach(action => action.time = targetTime);
            mixer.update(0);
        }
    });

    log('Engine v3.0 listo.');
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    log(`Procesando archivo...`);
    loadingDiv.style.display = 'flex';
    loadingDiv.querySelector('p').innerText = "CARGANDO...";

    loader.load(url, function (gltf) {
        if (currentModel) {
            scene.remove(currentModel);
            mixer = null; allActions = []; originalMaterials.clear();
        }

        const model = gltf.scene;
        currentModel = model;
        scene.add(model);

        // Guardar materiales y configurar sombras
        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
                if (obj.material) originalMaterials.set(obj.uuid, obj.material);
            }
        });

        // Centrar
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        // Levantar un poco si está enterrado
        const size = box.getSize(new THREE.Vector3());
        model.position.y += size.y * 0.1;

        loadingDiv.style.display = 'none';
        document.getElementById('system-status').innerText = `Modelo: ${file.name}\nSize: ${size.x.toFixed(2)}x${size.y.toFixed(2)}`;

        // Animaciones
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            allActions = [];
            log(`${gltf.animations.length} pistas animadas.`);
            gltf.animations.forEach(clip => {
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
                action.play();
                allActions.push(action);
            });
            allActions.forEach(action => action.time = 0);
            mixer.update(0);
        }

        URL.revokeObjectURL(url);
    }, undefined, (err) => { console.error(err); log('Error crítico de carga.'); });
}

// --- MODOS DE VISTA ---
function setupModeButtons() {
    const btnOrig = document.getElementById('mode-original');
    const btnClay = document.getElementById('mode-clay');
    const btnWire = document.getElementById('mode-wire');

    const setMode = (mode) => {
        // UI
        [btnOrig, btnClay, btnWire].forEach(b => b.classList.remove('active'));
        if (mode === 'ORIG') btnOrig.classList.add('active');
        if (mode === 'CLAY') btnClay.classList.add('active');
        if (mode === 'WIRE') btnWire.classList.add('active');

        // Logic
        if (!currentModel) return;

        // Clay Material
        const matClay = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 });
        // Wire Material
        const matWire = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true });

        currentModel.traverse((obj) => {
            if (obj.isMesh) {
                if (mode === 'ORIG') {
                    if (originalMaterials.has(obj.uuid)) obj.material = originalMaterials.get(obj.uuid);
                } else if (mode === 'CLAY') {
                    obj.material = matClay;
                } else if (mode === 'WIRE') {
                    obj.material = matWire;
                }
            }
        });
    };

    btnOrig.onclick = () => setMode('ORIG');
    btnClay.onclick = () => setMode('CLAY');
    btnWire.onclick = () => setMode('WIRE');
}

// --- SCREENSHOT SYSTEM ---
function captureView() {
    if (!renderer) return;

    // 1 Renderizar frame actual
    renderer.render(scene, camera);

    // 2 Convertir a Imagen
    const dataURL = renderer.domElement.toDataURL('image/png');

    // 3 Poner en el layout de impresión
    printImg.src = dataURL;

    log('📸 Captura guardada en Buffer de Impresión.');
    alert("Captura realizada. ¡Ahora dale a 'Imprimir'!");
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
