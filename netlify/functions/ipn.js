// netlify/functions/ipn.js
// Webhook from epay — saves payment to Firebase on success

const admin = require("firebase-admin");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function initFirebase() {
  if (admin.apps.length > 0) return;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const { order_id, status, trxid, amount, gateway, timestamp } = payload;

    console.log("IPN received:", JSON.stringify(payload));

    if (status === "success" && order_id) {
      initFirebase();
      const db = admin.database();

      const safeKey = order_id.replace(/[.#$[\]]/g, "_");

      const record = {
        invoiceId: order_id,
        trxId: trxid || "",
        amount: parseFloat(amount) || 0,
        paymentMethod: gateway || "unknown",
        timestamp: timestamp || new Date().toISOString(),
        status: "COMPLETED",
        source: "IPN",
      };

      await db.ref(`payments/${safeKey}`).set(record);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true }),
      };
    }

    // Non-success status — acknowledge but don't save
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, message: "Non-success status ignored." }),
    };
  } catch (err) {
    console.error("IPN error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "IPN processing failed." }),
    };
  }
};
