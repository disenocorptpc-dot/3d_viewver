import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, writeBatch, query, orderBy, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { firebaseConfig } from "./firebase_config.js";

// Inicializar
let db, storage;
let isConnected = false;

try {
    if (firebaseConfig.apiKey !== "GIVE_ME_YOUR_API_KEY") {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        storage = getStorage(app);
        isConnected = true;
        console.log("🔥 Firebase (DB + Storage) Conectado");
    } else {
        console.warn("⚠️ Firebase no configurado en firebase_config.js");
    }
} catch (e) {
    console.error("Error iniciando Firebase:", e);
}

// FUNCIONES PÚBLICAS

// --- SECUENCIA DE FRAGMENTACIÓN (CHUNKING) PARA FIRESTORE ---
const CHUNK_SIZE = 900 * 1024; // ~900KB

export async function saveModelAsChunks(file, rawFileName) {
    if (!isConnected || !db) return { success: false, error: "DB no conectada" };

    const docId = sanitizeName(rawFileName);
    console.log(`🔨 Fragmentando ${file.name} para proyecto ${docId}...`);

    try {
        // 1. Leer como Base64
        const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        // 2. Preparar chunks
        const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
        const batch = writeBatch(db);
        const projRef = doc(db, "proyectos_3d", docId);
        const chunksCol = collection(projRef, "chunks");

        // (Opcional: borrar antiguos si hubiera, para evitar mezclas. 
        //  Por ahora asumimos sobrescritura limpia o proyecto nuevo)

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = start + CHUNK_SIZE;
            const chunkContent = base64Data.substring(start, end);

            // ID: 000, 001... para asegurar orden por si acaso
            const chunkId = i.toString().padStart(4, '0');
            const chunkRef = doc(chunksCol, chunkId);

            batch.set(chunkRef, { index: i, data: chunkContent });
        }

        // 3. Ejecutar subida de chunks
        await batch.commit();

        // 4. Guardar metadatos base
        await setDoc(projRef, {
            fileName: rawFileName,
            totalChunks: totalChunks,
            storageMode: 'firestore_chunks', // Bandera clave
            lastUpdate: new Date().toISOString()
        }, { merge: true });

        console.log(`✅ ${totalChunks} fragmentos guardados en Firestore.`);
        return { success: true, docId: docId };

    } catch (e) {
        console.error("❌ Error guardando fragmentos:", e);
        return { success: false, error: e.message };
    }
}

export async function loadModelFromChunks(docId) {
    if (!isConnected) return null;
    try {
        console.log(`🧩 Reensamblando ${docId}...`);
        const chunksCol = collection(db, "proyectos_3d", docId, "chunks");
        const q = query(chunksCol, orderBy("index"));
        const snap = await getDocs(q);

        if (snap.empty) return null;

        let fullData = "";
        snap.forEach(d => fullData += d.data().data);

        console.log("✅ Reensamblaje completado.");
        return fullData; // data:application/octet-stream;base64,...

    } catch (e) {
        console.error("Error reensamblando:", e);
        return null;
    }
}

export async function saveProjectData(rawFileName, partsData, globalNotes) {
    if (!isConnected) return;
    const docId = sanitizeName(rawFileName);
    try {
        await setDoc(doc(db, "proyectos_3d", docId), {
            fileName: rawFileName,
            notes: globalNotes || "",
            parts: partsData,
            lastUpdate: new Date().toISOString()
        }, { merge: true });
        console.log("💾 Metadata actualizada.");
    } catch (e) {
        console.error("Error guardando metadata:", e);
    }
}

export async function loadProjectData(fileName) {
    if (!isConnected) return null;
    const docId = sanitizeName(fileName);
    try {
        const docSnap = await getDoc(doc(db, "proyectos_3d", docId));
        if (docSnap.exists()) return docSnap.data();
        return null;
    } catch (e) {
        console.error("Error cargando:", e);
        return null;
    }
}

function sanitizeName(name) {
    // Reemplazar ., /, espacios por guiones bajos
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}
