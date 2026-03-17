const express = require('express');
const router = express.Router();
console.log('Company routes file loaded');
const Company = require('../models/Company');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { auth } = require('../middleware/auth');

const sendEmail = require('../utils/email');

// Register Company
router.post('/register', async (req, res) => {
    try {
        const {
            name, surname, mobileNumber, companyName, companyRole, mail, gstin, address
        } = req.body;

        // Check if company exists
        const orConditions = [
            { email: mail },
            { name: companyName },
            { phoneNumber: mobileNumber }
        ];
        if (gstin) {
            orConditions.push({ gstin: gstin });
        }

        const existingCompany = await Company.findOne({ $or: orConditions });

        if (existingCompany) {
            let duplicateField = 'Details';
            if (existingCompany.email === mail) duplicateField = 'Email';
            else if (existingCompany.name === companyName) duplicateField = 'Company Name';
            else if (existingCompany.phoneNumber === mobileNumber) duplicateField = 'Mobile Number';
            else if (existingCompany.gstin === gstin) duplicateField = 'GSTIN';

            console.log(`⚠️ Blocked duplicate registration attempt for: ${duplicateField}`);
            return res.status(400).json({ success: false, message: `${duplicateField} is already registered.` });
        }

        // Create Company
        const company = new Company({
            name: companyName,
            email: mail,
            phoneNumber: mobileNumber,
            gstin,
            address
        });
        await company.save();

        // Generate Admin Credentials
        const adminUsername = `${companyName.replace(/\s+/g, '').toLowerCase()}${name.toLowerCase()}`;
        const adminPassword = crypto.randomBytes(4).toString('hex'); // Simple password for now

        // Create Admin User
        const adminUser = new User({
            username: adminUsername,
            password: adminPassword,
            email: mail,
            phoneNumber: mobileNumber,
            firstName: name,
            lastName: surname,
            role: 'company_owner',
            companyId: company._id,
            firmName: companyName,
            jobTitle: companyRole
        });

        try {
            await adminUser.save();
        } catch (userError) {
            console.error('❌ Failed to create admin user. Rolling back company creation.', userError);
            await Company.findByIdAndDelete(company._id);
            return res.status(400).json({
                success: false,
                message: 'Failed to create admin user. Please check your inputs (e.g. surname) and try again.',
                error: userError.message
            });
        }

        // Send Email
        const emailHtml = `
            <h2>Welcome to ConERP!</h2>
            <p>Your company "<strong>${companyName}</strong>" has been registered successfully.</p>
            <p>Here are your admin credentials:</p>
            <ul>
                <li><strong>Username:</strong> ${adminUsername}</li>
                <li><strong>Password:</strong> ${adminPassword}</li>
            </ul>
            <p>Please login and change your password immediately.</p>
        `;

        try {
            await sendEmail(mail, 'Your Company Credentials', emailHtml);
        } catch (emailError) {
            console.error('⚠️ Failed to send email, but registration was successful:', emailError);
            // Verify we don't fail the whole request just because email failed, 
            // BUT in this specific case, we are providing creds in response so it's okay-ish.
            // Ideally we might want to warn the user.
        }

        res.status(201).json({
            success: true,
            message: 'Company registered successfully. Credentials sent to email.',
            companyId: company._id,
            credentials: { username: adminUsername, password: adminPassword } // FOR TESTING ONLY
        });

    } catch (error) {
        console.error('Company registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed', error: error.message });
    }
});

// Get Company Logs
router.get('/logs', auth, async (req, res) => {
    try {
        const { companyId } = req.user; // Assuming auth middleware attaches user with companyId

        // If user is admin or company owner, they can see all logs for their company
        if (req.user.role !== 'admin' && req.user.role !== 'company_owner') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const logs = await ActivityLog.find({ companyId })
            .sort({ timestamp: -1 })
            .limit(100); // Limit to last 100 logs

        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch logs' });
    }
});

// Get Company Config
router.get('/config', auth, async (req, res) => {
    try {
        const companyId = req.user.companyId;

        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: 'Company ID not found for user'
            });
        }

        const company = await Company.findById(companyId);

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        res.json({
            success: true,
            data: {
                name: company.name,
                email: company.email,
                phoneNumber: company.phoneNumber,
                address: company.address,
                gstin: company.gstin,
                receiptConfig: company.receiptConfig || {},
                salesInvoiceConfig: company.salesInvoiceConfig || {},
                inventoryFilterConfig: company.inventoryFilterConfig || {}
            }
        });
    } catch (error) {
        console.error('Error fetching company config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch company configuration',
            error: error.message
        });
    }
});

// Update Company Config
router.put('/config', auth, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const updates = req.body;

        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: 'Company ID not found for user'
            });
        }

        // Only allow specific fields to be updated
        const allowedUpdates = [
            'receiptConfig.companyName',
            'receiptConfig.companyAddress',
            'receiptConfig.companyMobile',
            'receiptConfig.companyCIN',
            'receiptConfig.companyEmail',
            'receiptConfig.nextVoucherNumber',
            'salesInvoiceConfig.companyName',
            'salesInvoiceConfig.companyAddress',
            'salesInvoiceConfig.companyNumber',
            'salesInvoiceConfig.companyEmail',
            'salesInvoiceConfig.msmeField',
            'salesInvoiceConfig.udyamRegNo',
            'salesInvoiceConfig.udyamDl',
            'salesInvoiceConfig.companyType',
            'salesInvoiceConfig.activities',
            'salesInvoiceConfig.stateCode',
            'salesInvoiceConfig.termsAndConditions',
            'salesInvoiceConfig.gstNo',
            'salesInvoiceConfig.panNo',
            'salesInvoiceConfig.authorizedSignatory',
            'address',
            'phoneNumber'
        ];

        const updateObj = {};
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                updateObj[key] = updates[key];
            }
        });

        const company = await Company.findByIdAndUpdate(
            companyId,
            { $set: updateObj },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        res.json({
            success: true,
            message: 'Company configuration updated successfully',
            data: {
                receiptConfig: company.receiptConfig,
                salesInvoiceConfig: company.salesInvoiceConfig
            }
        });
    } catch (error) {
        console.error('Error updating company config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update company configuration',
            error: error.message
        });
    }
});

module.exports = router;
