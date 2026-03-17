const nodemailer = require("nodemailer");

/**
 * type: "default" | "landing"
 */
const sendEmail = async (to, subject, html, type = "default") => {
    let user; // 👈 move to outer scope

    try {
        const isLanding = type === "landing";

        user = isLanding
            ? process.env.LANDING_EMAIL_USER
            : process.env.EMAIL_USER;

        const pass = isLanding
            ? process.env.LANDING_EMAIL_PASS
            : process.env.EMAIL_PASS;

        if (!user || !pass) {
            throw new Error(`Missing email credentials for type: ${type}`);
        }

        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 587,
            secure: false,
            auth: { user, pass },
            tls: { rejectUnauthorized: false },
        });

        await transporter.sendMail({
            from: `"ConERP" <${user}>`,
            to,
            subject,
            html,
        });

        console.log(`✅ Email sent (${type}) using ${user}`);
        return true;
    } catch (error) {
        console.error(`❌ Email error (${type}):`, error.message);
        console.log("📧 Using user:", user);
        return false;
    }
};


module.exports = sendEmail;
