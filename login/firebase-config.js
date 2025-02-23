import { initializeApp } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-auth.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCWeULZAoUs36iOo6fKOK85uFmw-1WKXYs",
    authDomain: "map2-509e5.firebaseapp.com",
    databaseURL: "https://map2-509e5-default-rtdb.firebaseio.com",
    projectId: "map2-509e5",
    storageBucket: "map2-509e5.appspot.com",
    messagingSenderId: "758102344795",
    appId: "1:758102344795:web:dc0e993ea8f7890fcc6b7e"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export { ref, push, set };