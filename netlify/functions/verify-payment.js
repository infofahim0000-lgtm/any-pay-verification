// netlify/functions/verify-payment.js
const axios = require("axios");
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

// Try one specific combination
async function tryOne(API_KEY, mfs, amount, trxid) {
  const url = `https://epay.corp.com.bd/api.php` +
    `?api_key=${encodeURIComponent(API_KEY)}` +
    `&mfs=${encodeURIComponent(mfs)}` +
    `&amount=${encodeURIComponent(amount)}` +
    `&trxid=${encodeURIComponent(trxid)}`;

  console.log(`Trying: mfs=${mfs} amount=${amount} trxid=${trxid}`);
  const res  = await axios.get(url, { timeout: 10000 });
  console.log(`Result: ${JSON.stringify(res.data)}`);
  return res.data;
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
    const { trxid, mfs, amount, name, number, orderId } = body;

    console.log("=== Verify Request ===", { trxid, mfs, amount, name, number, orderId });

    if (!trxid || !trxid.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "TRX ID is required." }) };
    }

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Valid amount is required." }) };
    }

    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Server configuration error." }) };
    }

    const cleanTrx    = trxid.trim().toUpperCase();
    const amountInt   = Math.round(parsedAmount);
    const amountFloat = parsedAmount.toFixed(2);
    const methods     = ["bkash", "nagad", "rocket"];

    // Build all combinations to try
    // mfs × amount format = 3 × 2 = 6 combinations
    const combinations = [];

    // Put user-selected mfs first
    if (mfs && methods.includes(mfs)) {
      combinations.push({ mfs, amount: amountInt });
      combinations.push({ mfs, amount: amountFloat });
    }

    // Then try all others
    for (const m of methods) {
      if (m !== mfs) {
        combinations.push({ mfs: m, amount: amountInt });
        combinations.push({ mfs: m, amount: amountFloat });
      }
    }

    let verifiedData = null;
    let usedMfs      = mfs || "bkash";

    for (const combo of combinations) {
      try {
        const data = await tryOne(API_KEY, combo.mfs, combo.amount, cleanTrx);
        if (data.status === "success" && data.verified === true) {
          verifiedData = data;
          usedMfs      = combo.mfs;
          console.log(`✅ SUCCESS with mfs=${combo.mfs} amount=${combo.amount}`);
          break;
        }
      } catch (e) {
        console.log(`❌ Failed mfs=${combo.mfs} amount=${combo.amount}:`, e.message);
      }
    }

    if (verifiedData) {
      // Save to Firebase
      try {
        initFirebase();
        const db = admin.database();

        const invoiceId = orderId || "ORD" + Date.now();
        const safeKey   = invoiceId.replace(/[.#$[\]]/g, "_");

        const record = {
          name:          name   || "",
          number:        number || "",
          amount:        parsedAmount,
          trxId:         cleanTrx,
          invoiceId:     invoiceId,
          paymentMethod: usedMfs,
          timestamp:     new Date().toISOString(),
          status:        "COMPLETED",
        };

        await db.ref(`payments/${safeKey}`).set(record);
        console.log("✅ Saved to Firebase:", safeKey);

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, record }),
        };

      } catch (fbErr) {
        console.error("Firebase save error:", fbErr.message);
        // Payment verified — return success even if Firebase failed
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            record: {
              name, number,
              amount: parsedAmount,
              trxId: cleanTrx,
              paymentMethod: usedMfs,
            },
          }),
        };
      }

    } else {
      console.log("❌ All combinations failed");
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Payment verification failed. TRX ID বা Amount সঠিক নয়।",
        }),
      };
    }

  } catch (err) {
    console.error("verify-payment error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error: " + err.message }),
    };
  }
};
