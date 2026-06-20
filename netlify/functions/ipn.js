// netlify/functions/ipn.js
const admin  = require("firebase-admin");
const crypto = require("crypto");

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
    const rawBody = event.body || "{}";

    // --- Verify webhook signature ---
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    if (WEBHOOK_SECRET) {
      const signature = event.headers["x-webhook-signature"] ||
                        event.headers["x-epay-signature"] ||
                        event.headers["signature"] || "";

      const expectedSig = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (signature && signature !== expectedSig) {
        console.log("Invalid signature:", signature);
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Invalid signature." }),
        };
      }
    }

    const body = JSON.parse(rawBody);
    console.log("IPN received:", JSON.stringify(body));

    // --- Parse epay webhook format ---
    // Format: { event, timestamp, data: { order_id, amount, trxid, gateway, status } }
    const data     = body.data || body;
    const order_id = data.order_id || body.order_id;
    const status   = data.status   || body.status;
    const trxid    = data.trxid    || body.trxid;
    const amount   = data.amount   || body.amount;
    const gateway  = data.gateway  || body.gateway;
    const event_type = body.event  || "";

    console.log("Parsed data:", { order_id, status, trxid, amount, gateway, event_type });

    // --- Save if payment successful ---
    if (
      (status === "paid" || status === "success" || event_type === "payment.success")
      && order_id
    ) {
      initFirebase();
      const db = admin.database();

      const safeKey = order_id.replace(/[.#$[\]]/g, "_");

      const record = {
        invoiceId:     order_id,
        trxId:         trxid    || "",
        amount:        parseFloat(amount) || 0,
        paymentMethod: gateway  || "unknown",
        timestamp:     new Date().toISOString(),
        status:        "COMPLETED",
        source:        "WEBHOOK",
        name:          "",
        number:        "",
      };

      await db.ref(`payments/${safeKey}`).set(record);
      console.log("✅ Saved to Firebase:", safeKey);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true }),
      };
    }

    console.log("Non-success status, ignoring.");
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
