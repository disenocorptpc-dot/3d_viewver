import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'; // Para iluminación realista si quisieramos HDRI

// --- CONFIGURACIÓN ---
const MODEL_PATH = 'modelo.glb'; // <--- AQUÍ PONDRÁS TU ARCHIVO
const BG_COLOR = 0x0f1115;       // Mismo color que el CSS background

// --- VARIABLES GLOBALES ---
let camera, scene, renderer, mixer;
let modelReady = false;
let animationAction; // La acción de animación activa

// UI Elements
const consoleDiv = document.getElementById('debug-console');
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');

init();
animate();

function log(msg) {
    consoleDiv.innerHTML = `> ${msg}`;
    console.log(msg);
}

function init() {
    const container = document.getElementById('scene-container');

    // 1. ESCENA
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    // Niebla suave para fundir el piso con el fondo
    scene.fog = new THREE.Fog(BG_COLOR, 10, 50);

    // 2. CÁMARA
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(5, 3, 5); // Posición inicial

    // 3. RENDERER (Calidad Alta)
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true; // Sombras activadas
    container.appendChild(renderer.domElement);

    // 4. LUCES (Setup de Estudio)
    // Luz Ambiental suave
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    // Luz Principal con Sombra
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    // Luz de contra (para bordes bonitos "Dark Tech")
    const spotLight = new THREE.SpotLight(0x00f0ff, 5); // Azul cyan
    spotLight.position.set(-5, 5, -5);
    spotLight.lookAt(0, 0, 0);
    scene.add(spotLight);

    // Grid de piso tech
    const grid = new THREE.GridHelper(20, 20, 0x333333, 0x111111);
    scene.add(grid);

    // 5. CONTROLES (Orbit)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);
    controls.update();

    // 6. CARGAR MODELO
    const loader = new GLTFLoader();

    log(`Buscando archivo: ${MODEL_PATH}...`);

    loader.load(MODEL_PATH, function (gltf) {

        const model = gltf.scene;
        scene.add(model);

        // Ajustar modelo
        model.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
        });

        // CENTRAR CÁMARA AUTOMÁTICAMENTE
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Mover modelo para que su centro esté en 0,0,0
        model.position.sub(center);

        log('Modelo cargado correctamente.');
        loadingDiv.style.display = 'none';

        // 7. ANIMACIONES (Aquí está la magia del Slider)
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);

            // Tomamos la primera animación (normalmente la única que exportas de Blender)
            const clip = gltf.animations[0];
            animationAction = mixer.clipAction(clip);

            // Configurar para que NO se reproduzca sola, sino que nosotros la controlemos
            animationAction.play();
            animationAction.paused = true; // Pausada para control manual

            log(`Animación detectada: "${clip.name}" (${clip.duration.toFixed(2)}s)`);

            // Conectar el Slider
            setupSliderControl(clip.duration);
        } else {
            log('AVISO: El modelo no tiene animaciones.');
        }

    }, undefined, function (error) {
        console.error(error);
        loadingDiv.innerHTML = '<p style="color:red">ERROR DE CARGA<br>Verifica la ruta o permiso CORS</p>';
        log('Error: No se encontró modelo.glb (Cargando cubo de prueba)');
        setupTestCube();
    });

    // Resize Handler
    window.addEventListener('resize', onWindowResize);

    // Slider Events
    slider.addEventListener('input', (e) => {
        const percent = e.target.value;
        sliderVal.innerText = percent + '%';

        if (animationAction && mixer) {
            const duration = animationAction.getClip().duration;
            const time = duration * (percent / 100);

            // Forzar el tiempo de la animación
            animationAction.time = time;
            mixer.update(0); // Actualizar mixer manualmente
        }
    });

}

function setupSliderControl(duration) {
    // Ya está configurado en el evento input, pero aquí podríamos pulir cosas
}

function setupTestCube() {
    // Si falla la carga, mostramos un cubo girando
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x00f0ff, wireframe: true });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.y = 1;
    scene.add(cube);
    loadingDiv.style.display = 'none';

    // Animación de prueba para el cubo
    // (Simulamos que el slider rota el cubo)
    slider.addEventListener('input', (e) => {
        cube.rotation.y = (e.target.value / 100) * Math.PI * 2;
        cube.position.y = 1 + (e.target.value / 100) * 2; // Levitar
    });
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    // if(mixer) mixer.update(0.01); // No actualizamos mixer aquí porque lo controla el slider
    renderer.render(scene, camera);
}
