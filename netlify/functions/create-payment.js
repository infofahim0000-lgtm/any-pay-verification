// netlify/functions/create-payment.js
const axios = require("axios");
const qs    = require("querystring");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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
    const { name, number, amount } = JSON.parse(event.body || "{}");

    // Validate
    if (!name || !name.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Full name is required." }) };
    }
    if (!number || !number.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Number is required." }) };
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Valid amount is required." }) };
    }

    const STORE_KEY = process.env.STORE_KEY;
    const YOUR_SITE = process.env.YOUR_SITE;

    if (!STORE_KEY || !YOUR_SITE) {
      console.error("Missing env vars:", { STORE_KEY: !!STORE_KEY, YOUR_SITE: !!YOUR_SITE });
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Server configuration error." }) };
    }

    // Order ID without dash
    const orderId = "ORD" + Date.now();

    // Simple success URL — put name/number/amount as hash so epay ? doesn't conflict
    // epay appends ?status=...&trxid=... to success_url
    // We store our data in the path using encoded params BEFORE epay adds theirs
    // Solution: use a redirect page that reads both
    const successUrl = `${YOUR_SITE}/verify.html` +
      `?n=${encodeURIComponent(name.trim())}` +
      `&p=${encodeURIComponent(number.trim())}` +
      `&a=${encodeURIComponent(parsedAmount)}` +
      `&o=${encodeURIComponent(orderId)}`;

    const cancelUrl = `${YOUR_SITE}/cancel.html?reason=cancelled`;
    const errorUrl  = `${YOUR_SITE}/cancel.html?reason=payment_failed`;

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

    console.log("Sending to epay:", JSON.stringify(payload));

    const response = await axios.post(
      "https://epay.corp.com.bd/pay.php",
      qs.stringify(payload),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
      }
    );

    console.log("epay response:", JSON.stringify(response.data));

    const data = response.data;

    if (data.status === "success" && data.payment_url) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ payment_url: data.payment_url, order_id: data.order_id || orderId }),
      };
    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: data.message || "Failed to create payment. Try again." }),
      };
    }

  } catch (err) {
    console.error("create-payment error:", err.message);
    console.error("Stack:", err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error: " + err.message }),
    };
  }
};
