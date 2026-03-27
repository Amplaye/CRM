import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  // Use emulator if local
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
     process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
     process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
     admin.initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-tableflow',
     });
  } else {
     // Production setup
     try {
       admin.initializeApp({
         credential: admin.credential.cert({
           projectId: process.env.FIREBASE_PROJECT_ID,
           clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
           privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
         }),
       });
     } catch (error) {
       console.error('Firebase admin initialization error', error);
     }
  }
}

const db = admin.firestore();
const auth = admin.auth();

export { admin, db, auth };
