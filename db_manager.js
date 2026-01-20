import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase_config.js";

// Inicializar
let db;
let isConnected = false;

try {
    if (firebaseConfig.apiKey !== "GIVE_ME_YOUR_API_KEY") {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        isConnected = true;
        console.log("🔥 Firebase Conectado");
    } else {
        console.warn("⚠️ Firebase no configurado en firebase_config.js");
    }
} catch (e) {
    console.error("Error iniciando Firebase:", e);
}

// FUNCIONES PÚBLICAS

export async function saveProjectData(fileName, partsData, globalNotes) {
    if (!isConnected) { alert("Base de Datos no conectada. Revisa la consola."); return; }

    // Usamos el nombre del archivo como ID del documento (limpiando caracteres raros)
    const docId = sanitizeName(fileName);

    try {
        await setDoc(doc(db, "proyectos_3d", docId), {
            fileName: fileName,
            lastUpdate: new Date().toISOString(),
            notes: globalNotes || "",
            parts: partsData // Guardamos todo el diccionario de piezas
        }, { merge: true });

        console.log("✅ Datos guardados en nube para:", fileName);
        return true;
    } catch (e) {
        console.error("Error guardando:", e);
        alert("Error al guardar en la nube: " + e.message);
        return false;
    }
}

export async function loadProjectData(fileName) {
    if (!isConnected) return null;

    const docId = sanitizeName(fileName);
    console.log("🔄 Buscando datos para:", docId);

    try {
        const docSnap = await getDoc(doc(db, "proyectos_3d", docId));
        if (docSnap.exists()) {
            console.log("📂 Datos encontrados!");
            return docSnap.data();
        } else {
            console.log("🆕 Proyecto nuevo (sin datos previos).");
            return null;
        }
    } catch (e) {
        console.error("Error cargando:", e);
        return null;
    }
}

function sanitizeName(name) {
    // Reemplazar ., /, espacios por guiones bajos
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}
