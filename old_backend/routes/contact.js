const express = require("express");
const router = express.Router();
const sendEmail = require("../utils/email");

console.log("Contact routes file loaded");

// POST /api/contact/access-platform
router.post("/access-platform", async (req, res) => {
    try {
        const { name, email, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                message: "All fields are required",
            });
        }

        const emailHtml = `
      <h2>New ConERP Demo Request</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Message:</strong></p>
      <p>${message}</p>
    `;

        await sendEmail(
            "feathrtech@gmail.com",
            "ConERP – New Demo / Access Request",
            emailHtml, "landing"
        );

        res.json({
            success: true,
            message: "Request sent successfully",
        });
    } catch (error) {
        console.error("Contact request error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to send request",
        });
    }
});

module.exports = router;
