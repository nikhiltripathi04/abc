const Company = require('../models/Company');

/**
 * Get company configuration including receipt config
 */
exports.getCompanyConfig = async (req, res) => {
    try {
        const userId = req.user._id;
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
};

/**
 * Update company configuration
 */
exports.updateCompanyConfig = async (req, res) => {
    try {
        const userId = req.user._id;
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
                receiptConfig: company.receiptConfig
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
};
