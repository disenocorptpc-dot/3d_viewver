import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { saveProjectData, loadProjectData } from './db_manager.js'; // FIREBASE IMPORT

// --- CONFIGURACIÓN ---
const BG_COLOR = 0x0f1115;

// --- VARIABLES GLOBALES ---
let camera, scene, renderer, mixer;
let allActions = [];
let currentModel = null;
let originalMaterials = new Map();
let currentFileName = "Sin Archivo";
let raycaster, mouse;
let selectedObject = null;
let partsData = {}; // { uuid: {name, desc, img} }

// UI Elements
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');
const notesInput = document.getElementById('notes-input'); // Bitacora Global
const layersList = document.getElementById('layers-list');
const floatingLabel = document.getElementById('floating-label');

// Detail Panel Elements
const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('part-details-content');
const emptyMsg = document.getElementById('empty-selection-msg');
const detailName = document.getElementById('detail-name');
const detailDesc = document.getElementById('detail-desc');
const detailImgZone = document.getElementById('detail-img-zone');
const detailImgInput = document.getElementById('detail-img-input');
const detailImgPreview = document.getElementById('detail-img-preview');
const imgPlaceholder = document.getElementById('img-placeholder-text');
const btnSaveDetail = document.getElementById('btn-save-detail');

// Print Elements
const btnScreenshot = document.getElementById('btn-screenshot');
const printImg = document.getElementById('print-snapshot');
const printDate = document.getElementById('print-date');
const printFile = document.getElementById('print-filename');
const printNotesDst = document.getElementById('print-notes-dest');
const printDetailsGrid = document.getElementById('print-details-section');

init();
animate();

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
    setupDetailPanelLogic();
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

    // Auto-save de notas globales al perder foco
    notesInput.addEventListener('change', () => {
        if (currentFileName !== "Sin Archivo") {
            saveProjectData(currentFileName, partsData, notesInput.value);
        }
    });
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    currentFileName = file.name;
    loadingDiv.style.display = 'flex'; loadingDiv.querySelector('p').innerText = "CARGANDO MODELO...";

    loader.load(url, async function (gltf) {
        if (currentModel) { scene.remove(currentModel); mixer = null; allActions = []; originalMaterials.clear(); floatingLabel.style.display = 'none'; }

        partsData = {};
        selectedObject = null;
        updateDetailPanel();

        const model = gltf.scene;
        currentModel = model;
        scene.add(model);

        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = true; obj.receiveShadow = true;
                if (obj.material) originalMaterials.set(obj.uuid, obj.material);

                // --- MAPEO DE PERSISTENCIA ---
                // Intentamos recuperar datos usando el NOMBRE del objeto como clave persistente
                // (Ya que los UUIDs de Three.js cambian al recargar, pero los nombres de Blender no)
                obj.userData.originalName = obj.name;
            }
        });

        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        const size = box.getSize(new THREE.Vector3());
        model.position.y += size.y * 0.1;

        generateLayersUI(model);

        // --- CARGAR DATOS DE NUBE ---
        loadingDiv.querySelector('p').innerText = "SINCRONIZANDO...";
        const cloudData = await loadProjectData(currentFileName);

        if (cloudData) {
            console.log("Datos cargados:", cloudData);
            notesInput.value = cloudData.notes || "";

            // Reconstruir partsData mapeando nombres -> UUIDs actuales
            // cloudData.parts usa Nombres o IDs estables? 
            // V5.1 Mejoramos: Guardaremos en DB clave = NOMBRE OBJETO.
            // Asi al recargar, buscamos objeto por nombre y le asignamos la data.

            const cloudParts = cloudData.parts || {};

            // Recorrer el modelo actual y ver si tenemos datos para él
            model.traverse((obj) => {
                if (obj.isMesh && cloudParts[obj.name]) {
                    // Encontrado! Asociar datos al UUID actual de sesion
                    partsData[obj.uuid] = cloudParts[obj.name];
                }
            });
        } else {
            notesInput.value = "";
        }

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

function generateLayersUI(model) {
    layersList.innerHTML = '';
    const objects = [];
    model.children.forEach(child => {
        if (child.type === 'Mesh' || child.type === 'Group' || child.type === 'Object3D') objects.push(child);
    });
    if (objects.length === 0) { layersList.innerHTML = '<p style="font-size:0.7rem; color:#666">No se detectaron capas.</p>'; return; }
    objects.forEach(obj => {
        const div = document.createElement('div'); div.className = 'layer-item';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = obj.visible;
        checkbox.onchange = (e) => { obj.visible = e.target.checked; };
        const label = document.createElement('span'); label.className = 'layer-name'; label.innerText = obj.name || "Sin Nombre";
        div.appendChild(checkbox); div.appendChild(label); layersList.appendChild(div);
    });
}

function onPointerDown(event) {
    if (!currentModel) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(currentModel, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        selectedObject = hit.object;
        updateDetailPanel();

        const mat = hit.object.material;
        if (mat && mat.emissive) {
            const oldEmissive = mat.emissive.getHex();
            mat.emissive.setHex(0x00ffff);
            setTimeout(() => mat.emissive.setHex(oldEmissive), 300);
        }
        showLabel(event.clientX, event.clientY, hit.object.name || "Objeto");
    } else {
        hideLabel();
    }
}

function setupDetailPanelLogic() {
    detailImgZone.onclick = () => detailImgInput.click();
    detailImgInput.onchange = (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (evt) => { setDetailImage(evt.target.result); };
            reader.readAsDataURL(e.target.files[0]);
        }
    };
    window.addEventListener('paste', (e) => {
        if (!selectedObject) return;
        if (e.clipboardData && e.clipboardData.items) {
            for (let i = 0; i < e.clipboardData.items.length; i++) {
                if (e.clipboardData.items[i].type.indexOf("image") !== -1) {
                    const blob = e.clipboardData.items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = (evt) => setDetailImage(evt.target.result);
                    reader.readAsDataURL(blob);
                    break;
                }
            }
        }
    });

    // GUARDAR 
    btnSaveDetail.onclick = async () => {
        if (!selectedObject) return;

        // Guardar en sesión
        const uuid = selectedObject.uuid;
        const nameKey = selectedObject.name || "unnamed"; // Clave estable

        // La estructura de partsData ahora almacenará info bajo el UUID para uso inmediato
        // PERO al guardar en DB usaremos el NAME para que sobreviva recargas
        partsData[uuid] = {
            name: detailName.value,
            desc: detailDesc.value,
            img: detailImgPreview.src !== window.location.href ? detailImgPreview.src : null,
            stableName: nameKey // Referencia para DB
        };

        // Preparar objeto para Nube (Mapeado por Nombre Estático)
        const partsForCloud = {};
        Object.values(partsData).forEach(p => {
            if (p.stableName) {
                partsForCloud[p.stableName] = p;
            }
        });

        // Disparar guardado en nube
        btnSaveDetail.innerText = "☁️ GUARDANDO...";
        const success = await saveProjectData(currentFileName, partsForCloud, notesInput.value);

        if (success) {
            btnSaveDetail.innerText = "✅ GUARDADO";
        } else {
            btnSaveDetail.innerText = "❌ ERROR DB";
        }
        setTimeout(() => btnSaveDetail.innerText = "💾 GUARDAR FICHA", 2000);
    };
}

function setDetailImage(src) {
    if (!src) {
        detailImgPreview.style.display = 'none'; detailImgPreview.src = ''; imgPlaceholder.style.display = 'block';
    } else {
        detailImgPreview.src = src; detailImgPreview.style.display = 'block'; imgPlaceholder.style.display = 'none';
    }
}

function updateDetailPanel() {
    if (!selectedObject) { detailContent.style.display = 'none'; emptyMsg.style.display = 'block'; return; }
    detailContent.style.display = 'block'; emptyMsg.style.display = 'none';

    // Buscar datos
    const uuid = selectedObject.uuid;
    const name = selectedObject.name || "Objeto Sin Nombre";
    detailName.value = name;

    if (partsData[uuid]) {
        detailDesc.value = partsData[uuid].desc || "";
        setDetailImage(partsData[uuid].img);
    } else {
        detailDesc.value = "";
        setDetailImage(null);
    }
}

function showLabel(x, y, text) {
    floatingLabel.innerText = text; floatingLabel.style.display = 'block';
    const labelW = floatingLabel.offsetWidth; const labelH = floatingLabel.offsetHeight;
    floatingLabel.style.left = (x - labelW / 2) + 'px'; floatingLabel.style.top = (y - labelH - 10) + 'px';
    floatingLabel.style.opacity = 0; setTimeout(() => floatingLabel.style.opacity = 1, 10);
}
function hideLabel() { floatingLabel.style.display = 'none'; }

function setupModeButtons() {
    const btnOrig = document.getElementById('mode-original'); const btnClay = document.getElementById('mode-clay'); const btnWire = document.getElementById('mode-wire');
    const setMode = (mode) => {
        [btnOrig, btnClay, btnWire].forEach(b => b.classList.remove('active'));
        if (mode === 'ORIG') btnOrig.classList.add('active'); if (mode === 'CLAY') btnClay.classList.add('active'); if (mode === 'WIRE') btnWire.classList.add('active');
        if (!currentModel) return;
        const matWire = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true });
        const colorMap = new Map();
        currentModel.traverse((obj) => {
            if (obj.isMesh) {
                if (mode === 'ORIG') { if (originalMaterials.has(obj.uuid)) obj.material = originalMaterials.get(obj.uuid); }
                else if (mode === 'CLAY') {
                    let randColor; if (colorMap.has(obj.uuid)) { randColor = colorMap.get(obj.uuid); }
                    else { const h = Math.random(); const s = 0.5 + Math.random() * 0.2; const l = 0.6 + Math.random() * 0.2; randColor = new THREE.Color().setHSL(h, s, l); colorMap.set(obj.uuid, randColor); }
                    obj.material = new THREE.MeshStandardMaterial({ color: randColor, roughness: 0.8 });
                }
                else if (mode === 'WIRE') { obj.material = matWire; }
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

    printImg.src = dataURL; printFile.textContent = currentFileName; printDate.textContent = new Date().toLocaleDateString();
    printNotesDst.innerText = notesInput.value.trim() || "Sin observaciones generales.";

    printDetailsGrid.innerHTML = '';
    const keys = Object.keys(partsData);
    if (keys.length > 0) {
        keys.forEach(uuid => {
            const part = partsData[uuid];
            if (!part.name && !part.desc) return;
            const card = document.createElement('div'); card.className = 'print-card';
            const imgHTML = part.img ? `<img src="${part.img}">` : '';
            card.innerHTML = `${imgHTML}<div class="print-card-content"><div class="print-card-title">${part.name}</div><div class="print-card-desc">${part.desc}</div></div>`;
            printDetailsGrid.appendChild(card);
        });
    }
    alert("Captura Transparente Lista.\nSe han incluido las fichas técnicas guardadas en el reporte.");
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}
function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }
