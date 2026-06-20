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

// Try verify with one mfs
async function tryVerify(API_KEY, mfs, amount, trxid) {
  const url = `https://epay.corp.com.bd/api.php` +
    `?api_key=${encodeURIComponent(API_KEY)}` +
    `&mfs=${encodeURIComponent(mfs)}` +
    `&amount=${encodeURIComponent(amount)}` +
    `&trxid=${encodeURIComponent(trxid)}`;

  console.log(`Trying mfs=${mfs}:`, url);

  const res  = await axios.get(url, { timeout: 10000 });
  const data = res.data;
  console.log(`Response mfs=${mfs}:`, JSON.stringify(data));
  return data;
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

    console.log("Verify request:", { trxid, mfs, amount, name, number, orderId });

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

    // Try all 3 mfs methods — whichever works
    const methodsToTry = [];

    // Put the provided mfs first, then try others
    if (mfs && ["bkash", "nagad", "rocket"].includes(mfs)) {
      methodsToTry.push(mfs);
    }
    // Add remaining methods
    for (const m of ["bkash", "nagad", "rocket"]) {
      if (!methodsToTry.includes(m)) methodsToTry.push(m);
    }

    let verifiedData = null;
    let usedMfs      = mfs || "bkash";

    for (const method of methodsToTry) {
      try {
        const data = await tryVerify(API_KEY, method, parsedAmount, trxid.trim());
        if (data.status === "success" && data.verified === true) {
          verifiedData = data;
          usedMfs      = method;
          console.log(`✅ Verified with mfs=${method}`);
          break;
        }
      } catch (e) {
        console.log(`mfs=${method} error:`, e.message);
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
          trxId:         trxid.trim(),
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
        console.error("Firebase error:", fbErr.message);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            warning: "Verified but save failed.",
            record: { name, number, amount: parsedAmount, trxId: trxid.trim(), paymentMethod: usedMfs },
          }),
        };
      }

    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Payment verification failed. TRX ID টি সঠিক কিনা এবং amount মিলছে কিনা চেক করুন।",
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
