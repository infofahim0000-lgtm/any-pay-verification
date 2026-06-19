// netlify/functions/verify-payment.js
// Called via POST fetch() from verify.html
// Verifies TRX ID with epay, saves to Firebase on success

const axios = require("axios");
const admin = require("firebase-admin");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// --- Initialize Firebase Admin (singleton) ---
function initFirebase() {
  if (admin.apps.length > 0) return; // already initialized

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
    const { trxid, mfs, amount, name, number, orderId } = JSON.parse(
      event.body || "{}"
    );

    // --- Validate inputs ---
    if (!trxid || !trxid.trim()) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "TRX ID is required." }),
      };
    }
    if (!["bkash", "nagad", "rocket"].includes(mfs)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Invalid payment method." }),
      };
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Valid amount is required." }),
      };
    }

    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Server configuration error." }),
      };
    }

    // --- Call epay verify API (GET with query params) ---
    const verifyUrl = `https://epay.corp.com.bd/api.php` +
      `?api_key=${encodeURIComponent(API_KEY)}` +
      `&mfs=${encodeURIComponent(mfs)}` +
      `&amount=${encodeURIComponent(parsedAmount)}` +
      `&trxid=${encodeURIComponent(trxid.trim())}`;

    const verifyRes = await axios.get(verifyUrl, { timeout: 15000 });
    const verifyData = verifyRes.data;

    // --- Check verification result ---
    if (verifyData.status === "success" && verifyData.verified === true) {
      // --- Save to Firebase ---
      initFirebase();
      const db = admin.database();

      // Safe Firebase key: replace forbidden chars
      const invoiceId = orderId || "ORD-" + Date.now();
      const safeKey = invoiceId.replace(/[.#$[\]]/g, "_");

      const record = {
        name: name || "",
        number: number || "",
        amount: parsedAmount,
        trxId: trxid.trim(),
        invoiceId: invoiceId,
        paymentMethod: mfs,
        timestamp: new Date().toISOString(),
        status: "COMPLETED",
      };

      await db.ref(`payments/${safeKey}`).set(record);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, record }),
      };
    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Payment verification failed. Check your TRX ID and try again." }),
      };
    }
  } catch (err) {
    console.error("verify-payment error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error. Please retry." }),
    };
  }
};
