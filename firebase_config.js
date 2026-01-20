// --- CONFIGURACIÓN DE FIREBASE ---
// 1. Ve a https://console.firebase.google.com/
// 2. Crea un proyecto nuevo.
// 3. Ve a "Configuración del Proyecto" > "General" > "Tus apps" > "Web" (icono </>)
// 4. Copia el objeto 'firebaseConfig' y pégalo aquí abajo, reemplazando este bloque.

export const firebaseConfig = {
    apiKey: "GIVE_ME_YOUR_API_KEY",
    authDomain: "tu-proyecto.firebaseapp.com",
    projectId: "tu-proyecto",
    storageBucket: "tu-proyecto.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

// NOTA: Para que esto funcione, en Firebase Console debes:
// A. Ir a "Firestore Database" > Crear Base de Datos > Empezar en "Modo de prueba".
// B. (Opcional para fotos reales) Ir a "Storage" > Empezar en "Modo de prueba".
