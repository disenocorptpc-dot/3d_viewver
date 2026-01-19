import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURACIÓN ---
const BG_COLOR = 0x0f1115;

// --- VARIABLES GLOBALES ---
let camera, scene, renderer, mixer;
let allActions = [];
let currentModel = null;

// UI Elements
const consoleDiv = document.getElementById('debug-console');
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');

init();
animate();

function log(msg) {
    if (consoleDiv) consoleDiv.innerHTML = `> ${msg}`;
    console.log(msg);
}

function init() {
    const container = document.getElementById('scene-container');

    // 1. ESCENA
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.Fog(BG_COLOR, 10, 50);

    // 2. CÁMARA
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(5, 3, 5);

    // 3. RENDERER
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 4. LUCES
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const spotLight = new THREE.SpotLight(0x00f0ff, 5);
    spotLight.position.set(-5, 5, -5);
    scene.add(spotLight);

    const grid = new THREE.GridHelper(20, 20, 0x333333, 0x111111);
    scene.add(grid);

    // 5. CONTROLES
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);
    controls.update();

    // 6. DRAG & DROP
    window.addEventListener('dragover', function (e) { e.preventDefault(); loadingDiv.style.display = 'flex'; }, false);
    window.addEventListener('dragleave', function (e) { loadingDiv.style.display = 'none'; }, false);
    window.addEventListener('drop', function (e) {
        e.preventDefault();
        loadingDiv.style.display = 'none';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]);
    }, false);

    setupTestCube();

    window.addEventListener('resize', onWindowResize);

    // --- SLIDER LOGIC FIX (FORCE TRACKS) ---
    slider.addEventListener('input', (e) => {
        const percent = parseFloat(e.target.value);
        sliderVal.innerText = percent + '%';

        if (mixer && allActions.length > 0) {
            // Buscamos duración máxima
            let maxDuration = 0;
            allActions.forEach(action => {
                if (action.getClip().duration > maxDuration) maxDuration = action.getClip().duration;
            });

            if (maxDuration === 0) return; // Evitar errores

            const targetTime = maxDuration * (percent / 100);

            // FUERZA BRUTA: Asigna el tiempo manualmente a cada acción individual
            allActions.forEach(action => {
                action.time = targetTime;
            });

            // Actualiza el mixer para que renderice el cambio
            mixer.update(0);
        }
    });

    log('Listo v2.1. Arrastra tu .GLB aquí.');
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    log(`Cargando...`);
    loadingDiv.style.display = 'flex';

    loader.load(url, function (gltf) {
        if (currentModel) {
            scene.remove(currentModel);
            mixer = null;
            allActions = [];
        }

        const model = gltf.scene;
        currentModel = model;
        scene.add(model);

        model.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
        });

        // Centrar
        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));

        loadingDiv.style.display = 'none';

        // --- CARGA DE ANIMACIONES ---
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            allActions = [];

            log(`Controlando ${gltf.animations.length} pistas.`);

            gltf.animations.forEach(clip => {
                // Hacer el clip LoopOnce y Clamp para que no salte al final
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
                action.play();
                allActions.push(action);
            });

            // Reset Slider
            slider.value = 0;
            sliderVal.innerText = '0%';

            // Set inicial
            allActions.forEach(action => action.time = 0);
            mixer.update(0);

        } else {
            log('Modelo sin mov. (Check "Animation" en Blender export)');
        }

        URL.revokeObjectURL(url);

    }, undefined, function (error) {
        console.error(error);
        log('Error de carga.');
        loadingDiv.style.display = 'none';
    });
}

function setupTestCube() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x00f0ff, wireframe: true });
    currentModel = new THREE.Mesh(geometry, material);
    currentModel.position.y = 1;
    scene.add(currentModel);
    slider.addEventListener('input', (e) => {
        if (!mixer && currentModel && currentModel.geometry.type === 'BoxGeometry') {
            currentModel.rotation.y = (e.target.value / 100) * Math.PI * 2;
        }
    });
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
