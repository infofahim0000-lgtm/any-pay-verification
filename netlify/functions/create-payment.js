// netlify/functions/create-payment.js
const axios = require("axios");
const qs = require("querystring");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  // Handle CORS preflight
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
    const { name, number, amount } = JSON.parse(event.body || "{}");

    // --- Validate inputs ---
    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Full name is required." }),
      };
    }
    if (!number || !number.trim()) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Number is required." }),
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

    const STORE_KEY = process.env.STORE_KEY;
    const YOUR_SITE = process.env.YOUR_SITE;

    if (!STORE_KEY || !YOUR_SITE) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Server configuration error." }),
      };
    }

    // --- Generate unique order ID ---
    const orderId = "ORD" + Date.now();


    // --- Build URLs ---
    const customerData = Buffer.from(JSON.stringify({
  name:   name.trim(),
  number: number.trim(),
  amount: parsedAmount,
  orderId: orderId,
})).toString('base64');

const successUrl = `${YOUR_SITE}/verify.html?d=${customerData}`;

    // --- Checkout payload ---
    const payload = {
      store_key:      STORE_KEY,
      amount:         parsedAmount,
      success_url:    successUrl,
      error_url:      errorUrl,
      cancel_url:     cancelUrl,
      order_id:       orderId,
      customer_name:  name.trim(),
      customer_email: "student@student.edu",
      reference:      number.trim(),
    };

    // --- Call epay API (form-encoded) ---
    const response = await axios.post(
      "https://epay.corp.com.bd/pay.php",
      qs.stringify(payload),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
      }
    );

    const data = response.data;

    if (data.status === "success" && data.payment_url) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          payment_url: data.payment_url,
          order_id:    data.order_id || orderId,
        }),
      };
    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: data.message || "Failed to create payment. Try again.",
        }),
      };
    }
  } catch (err) {
    console.error("create-payment error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error. Please retry." }),
    };
  }
};
