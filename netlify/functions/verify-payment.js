// netlify/functions/verify-payment.js
const admin = require("firebase-admin");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function initFirebase() {
  if (admin.apps.length > 0) {
    console.log("Firebase already initialized");
    return;
  }

  console.log("Initializing Firebase...");
  console.log("DB URL:", process.env.FIREBASE_DATABASE_URL);
  console.log("Service account exists:", !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log("Firebase initialized ✅");
  } catch (e) {
    console.error("Firebase init error:", e.message);
    throw e;
  }
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
    const body = JSON.parse(event.body || "{}");
    const { trxid, mfs, amount, name, number, orderId, status } = body;

    console.log("=== Verify Request ===");
    console.log("Body:", JSON.stringify(body));

    // Validate
    if (!trxid || !trxid.trim()) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "TRX ID is required." }),
      };
    }

    if (!amount || isNaN(parseFloat(amount))) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Amount is required." }),
      };
    }

    if (status !== "success") {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Payment not successful." }),
      };
    }

    const parsedAmount = parseFloat(amount);
    const cleanTrx     = trxid.trim().toUpperCase();
    const invoiceId    = orderId || "ORD" + Date.now();
    const safeKey      = invoiceId.replace(/[.#$[\]]/g, "_");

    console.log("Saving to Firebase key:", safeKey);

    // Init Firebase
    initFirebase();
    const db = admin.database();

    // Check duplicate
    const existing = await db.ref(`payments/${safeKey}`).once("value");
    if (existing.val()) {
      console.log("Already exists, returning existing record");
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, record: existing.val() }),
      };
    }

    // Build record
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

    console.log("Record to save:", JSON.stringify(record));

    // Save
    await db.ref(`payments/${safeKey}`).set(record);
    console.log("✅ Saved to Firebase successfully!");

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, record }),
    };

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error("Stack:", err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
