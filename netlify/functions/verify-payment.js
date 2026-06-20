// netlify/functions/verify-payment.js
// Direct save — no epay verify API call needed
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
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { trxid, mfs, amount, name, number, orderId, status } = body;

    console.log("Save request:", body);

    // Validate required fields
    if (!trxid || !trxid.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "TRX ID is required." }) };
    }
    if (!amount || isNaN(parseFloat(amount))) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Amount is required." }) };
    }

    // Only save if status is success
    if (status !== "success") {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Payment not successful." }) };
    }

    const parsedAmount = parseFloat(amount);
    const cleanTrx     = trxid.trim().toUpperCase();

    // Save to Firebase
    initFirebase();
    const db = admin.database();

    const invoiceId = orderId || "ORD" + Date.now();
    const safeKey   = invoiceId.replace(/[.#$[\]]/g, "_");

    // Check if already saved (prevent duplicate)
    const existing = await db.ref(`payments/${safeKey}`).once("value");
    if (existing.val()) {
      console.log("Already saved:", safeKey);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, record: existing.val() }),
      };
    }

    const record = {
      name:          name   || "",
      number:        number || "",
      amount:        parsedAmount,
      trxId:         cleanTrx,
      invoiceId:     invoiceId,
      paymentMethod: mfs    || "unknown",
      timestamp:     new Date().toISOString(),
      status:        "COMPLETED",
    };

    await db.ref(`payments/${safeKey}`).set(record);
    console.log("✅ Saved:", safeKey);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, record }),
    };

  } catch (err) {
    console.error("Error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
