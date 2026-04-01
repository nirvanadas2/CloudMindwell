const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// Serve your frontend HTML files statically
app.use(express.static("public"));

// Initialize Razorpay with your key_id and key_secret from .env
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── STEP 1: Create an order ────────────────────────────────────────────────
// Called when the user clicks "Donate Now" on the frontend.
// Returns an order_id that Razorpay's checkout widget needs.
app.post("/create-order", async (req, res) => {
  const { amount, currency = "INR", donorName, donorEmail } = req.body;

  if (!amount || amount < 1) {
    return res.status(400).json({ error: "Invalid donation amount" });
  }

  try {
    const order = await razorpay.orders.create({
      amount: amount * 100, // Razorpay expects amount in paise (₹1 = 100 paise)
      currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        donorName,
        donorEmail,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID, // sent to frontend to init checkout
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ─── STEP 2: Verify payment ──────────────────────────────────────────────────
// Called after the user completes payment in Razorpay's popup.
// Verifies the payment signature to confirm it's genuine (not tampered).
app.post("/verify-payment", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // Razorpay signs the payment using HMAC-SHA256
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature === razorpay_signature) {
    // ✅ Payment is genuine
    // TODO: Save donation record to your database here
    // e.g. saveDonation({ orderId, paymentId, amount, donorName, donorEmail })

    console.log(`✅ Payment verified: ${razorpay_payment_id}`);
    res.json({ success: true, paymentId: razorpay_payment_id });
  } else {
    // ❌ Signature mismatch — payment may be tampered
    console.error("❌ Payment verification failed");
    res.status(400).json({ success: false, error: "Payment verification failed" });
  }
});

// ─── STEP 3: Razorpay Webhook (optional but recommended) ────────────────────
// Razorpay calls this URL automatically when a payment succeeds/fails.
// Useful for sending confirmation emails, updating DB even if user closes tab.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(req.body)
    .digest("hex");

  if (signature === expectedSignature) {
    const event = JSON.parse(req.body);

    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      console.log(`💰 Donation received: ₹${payment.amount / 100} from ${payment.notes?.donorName}`);
      // TODO: Send thank-you email, update DB, etc.
    }

    res.json({ status: "ok" });
  } else {
    res.status(400).json({ error: "Invalid webhook signature" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MindWell donation server running on http://localhost:${PORT}`);
});

// ─── EVENT REGISTRATION ──────────────────────────────────────────────────────
// Stores registrations in memory — swap with MongoDB/PostgreSQL in production
const registrations = [];

app.post("/register-event", (req, res) => {
  const { firstName, lastName, email, phone, heardFrom, notes, eventName, eventMeta, price } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  const registration = {
    id: Date.now(),
    firstName, lastName, email, phone,
    heardFrom, notes, eventName, eventMeta, price,
    registeredAt: new Date().toISOString(),
  };

  registrations.push(registration);
  console.log(`📋 New registration: ${firstName} ${lastName} (${email}) → ${eventName}`);

  // TODO: Send confirmation email via Nodemailer / SendGrid
  res.json({ success: true, message: "Registration saved!" });
});

// Admin: view all registrations (protect this route in production!)
app.get("/admin/registrations", (req, res) => {
  res.json({ total: registrations.length, registrations });
});