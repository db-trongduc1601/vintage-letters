import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCsCQ_qST2Py97kSWAtJ9CzoM8Yz10Na6o",
  authDomain: "vintage-letter.firebaseapp.com",
  projectId: "vintage-letter",
  storageBucket: "vintage-letter.firebasestorage.app",
  messagingSenderId: "1059840253569",
  appId: "1:1059840253569:web:9b3942760078a359fef780",
  measurementId: "G-4XVY7K3EJ1"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == 'failed-precondition') {
    console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
  } else if (err.code == 'unimplemented') {
    console.warn('The current browser does not support all of the features required to enable persistence');
  }
});
