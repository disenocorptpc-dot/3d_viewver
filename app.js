import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three/src/extras/PMREMGenerator.js';
import { saveProjectData, loadProjectData, saveModelAsChunks, loadModelFromChunks, getAllProjects, deleteProject, sanitizeName } from './db_manager.js';

// --- CONFIG ---
const BG_COLOR = 0x0f1115;

// --- GLOBALS ---
let camera, scene, renderer, mixer;
let allActions = [];
let currentModel = null;
let originalMaterials = new Map();
let currentFileName = "Sin Archivo";
let currentModelUrl = null; // URL en Firebase
let raycaster, mouse;
let selectedObject = null;
let partsData = {};

// UI
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');
const notesInput = document.getElementById('notes-input');
const layersList = document.getElementById('layers-list');
const btnToggleLayers = document.getElementById('btn-toggle-all-layers');
const floatingLabel = document.getElementById('floating-label');
const techCard = document.getElementById('tech-card');
const dbMsg = document.getElementById('db-msg');
const btnOrig = document.getElementById('mode-original');
const btnClay = document.getElementById('mode-clay');
const btnWire = document.getElementById('mode-wire');

const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('part-details-content');
const emptyMsg = document.getElementById('empty-selection-msg');
const detailName = document.getElementById('detail-name');
const detailDesc = document.getElementById('detail-desc');
const detailDims = document.getElementById('detail-dims');
const detailWeight = document.getElementById('detail-weight');
const detailLink = document.getElementById('detail-link');
const detailImgZone = document.getElementById('detail-img-zone');
const detailImgInput = document.getElementById('detail-img-input');
const detailImgPreview = document.getElementById('detail-img-preview');
const imgPlaceholder = document.getElementById('img-placeholder-text');
const btnSaveDetail = document.getElementById('btn-save-detail');
const checkApplyBulk = document.getElementById('check-apply-bulk');

const btnScreenshot = document.getElementById('btn-screenshot');
const printImg = document.getElementById('print-snapshot');
const printDate = document.getElementById('print-date');
const printFile = document.getElementById('print-filename');
const printNotesDst = document.getElementById('print-notes-dest');
const printDetailsGrid = document.getElementById('print-details-section');

// PROJECTS MODAL
const btnOpenProjects = document.getElementById('btn-open-projects');
const projectsModal = document.getElementById('projects-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const projectListContainer = document.getElementById('project-list-container');

let controls;

init();
animate();

async function init() {
    const container = document.getElementById('scene-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.Fog(BG_COLOR, 50, 500);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100000);
    camera.position.set(10, 10, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2); scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
    dirLight.position.set(0, 0, 1);
    dirLight.castShadow = true;
    dirLight.shadow.bias = -0.0001;
    dirLight.shadow.normalBias = 0.02; // Mejor que bias puro para geometría curva
    camera.add(dirLight);
    scene.add(camera);

    const grid = new THREE.GridHelper(500, 50, 0x333333, 0x111111); grid.name = "floor_grid"; scene.add(grid);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.05; controls.update();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    window.addEventListener('dragover', (e) => { e.preventDefault(); loadingDiv.style.display = 'flex'; }, false);
    window.addEventListener('dragleave', (e) => { loadingDiv.style.display = 'none'; }, false);
    window.addEventListener('drop', (e) => { e.preventDefault(); loadingDiv.style.display = 'none'; if (e.dataTransfer.files[0]) handleNewFile(e.dataTransfer.files[0]); }, false);

    // Eventos
    setupModeButtons();
    setupDetailPanelLogic();
    setupTechCardLogic();
    setupLayersLogic();
    setupProjectManager();
    setupLightingControls(); // Nuevo control de luces

    // Actualizar botones a nuevas funciones
    // Actualizar botones a nuevas funciones
    if (btnScreenshot) btnScreenshot.onclick = downloadScreenshot;

    // Botón Imprimir
    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
        btnPrint.addEventListener('click', printTechnicalSheet);
    }

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
            if (selectedObject && techCard.style.display !== 'none') updateTechCardPosition();
        }
    });

    notesInput.addEventListener('change', () => { if (currentFileName !== "Sin Archivo") saveProjectData(currentFileName, partsData, notesInput.value); });

    // --- CHECK URL PARAMS FOR SHARED PROJECT ---
    const urlParams = new URLSearchParams(window.location.search);
    const sharedDocId = urlParams.get('project');

    if (sharedDocId) {
        console.log("🔗 Modo Compartido Detectado. Cargando:", sharedDocId);
        setReadOnlyMode();
        loadProjectByDocId(sharedDocId);
    }
    else {
        // --- NORMAL AUTO RESUME ---
        const lastFile = localStorage.getItem('lastProjectName');
        if (lastFile) {
            console.log("Intentando recuperar sesión remota:", lastFile);
            loadProjectByDocId(lastFile);
        } else {
            console.log("No active session found.");
        }
    }
}

// Nueva función de entrada: Gestiona Subida Cloud + Carga Local
// Nueva función de entrada: Gestiona Subida Fragmentada (Chunks) + Carga Local
async function handleNewFile(file) {
    currentFileName = file.name;
    loadingDiv.style.display = 'flex';
    loadingDiv.querySelector('p').innerText = "🔨 FRAGMENTANDO Y GUARDANDO...";

    // 1. Guardar como Chunks en Firestore (Bypass Storage)
    const result = await saveModelAsChunks(file, currentFileName);

    if (result.success) {
        localStorage.setItem('lastProjectName', currentFileName);
        // Guardar también datos vacíos iniciales
        await saveProjectData(currentFileName, partsData, notesInput.value);
    } else {
        alert("Atención: No se pudo guardar en la nube (¿Sin conexión?). Se usará solo en memoria.");
    }

    // 2. Cargar visualmente (usando blob local para rapidez)
    const blobUrl = URL.createObjectURL(file);
    loadGLB(blobUrl, currentFileName);
}

// Función para recargar desde URL remota
function loadModelFromURL(url) {
    loadingDiv.style.display = 'flex';
    loadingDiv.querySelector('p').innerText = "☁️ DESCARGANDO MODELO...";
    loadGLB(url, currentFileName);
}

function loadGLB(url, fileName) {
    const loader = new GLTFLoader();

    // Configurar Draco
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
    loader.setDRACOLoader(dracoLoader);

    loadingDiv.querySelector('p').innerText = "PROCESANDO GEOMETRÍA...";

    loader.load(url, async function (gltf) {
        if (currentModel) { scene.remove(currentModel); mixer = null; allActions = []; originalMaterials.clear(); hideLabel(); closeTechCard(); }

        partsData = {}; selectedObject = null; updateDetailPanel();

        const model = gltf.scene;
        currentModel = model;
        scene.add(model);

        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = true; obj.receiveShadow = true;
                if (obj.material) originalMaterials.set(obj.uuid, obj.material);
                obj.userData.originalName = obj.name;
            }
        });

        // --- NORMALIZATION ---
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        let scaleFactor = 1.0; if (maxDim > 0) scaleFactor = 10.0 / maxDim;
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);

        camera.position.set(12, 12, 12); controls.target.set(0, 0, 0); controls.update();

        loadingDiv.querySelector('p').innerText = "SINCRONIZANDO DB...";
        const cloudData = await loadProjectData(fileName);

        if (cloudData) {
            notesInput.value = cloudData.notes || "";
            const cloudParts = cloudData.parts || {};
            model.traverse((obj) => {
                if (obj.isMesh && cloudParts[obj.name]) { partsData[obj.uuid] = cloudParts[obj.name]; }
            });
            dbMsg.innerText = "Sincronizado con Nube ✅";
        } else { notesInput.value = ""; dbMsg.innerText = "Proyecto Nuevo"; }

        generateLayersUI(model);
        loadingDiv.style.display = 'none'; document.getElementById('system-status').innerText = `Modelo: ${fileName}`;

        if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model); allActions = [];
            gltf.animations.forEach(clip => { const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; action.play(); allActions.push(action); });
            allActions.forEach(a => a.time = 0); mixer.update(0);
        }
        // No revoke URL if it's remote, but check if local blob
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);

        setTimeout(() => { btnClay.click(); }, 150);

    }, undefined, (err) => { console.error(err); });
}

function generateLayersUI(model) {
    layersList.innerHTML = '';
    const objects = [];
    model.traverse(child => { if (child.isMesh) objects.push(child); });
    if (objects.length === 0) { layersList.innerHTML = '<p style="font-size:0.7rem; color:#666">No se detectaron capas.</p>'; return; }

    objects.sort((a, b) => a.name.localeCompare(b.name));

    const groups = {};
    objects.forEach(obj => {
        const baseName = obj.name.replace(/[._]?\d+$/, '');
        if (!groups[baseName]) groups[baseName] = [];
        groups[baseName].push(obj);
    });

    Object.keys(groups).sort().forEach(baseName => {
        const groupObjs = groups[baseName];
        if (groupObjs.length > 1) {
            const groupDiv = document.createElement('div'); groupDiv.className = 'layer-group';
            const header = document.createElement('div'); header.className = 'layer-group-header';
            const toggleIcon = document.createElement('span'); toggleIcon.className = 'group-toggle-icon'; toggleIcon.innerText = '▶';
            const check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.className = 'layer-check';
            const title = document.createElement('span'); title.className = 'group-title';
            title.innerText = `${baseName} (${groupObjs.length})`;

            header.onclick = (e) => { if (e.target === check) return; content.classList.toggle('open'); toggleIcon.classList.toggle('open'); };
            check.onchange = (e) => { const state = e.target.checked; groupObjs.forEach(obj => obj.visible = state); content.querySelectorAll('input').forEach(chk => chk.checked = state); };

            header.append(toggleIcon, check, title);
            const content = document.createElement('div'); content.className = 'layer-group-content';
            groupObjs.forEach(obj => { content.appendChild(createLayerItem(obj, false)); });
            groupDiv.append(header, content);
            layersList.appendChild(groupDiv);
        } else {
            layersList.appendChild(createLayerItem(groupObjs[0], true));
        }
    });
}

function createLayerItem(obj, isRoot) {
    const div = document.createElement('div'); div.className = 'layer-item';
    div.dataset.uuid = obj.uuid;
    if (isRoot) div.style.paddingLeft = '4px';

    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = obj.visible;
    if (isRoot) checkbox.className = 'layer-check';
    checkbox.onchange = (e) => { obj.visible = e.target.checked; };

    const displayName = (partsData[obj.uuid] && partsData[obj.uuid].customName) ? partsData[obj.uuid].customName : obj.name;
    const label = document.createElement('span'); label.className = 'layer-name';
    label.innerText = displayName || "Sin Nombre";

    // --- ENABLE DIRECT EDITING (Double Click) ---
    label.title = "Doble click para editar nombre";
    label.ondblclick = (e) => {
        e.stopPropagation();
        label.contentEditable = true;
        label.focus();
        label.classList.add('editing');
    };
    label.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            label.blur();
        }
    };
    label.onblur = async () => {
        label.contentEditable = false;
        label.classList.remove('editing');
        const newName = label.innerText.trim();
        if (newName && newName !== displayName) {
            // Update logic (simulated "Save Detail" btn click logic)
            const mainStableName = obj.userData.originalName || obj.name;
            partsData[obj.uuid] = { ...(partsData[obj.uuid] || {}), customName: newName, stableName: mainStableName };

            // Sync to tech card if selected
            if (selectedObject === obj) {
                detailName.value = newName;
                document.getElementById('card-title').innerText = newName;
            }

            // Save to DB
            const partsForCloud = {}; Object.values(partsData).forEach(p => { if (p.stableName) partsForCloud[p.stableName] = p; });
            dbMsg.innerText = "Guardando...";
            await saveProjectData(currentFileName, partsForCloud, notesInput.value);
            dbMsg.innerText = "Actualizado ✅";
        }
    };

    div.appendChild(checkbox); div.appendChild(label);
    return div;
}

function updateLayerNameInList(uuid, newName) {
    const layerItem = layersList.querySelector(`.layer-item[data-uuid="${uuid}"]`);
    if (layerItem) {
        const label = layerItem.querySelector('.layer-name');
        if (label) {
            label.innerText = newName;
            label.style.color = "#00f0ff";
            setTimeout(() => { label.style.color = ""; }, 800);
        }
    }
}

function setupLayersLogic() {
    btnToggleLayers.onclick = () => {
        const checkboxes = layersList.querySelectorAll('.layer-check');
        if (checkboxes.length === 0) return;
        const firstState = checkboxes[0].checked; const newState = !firstState;
        checkboxes.forEach(cb => { cb.checked = newState; cb.dispatchEvent(new Event('change')); });
        btnToggleLayers.innerText = newState ? '👁️' : '🚫';
    };
}

function onPointerDown(event) {
    if (!currentModel) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(currentModel, true);

    if (intersects.length > 0) {
        const hit = intersects.find(h => h.object.visible && h.object.type !== "GridHelper");
        if (!hit) return;
        selectedObject = hit.object; updateDetailPanel();
        const mat = hit.object.material;
        if (mat && mat.emissive) { const oldEmissive = mat.emissive.getHex(); mat.emissive.setHex(0x00ffff); setTimeout(() => mat.emissive.setHex(oldEmissive), 300); }
        const data = partsData[selectedObject.uuid];
        if (data && (data.desc || data.img || data.customName || data.dims || data.weight || data.link)) { showTechCard(selectedObject); }
        else { closeTechCard(); showLabel(event.clientX, event.clientY, hit.object.name || "Objeto"); }
    } else { hideLabel(); }
}

function setupTechCardLogic() { document.getElementById('close-card-btn').onclick = closeTechCard; }

function showTechCard(object) {
    if (!object) return;
    const data = partsData[object.uuid];
    if (!data) return;
    hideLabel();
    document.getElementById('card-title').innerText = data.customName || object.name;
    const imgBox = document.getElementById('card-img');
    const descBox = document.getElementById('card-desc');
    document.getElementById('card-dims').innerText = data.dims || '-';
    document.getElementById('card-weight').innerText = data.weight || '-';
    if (data.img) { imgBox.src = data.img; imgBox.parentElement.style.display = 'block'; } else { imgBox.parentElement.style.display = 'none'; imgBox.src = ""; }
    descBox.innerText = data.desc || "Sin descripción.";
    const btnLink = document.getElementById('card-link');
    if (data.link && data.link.startsWith('http')) { btnLink.href = data.link; btnLink.style.display = 'block'; } else { btnLink.style.display = 'none'; }
    techCard.style.display = 'block'; void techCard.offsetWidth; techCard.classList.add('visible');
    updateTechCardPosition();
}
function closeTechCard() { techCard.classList.remove('visible'); setTimeout(() => { if (!techCard.classList.contains('visible')) techCard.style.display = 'none'; }, 300); }
function updateTechCardPosition() {
    if (!selectedObject || techCard.style.display === 'none') return;
    const pos = new THREE.Vector3(); selectedObject.getWorldPosition(pos); pos.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const x = (pos.x * .5 + .5) * rect.width + rect.left; const y = (-(pos.y * .5) - .5) * rect.height + rect.top + rect.height;
    const cardH = techCard.offsetHeight; const cardW = techCard.offsetWidth;
    techCard.style.left = (x - cardW / 2) + 'px'; techCard.style.top = (y - cardH - 20) + 'px';
}

function setupDetailPanelLogic() {
    detailImgZone.onclick = () => detailImgInput.click();
    detailImgInput.onchange = (e) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onload = (evt) => { setDetailImage(evt.target.result); }; reader.readAsDataURL(e.target.files[0]); } };
    window.addEventListener('paste', (e) => { if (!selectedObject) return; if (e.clipboardData && e.clipboardData.items) { for (let i = 0; i < e.clipboardData.items.length; i++) { if (e.clipboardData.items[i].type.indexOf("image") !== -1) { const blob = e.clipboardData.items[i].getAsFile(); const reader = new FileReader(); reader.onload = (evt) => setDetailImage(evt.target.result); reader.readAsDataURL(blob); break; } } } });

    btnSaveDetail.onclick = async () => {
        if (!selectedObject) return;
        const mainUUID = selectedObject.uuid; const mainStableName = selectedObject.userData.originalName || selectedObject.name;
        const newData = { customName: detailName.value, desc: detailDesc.value, dims: detailDims.value, weight: detailWeight.value, link: detailLink.value, img: detailImgPreview.src !== window.location.href ? detailImgPreview.src : null, stableName: mainStableName };
        partsData[mainUUID] = newData; updateLayerNameInList(mainUUID, newData.customName);
        if (checkApplyBulk.checked) {
            const baseName = mainStableName.replace(/\.\d{3}$/, '');
            currentModel.traverse((obj) => {
                if (obj.isMesh && obj.uuid !== mainUUID) {
                    const objStableName = obj.userData.originalName || obj.name;
                    if (objStableName.startsWith(baseName)) { partsData[obj.uuid] = { ...newData }; partsData[obj.uuid].stableName = objStableName; updateLayerNameInList(obj.uuid, newData.customName); }
                }
            });
        }
        const partsForCloud = {}; Object.values(partsData).forEach(p => { if (p.stableName) partsForCloud[p.stableName] = p; });
        btnSaveDetail.innerText = "☁️ GUARDANDO..."; const success = await saveProjectData(currentFileName, partsForCloud, notesInput.value);
        if (success) { btnSaveDetail.innerText = "✅ GUARDADO"; dbMsg.innerText = "Guardado OK"; } else { btnSaveDetail.innerText = "❌ ERROR DB"; }
        setTimeout(() => btnSaveDetail.innerText = "💾 GUARDAR", 2000);
    };
}

function setDetailImage(src) { if (!src) { detailImgPreview.style.display = 'none'; detailImgPreview.src = ''; imgPlaceholder.style.display = 'block'; } else { detailImgPreview.src = src; detailImgPreview.style.display = 'block'; imgPlaceholder.style.display = 'none'; } }
function updateDetailPanel() {
    if (!selectedObject) { detailContent.style.display = 'none'; emptyMsg.style.display = 'block'; return; }
    detailContent.style.display = 'block'; emptyMsg.style.display = 'none'; const uuid = selectedObject.uuid;
    if (partsData[uuid]) { detailName.value = partsData[uuid].customName || selectedObject.name; detailDesc.value = partsData[uuid].desc || ""; detailDims.value = partsData[uuid].dims || ""; detailWeight.value = partsData[uuid].weight || ""; detailLink.value = partsData[uuid].link || ""; setDetailImage(partsData[uuid].img); }
    else { detailName.value = selectedObject.name; detailDesc.value = ""; detailDims.value = ""; detailWeight.value = ""; detailLink.value = ""; setDetailImage(null); }
    checkApplyBulk.checked = false;
}
function showLabel(x, y, text) { floatingLabel.innerText = text; floatingLabel.style.display = 'block'; const labelW = floatingLabel.offsetWidth; const labelH = floatingLabel.offsetHeight; floatingLabel.style.left = (x - labelW / 2) + 'px'; floatingLabel.style.top = (y - labelH - 10) + 'px'; floatingLabel.style.opacity = 0; setTimeout(() => floatingLabel.style.opacity = 1, 10); }
function hideLabel() { floatingLabel.style.display = 'none'; }

function setupModeButtons() {
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
                    let randColor;
                    if (colorMap.has(obj.uuid)) { randColor = colorMap.get(obj.uuid); }
                    else {
                        // PASTEL RANDOM ORIGINAL
                        const h = Math.random();
                        const s = 0.5 + Math.random() * 0.2;
                        const l = 0.6 + Math.random() * 0.2;
                        randColor = new THREE.Color().setHSL(h, s, l);
                        colorMap.set(obj.uuid, randColor);
                    }
                    obj.material = new THREE.MeshStandardMaterial({
                        color: randColor,
                        roughness: 0.8,
                        metalness: 0.1
                    });
                }
                else if (mode === 'WIRE') { obj.material = matWire; }
            }
        });
    };
    btnOrig.onclick = () => setMode('ORIG'); btnClay.onclick = () => setMode('CLAY'); btnWire.onclick = () => setMode('WIRE');
}

function downloadScreenshot() {
    if (!renderer) return;
    // Configurar escena para captura limpia
    const oldBg = scene.background;
    const oldFog = scene.fog;
    const grid = scene.getObjectByName('floor_grid');
    const wasVisible = techCard ? techCard.classList.contains('visible') : false;

    closeTechCard();
    if (grid) grid.visible = false;
    scene.background = null; // Transparente 
    scene.fog = null;

    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');

    // Restaurar escena
    scene.background = oldBg;
    scene.fog = oldFog;
    if (grid) grid.visible = true;
    if (wasVisible) showTechCard(selectedObject);

    // Descargar
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = `Vista_${currentFileName.replace('.glb', '')}.png`;
    link.click();
}

function printTechnicalSheet() {
    if (!renderer) return;

    // 1. CAPTURAR IMAGEN (Igual que screenshot pero guardándola en el DOM)
    const oldBg = scene.background; const oldFog = scene.fog; const grid = scene.getObjectByName('floor_grid');
    const wasVisible = techCard ? techCard.classList.contains('visible') : false; closeTechCard();
    if (grid) grid.visible = false; scene.background = null; scene.fog = null;
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    scene.background = oldBg; scene.fog = oldFog; if (grid) grid.visible = true; if (wasVisible) showTechCard(selectedObject);

    // 2. LLENAR DATOS DE FICHA
    printImg.src = dataURL;
    printFile.textContent = currentFileName.replace('.glb', '').replace(/_/g, ' ');
    printDate.textContent = new Date().toLocaleDateString();

    const sharedLink = window.location.origin + window.location.pathname + "?project=" + sanitizeName(currentFileName);

    // Preparar contenedor de notas limpio
    printNotesDst.innerHTML = `
        <strong>Observaciones:</strong><br>${notesInput.value.trim() || "Sin observaciones registradas."}<br><br>
        <div style="font-size:0.75em; color:#666;">
            🔗 Enlace Digital: ${sharedLink}
        </div>
    `;

    // Generar QR Real en el FOOTER
    const qrContainer = document.getElementById('print-footer-qr');
    if (qrContainer && window.QRCode) {
        qrContainer.innerHTML = ""; // Limpiar previos
        new QRCode(qrContainer, {
            text: sharedLink,
            width: 128,
            height: 128,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // 3. GENERAR GRILLA DE PARTES
    printDetailsGrid.innerHTML = '';
    const printedNames = new Set();
    const keys = Object.keys(partsData);

    if (keys.length > 0) {
        keys.forEach(uuid => {
            const part = partsData[uuid];
            // Filtrar: Solo mostrar partes que tengan INFO relevante (Nombre custom, desc, dimensiones, etc)
            if (!part.customName && !part.desc && !part.dims) return;

            const nameToUse = part.customName || part.stableName;
            if (printedNames.has(nameToUse)) return;
            printedNames.add(nameToUse);

            const card = document.createElement('div');
            card.className = 'print-card';

            const imgHTML = part.img ? `<img src="${part.img}">` : '<div style="width:80px;height:80px;background:#eee;display:flex;align-items:center;justify-content:center;">📷</div>';

            let metaHTML = '';
            if (part.dims || part.weight) metaHTML = `<div class="print-card-meta">${part.dims ? `📏 ${part.dims} ` : ''} ${part.weight ? `⚖️ ${part.weight}` : ''}</div>`;
            const linkHTML = part.link ? `<a href="${part.link}" class="print-card-link" target="_blank">🛒 Ver Proveedor</a>` : '';

            card.innerHTML = `${imgHTML}<div class="print-card-content"><div class="print-card-title">${nameToUse}</div><div class="print-card-desc">${part.desc || 'Sin descripción'}</div>${metaHTML}${linkHTML}</div>`;
            printDetailsGrid.appendChild(card);
        });
    } else {
        printDetailsGrid.innerHTML = '<p style="padding:20px; color:#999; text-align:center; width:100%;">No hay piezas con información registrada para mostrar.</p>';
    }

    // 4. IMPRIMIR (Con retardo para asegurar renderizado)
    setTimeout(() => {
        window.print();
    }, 500);
}
function onWindowResize() { const container = document.getElementById('scene-container'); if (!container) return; camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); }

function setupProjectManager() {
    btnOpenProjects.onclick = async () => {
        projectsModal.style.display = 'flex';
        projectListContainer.innerHTML = '<p style="color:#aaa; text-align:center; padding:20px;">Cargando proyectos...</p>';
        const projects = await getAllProjects();
        renderProjectList(projects);
    };

    btnCloseModal.onclick = () => { projectsModal.style.display = 'none'; };

    // Close on click outside
    projectsModal.addEventListener('click', (e) => {
        if (e.target === projectsModal) projectsModal.style.display = 'none';
    });
}

function renderProjectList(projects) {
    projectListContainer.innerHTML = '';
    if (projects.length === 0) {
        projectListContainer.innerHTML = '<p style="color:#aaa; text-align:center;">No hay proyectos guardados aún.</p>';
        return;
    }

    projects.forEach(p => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.style.cursor = 'default';

        const dateStr = new Date(p.lastUpdate).toLocaleString();

        card.innerHTML = `
            <div class="project-info">
                <h4>${p.fileName}</h4>
                <p>📅 ${dateStr}</p>
                <p>📝 ${p.notes ? p.notes.substring(0, 30) + '...' : 'Sin notas'}</p>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                <button class="btn-share-proj" style="background:none; border:none; cursor:pointer;" title="Copiar Link para Compartir">🔗</button>
                <button class="btn-load-proj">ABRIR</button>
                <button class="btn-del-proj" style="background:none; border:none; cursor:pointer;" title="Eliminar">🗑️</button>
            </div>
        `;

        // Share Listener
        const btnShare = card.querySelector('.btn-share-proj');
        btnShare.onclick = (e) => {
            e.stopPropagation();
            const url = window.location.origin + window.location.pathname + "?project=" + p.docId;
            navigator.clipboard.writeText(url).then(() => {
                alert("🔗 Link copiado al portapapeles:\n" + url);
            });
        };

        // Load listener (Load Btn)
        const btnLoad = card.querySelector('.btn-load-proj');
        btnLoad.onclick = (e) => {
            projectsModal.style.display = 'none';
            localStorage.setItem('lastProjectName', p.docId);
            loadingDiv.style.display = 'flex';
            loadingDiv.querySelector('p').innerText = "🔄 CAMBIANDO PROYECTO...";
            loadProjectByDocId(p.docId);
        };

        // Delete listener (Trash Btn)
        const btnDel = card.querySelector('.btn-del-proj');
        btnDel.onclick = async (e) => {
            if (confirm(`¿ELIMINAR PROYECTO?\n"${p.fileName}"\n\nEsta acción no se puede deshacer.`)) {
                btnDel.innerText = "⏳";
                const success = await deleteProject(p.docId);
                if (success) {
                    card.style.opacity = '0';
                    setTimeout(() => {
                        card.remove();
                        if (projectListContainer.children.length === 0) {
                            projectListContainer.innerHTML = '<p style="color:#aaa; text-align:center;">No hay proyectos guardados aún.</p>';
                        }
                    }, 300);
                } else {
                    alert("Error: No se pudo eliminar.");
                    btnDel.innerText = "🗑️";
                }
            }
        };

        projectListContainer.appendChild(card);
    });
}

function setReadOnlyMode() {
    // Hide administrative controls
    if (btnOpenProjects) btnOpenProjects.style.display = 'none';

    // Disable Drag & Drop
    document.body.ondrop = (e) => { e.preventDefault(); alert("🚫 Modo Solo Lectura: No se pueden subir nuevos archivos."); };

    // Update UI title
    document.querySelector('.logo').innerHTML += ' <span style="font-size:0.7em; color:#aaa;">(VIEWER)</span>';

    console.log("🔒 Modo Solo Lectura Activado");
}

async function loadProjectByDocId(docId) {
    const data = await loadProjectData(docId);
    if (data) {
        currentFileName = data.fileName;
        loadingDiv.querySelector('p').innerText = "🧩 CARGANDO " + currentFileName + "...";

        if (data.storageMode === 'firestore_chunks' || (!data.modelUrl && data.totalChunks)) {
            const b64Data = await loadModelFromChunks(docId);
            if (b64Data) loadGLB(b64Data, currentFileName);
        }
        else if (data.modelUrl) {
            loadModelFromURL(data.modelUrl);
        }
    }
}

// --- ILUMINACIÓN (V5.15) ---
function setupLightingControls() {
    const lightingSelect = document.getElementById('lighting-select');
    if (lightingSelect) {
        lightingSelect.addEventListener('change', (e) => {
            updateLighting(e.target.value);
        });
    }
}

function updateLighting(mode) {
    // 1. Limpiar luces existentes (excepto Grid y Helpers si los hubiera)

    // Resetear environment
    scene.environment = null;
    renderer.toneMappingExposure = 1.2;

    // Buscar y eliminar luces antiguas (por nombre o tipo)
    const lightsToRemove = [];
    scene.traverse((obj) => {
        if (obj.isLight || (obj.name && obj.name.startsWith("studio_"))) {
            lightsToRemove.push(obj);
        }
    });
    // También la luz de cámara
    camera.children.forEach(child => {
        if (child.isLight) camera.remove(child);
    });
    lightsToRemove.forEach(l => scene.remove(l));


    // 2. Aplicar nuevo modo
    if (mode === 'inspection') {
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
        scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
        dirLight.position.set(0, 0, 1);
        dirLight.castShadow = true;
        // Configs de sombra
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.bias = -0.0001;
        camera.add(dirLight); // Luz pegada a la cámara
    }
    else if (mode === 'studio') {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambient);

        // Key Light
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
        keyLight.position.set(5, 10, 7);
        keyLight.castShadow = true;
        keyLight.name = "studio_key";
        scene.add(keyLight);

        // Fill Light
        const fillLight = new THREE.DirectionalLight(0xccddff, 1.0);
        fillLight.position.set(-5, 5, 5);
        fillLight.name = "studio_fill";
        scene.add(fillLight);

        // Rim Light
        const rimLight = new THREE.DirectionalLight(0xffaa00, 1.0);
        rimLight.position.set(0, 5, -10);
        rimLight.name = "studio_rim";
        scene.add(rimLight);
    }
    else if (mode === 'env') {
        // RoomEnvironment
        const pmremGenerator = new PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();
        const roomEnvironment = new RoomEnvironment();
        scene.environment = pmremGenerator.fromScene(roomEnvironment).texture;
        // Opcional: bajar un poco exposición si brilla mucho
        renderer.toneMappingExposure = 1.0;
    }
}

function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); if (selectedObject && techCard.classList.contains('visible')) updateTechCardPosition(); }
