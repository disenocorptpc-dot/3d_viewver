import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURACIÓN ---
const BG_COLOR = 0x0f1115;

// --- VARIABLES GLOBALES ---
let camera, scene, renderer, mixer;
let animationAction;
let currentModel = null; // Para poder borrarlo al cargar otro

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

    // 6. DRAG & DROP LISTENER
    // Configurar la zona de "Drop" en toda la pantalla
    window.addEventListener('dragover', function (e) {
        e.preventDefault(); // Necesario para permitir el drop
        loadingDiv.style.display = 'flex';
        loadingDiv.innerHTML = '<p style="color:#00f0ff">¡SUELTA EL ARCHIVO!</p>';
        loadingDiv.style.background = 'rgba(0,0,0,0.8)';
    }, false);

    window.addEventListener('dragleave', function (e) {
        loadingDiv.style.display = 'none';
    }, false);

    window.addEventListener('drop', function (e) {
        e.preventDefault();
        loadingDiv.style.display = 'none';

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            const extension = file.name.split('.').pop().toLowerCase();

            if (extension === 'glb' || extension === 'gltf') {
                loadLocalFile(file);
            } else {
                alert("Por favor arrastra un archivo .GLB o .GLTF válido");
            }
        }
    }, false);

    // Cargar cubo de prueba al inicio para no verlo vacío
    setupTestCube();

    log('Listo. Arrastra tu archivo .GLB aquí.');

    // Resize Handler
    window.addEventListener('resize', onWindowResize);

    // Slider Events
    slider.addEventListener('input', (e) => {
        const percent = e.target.value;
        sliderVal.innerText = percent + '%';

        if (animationAction && mixer) {
            const duration = animationAction.getClip().duration;
            const time = duration * (percent / 100);
            animationAction.time = time;
            mixer.update(0);
        }
    });
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    log(`Cargando archivo local: ${file.name}...`);
    loadingDiv.style.display = 'flex';
    loadingDiv.innerHTML = '<p>PROCESANDO...</p>';

    loader.load(url, function (gltf) {

        // Limpiar escena anterior
        if (currentModel) {
            scene.remove(currentModel);
            // Liberar memoria si es posible (geometrías, etc)
        }

        const model = gltf.scene;
        currentModel = model; // Guardar referencia
        scene.add(model);

        // Ajustar modelo
        model.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
        });

        // Centrar Cámara
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        // Centramos el modelo en el mundo en lugar de mover la cámara
        model.position.sub(center);

        // Ajustar tamaño si es muy grande/pequeño
        const size = box.getSize(new THREE.Vector3()).length();
        // Escalar grid si hace falta? No, mejor no tocar escala del modelo.

        log(`Modelo "${file.name}" cargado.`);
        loadingDiv.style.display = 'none';

        // Procesar Animación
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            const clip = gltf.animations[0];
            animationAction = mixer.clipAction(clip);
            animationAction.play();
            animationAction.paused = true;

            // Poner slider en 0
            slider.value = 0;
            sliderVal.innerText = '0%';

            log(`Animación: ${clip.name}`);
        } else {
            log('Modelo estático (Sin animación)');
            mixer = null;
            animationAction = null;
        }

        // Liberar URL
        URL.revokeObjectURL(url);

    }, undefined, function (error) {
        console.error(error);
        log('Error al leer el archivo.');
        loadingDiv.style.display = 'none';
        alert("Error al cargar el archivo. Revisa la consola.");
    });
}

function setupTestCube() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x00f0ff, wireframe: true });
    currentModel = new THREE.Mesh(geometry, material); // Lo asignamos como currentModel
    currentModel.position.y = 1;
    scene.add(currentModel);

    // El slider controla la rotación del cubo como demo
    slider.addEventListener('input', (e) => {
        if (!mixer && currentModel) { // Solo si no hay animación real cargada
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
