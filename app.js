import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { saveProjectData, loadProjectData } from './db_manager.js';

// --- CONFIG ---
const BG_COLOR = 0x0f1115;

// --- GLOBALS ---
let camera, scene, renderer, mixer;
let allActions = [];
let currentModel = null;
let originalMaterials = new Map();
let currentFileName = "Sin Archivo";
let raycaster, mouse;
let selectedObject = null;
let partsData = {}; // { uuid: {name, desc, img, stableName, customName, dims, weight, link} }

// UI
const loadingDiv = document.getElementById('loading-overlay');
const slider = document.getElementById('explosion-slider');
const sliderVal = document.getElementById('slider-val');
const notesInput = document.getElementById('notes-input');
const layersList = document.getElementById('layers-list');
const btnToggleLayers = document.getElementById('btn-toggle-all-layers'); // V5.4
const floatingLabel = document.getElementById('floating-label');
const techCard = document.getElementById('tech-card');
const dbMsg = document.getElementById('db-msg');

// Detail Panel
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
const checkApplyBulk = document.getElementById('check-apply-bulk'); // V5.4

// Print
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
    window.addEventListener('drop', (e) => { e.preventDefault(); loadingDiv.style.display = 'none'; if (e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]); }, false);

    setupModeButtons();
    setupDetailPanelLogic();
    setupTechCardLogic();
    setupLayersLogic(); // V5.4

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
            if (selectedObject && techCard.style.display !== 'none') updateTechCardPosition();
        }
    });

    notesInput.addEventListener('change', () => { if (currentFileName !== "Sin Archivo") saveProjectData(currentFileName, partsData, notesInput.value); });
}

function loadLocalFile(file) {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    currentFileName = file.name;
    loadingDiv.style.display = 'flex'; loadingDiv.querySelector('p').innerText = "CARGANDO MODELO...";

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
                obj.userData.originalName = obj.name; // IMPORTANTE
            }
        });

        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3())); const size = box.getSize(new THREE.Vector3()); model.position.y += size.y * 0.1;

        loadingDiv.querySelector('p').innerText = "SINCRONIZANDO DB...";
        const cloudData = await loadProjectData(currentFileName);

        if (cloudData) {
            notesInput.value = cloudData.notes || "";
            const cloudParts = cloudData.parts || {};
            model.traverse((obj) => {
                if (obj.isMesh && cloudParts[obj.name]) {
                    partsData[obj.uuid] = cloudParts[obj.name];
                }
            });
            dbMsg.innerText = "Sincronizado con Nube ✅";
        } else {
            notesInput.value = "";
            dbMsg.innerText = "Proyecto Nuevo";
        }

        // GENERAR CAPAS DESPUÉS DE CARGAR DATOS (Para nombres custom)
        generateLayersUI(model);

        loadingDiv.style.display = 'none'; document.getElementById('system-status').innerText = `Modelo: ${file.name}\nSize: ${size.x.toFixed(2)}x${size.y.toFixed(2)}`;

        if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model); allActions = [];
            gltf.animations.forEach(clip => { const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; action.play(); allActions.push(action); });
            allActions.forEach(a => a.time = 0); mixer.update(0);
        }
        URL.revokeObjectURL(url);
    }, undefined, (err) => { console.error(err); });
}

// V5.4 - Capas Dinámicas y Toggle
function generateLayersUI(model) {
    layersList.innerHTML = '';
    const objects = [];
    model.traverse(child => { if (child.isMesh) objects.push(child); }); // Solo meshes para simplificar lista

    if (objects.length === 0) { layersList.innerHTML = '<p style="font-size:0.7rem; color:#666">No se detectaron capas.</p>'; return; }

    // Sort by name
    objects.sort((a, b) => a.name.localeCompare(b.name));

    objects.forEach(obj => {
        const div = document.createElement('div'); div.className = 'layer-item';
        div.dataset.uuid = obj.uuid; // Para actualizar nombre luego

        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = obj.visible;
        checkbox.className = 'layer-check';
        checkbox.onchange = (e) => { obj.visible = e.target.checked; };

        // Usar customName si existe
        const displayName = (partsData[obj.uuid] && partsData[obj.uuid].customName) ? partsData[obj.uuid].customName : obj.name;

        const label = document.createElement('span'); label.className = 'layer-name';
        label.innerText = displayName || "Sin Nombre";

        div.appendChild(checkbox); div.appendChild(label); layersList.appendChild(div);

        // Click en nombre selecciona el objeto
        label.onclick = () => {
            // Simular click
            // selectedObject = obj; updateDetailPanel();
            // (Opcional, no implementado para no interferir con la lógica de raycast compleja)
        };
    });
}

function updateLayerNameInList(uuid, newName) {
    const item = layersList.querySelector(`.layer-item[data-uuid="${uuid}"] .layer-name`);
    if (item) item.innerText = newName;
}

function setupLayersLogic() {
    btnToggleLayers.onclick = () => {
        const checkboxes = layersList.querySelectorAll('.layer-check');
        if (checkboxes.length === 0) return;

        // Determinar estado: si la primera está on, apagar todo. Si off, encender todo.
        const firstState = checkboxes[0].checked;
        const newState = !firstState;

        checkboxes.forEach(cb => {
            cb.checked = newState;
            cb.dispatchEvent(new Event('change')); // Disparar lógica de visibilidad
        });

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
        // Encontrar el primer objeto visible
        const hit = intersects.find(h => h.object.visible);
        if (!hit) return;

        selectedObject = hit.object;
        updateDetailPanel();

        const mat = hit.object.material;
        if (mat && mat.emissive) {
            const oldEmissive = mat.emissive.getHex(); mat.emissive.setHex(0x00ffff); setTimeout(() => mat.emissive.setHex(oldEmissive), 300);
        }

        const data = partsData[selectedObject.uuid];
        if (data && (data.desc || data.img || data.customName || data.dims || data.weight || data.link)) {
            showTechCard(selectedObject);
        } else {
            closeTechCard();
            showLabel(event.clientX, event.clientY, hit.object.name || "Objeto");
        }
    } else {
        hideLabel();
    }
}

// --- TECH CARD LOGIC ---
function setupTechCardLogic() {
    document.getElementById('close-card-btn').onclick = closeTechCard;
}

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

    if (data.img) { imgBox.src = data.img; imgBox.parentElement.style.display = 'block'; }
    else { imgBox.parentElement.style.display = 'none'; imgBox.src = ""; }

    descBox.innerText = data.desc || "Sin descripción.";

    const btnLink = document.getElementById('card-link');
    if (data.link && data.link.startsWith('http')) {
        btnLink.href = data.link; btnLink.style.display = 'block';
    } else {
        btnLink.style.display = 'none';
    }

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
    window.addEventListener('paste', (e) => {
        if (!selectedObject) return;
        if (e.clipboardData && e.clipboardData.items) { for (let i = 0; i < e.clipboardData.items.length; i++) { if (e.clipboardData.items[i].type.indexOf("image") !== -1) { const blob = e.clipboardData.items[i].getAsFile(); const reader = new FileReader(); reader.onload = (evt) => setDetailImage(evt.target.result); reader.readAsDataURL(blob); break; } } }
    });

    // GUARDAR V5.4 SMART BATCH
    btnSaveDetail.onclick = async () => {
        if (!selectedObject) return;

        const mainUUID = selectedObject.uuid;
        const mainStableName = selectedObject.userData.originalName || selectedObject.name;

        // Datos a guardar
        const newData = {
            customName: detailName.value,
            desc: detailDesc.value,
            dims: detailDims.value,
            weight: detailWeight.value,
            link: detailLink.value,
            img: detailImgPreview.src !== window.location.href ? detailImgPreview.src : null,
            stableName: mainStableName
        };

        // 1. Guardar objeto principal
        partsData[mainUUID] = newData;
        updateLayerNameInList(mainUUID, newData.customName); // Actualizar UI Capas

        // 2. Lógica SMART BATCH
        if (checkApplyBulk.checked) {
            // Extraer nombre base (ej: "Banderas.001" -> "Banderas")
            // Regex: Quitar suffix numérico .001, .002
            const baseName = mainStableName.replace(/\.\d{3}$/, '');

            let count = 0;
            currentModel.traverse((obj) => {
                if (obj.isMesh && obj.uuid !== mainUUID) {
                    const objStableName = obj.userData.originalName || obj.name;
                    // Comprobar si empieza igual (ej "Banderas.002" empieza por "Banderas")
                    if (objStableName.startsWith(baseName)) {
                        // CLONAR DATOS
                        partsData[obj.uuid] = { ...newData }; // Copia objeto
                        partsData[obj.uuid].stableName = objStableName; // Mantener SU nombre técnico
                        // Opcional: ¿Queremos que herede el customName exacto "Bandera Roja" o "Bandera Roja (Copia)"?
                        // Por ahora exacto, el usuario pidió agrupar.

                        updateLayerNameInList(obj.uuid, newData.customName);
                        count++;
                    }
                }
            });
            console.log(`Smart Batch: Aplicado a ${count} copias.`);
        }

        // 3. Preparar para Nube (Key = stableName)
        const partsForCloud = {};
        Object.values(partsData).forEach(p => { if (p.stableName) partsForCloud[p.stableName] = p; });

        btnSaveDetail.innerText = "☁️ GUARDANDO...";
        const success = await saveProjectData(currentFileName, partsForCloud, notesInput.value);

        if (success) {
            btnSaveDetail.innerText = "✅ GUARDADO"; dbMsg.innerText = "Guardado OK";
        } else {
            btnSaveDetail.innerText = "❌ ERROR DB";
        }
        setTimeout(() => btnSaveDetail.innerText = "💾 GUARDAR", 2000);
    };
}

function setDetailImage(src) {
    if (!src) { detailImgPreview.style.display = 'none'; detailImgPreview.src = ''; imgPlaceholder.style.display = 'block'; }
    else { detailImgPreview.src = src; detailImgPreview.style.display = 'block'; imgPlaceholder.style.display = 'none'; }
}

function updateDetailPanel() {
    if (!selectedObject) { detailContent.style.display = 'none'; emptyMsg.style.display = 'block'; return; }
    detailContent.style.display = 'block'; emptyMsg.style.display = 'none';
    const uuid = selectedObject.uuid;

    if (partsData[uuid]) {
        detailName.value = partsData[uuid].customName || selectedObject.name;
        detailDesc.value = partsData[uuid].desc || "";
        detailDims.value = partsData[uuid].dims || "";
        detailWeight.value = partsData[uuid].weight || "";
        detailLink.value = partsData[uuid].link || "";
        setDetailImage(partsData[uuid].img);
    } else {
        detailName.value = selectedObject.name;
        detailDesc.value = "";
        detailDims.value = "";
        detailWeight.value = "";
        detailLink.value = "";
        setDetailImage(null);
    }
    // Reset Checkbox warning
    checkApplyBulk.checked = false;
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
    // Screenshot logic (sin cambios mayores)
    if (!renderer) return;
    const oldBg = scene.background; const oldFog = scene.fog; const grid = scene.getObjectByName('floor_grid');
    const wasVisible = techCard.classList.contains('visible');
    closeTechCard();

    if (grid) grid.visible = false; scene.background = null; scene.fog = null;
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    scene.background = oldBg; scene.fog = oldFog; if (grid) grid.visible = true;
    if (wasVisible) showTechCard(selectedObject);

    printImg.src = dataURL; printFile.textContent = currentFileName; printDate.textContent = new Date().toLocaleDateString();
    printNotesDst.innerText = notesInput.value.trim() || "Sin observaciones generales.";

    printDetailsGrid.innerHTML = '';

    // FILTRO UNICOS PARA PRINT: Si aplicamos bulk, habrá 5 "Banderas". ¿Imprimimos 5?
    // Mejor agrupar por Custom Name para no spamear el PDF.
    const printedNames = new Set();

    const keys = Object.keys(partsData);
    if (keys.length > 0) {
        keys.forEach(uuid => {
            const part = partsData[uuid];
            if (!part.customName && !part.desc) return;

            const nameToUse = part.customName || part.stableName;
            if (printedNames.has(nameToUse)) return; // Evitar duplicados en PDF

            printedNames.add(nameToUse);

            const card = document.createElement('div'); card.className = 'print-card';
            const imgHTML = part.img ? `<img src="${part.img}">` : '';

            let metaHTML = '';
            if (part.dims || part.weight) metaHTML = `<div class="print-card-meta">${part.dims ? `📏 ${part.dims} ` : ''} ${part.weight ? `⚖️ ${part.weight}` : ''}</div>`;
            const linkHTML = part.link ? `<a href="${part.link}" class="print-card-link" target="_blank">🛒 Ver Link de Compra</a>` : '';

            card.innerHTML = `${imgHTML}<div class="print-card-content"><div class="print-card-title">${nameToUse}</div><div class="print-card-desc">${part.desc}</div>${metaHTML}${linkHTML}</div>`;
            printDetailsGrid.appendChild(card);
        });
    }
    alert("Captura Transparente Lista.\nFichas agrupadas por nombre.");
}

function onWindowResize() {
    const container = document.getElementById('scene-container');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}
function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); if (selectedObject && techCard.classList.contains('visible')) updateTechCardPosition(); }
