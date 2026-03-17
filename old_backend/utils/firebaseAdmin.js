const admin = require('firebase-admin');

let app;

const initializeFirebase = () => {
  if (app) return app;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (json) {
    const serviceAccount = JSON.parse(json);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    return app;
  }

  if (path) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const serviceAccount = require(path);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    return app;
  }

  throw new Error('Firebase service account not configured');
};

const getMessaging = () => {
  if (!app) initializeFirebase();
  return admin.messaging();
};

module.exports = {
  initializeFirebase,
  getMessaging
};
