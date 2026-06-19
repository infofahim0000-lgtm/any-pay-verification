// netlify/functions/test-firebase.js
// GET /.netlify/functions/test-firebase — debug Firebase connection

const admin = require("firebase-admin");

exports.handler = async () => {
  try {
    if (admin.apps.length === 0) {
      const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
    }

    const db = admin.database();
    // Write a test record
    await db.ref("_test/ping").set({
      ok: true,
      ts: new Date().toISOString(),
    });

    // Read it back
    const snap = await db.ref("_test/ping").once("value");
    const data = snap.val();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Firebase connected!",
        data,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
