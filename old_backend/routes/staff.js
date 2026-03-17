const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

const ActivityLogger = require('../utils/activityLogger');

const { auth, adminOnly } = require('../middleware/auth');

// Create new staff member
router.post('/', auth, adminOnly, async (req, res) => {
    try {
        const { fullName, username, password } = req.body;

        if (!fullName || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide full name, username, and password'
            });
        }

        // Check if username already exists
        const existingUser = await User.findOne({ username: username.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }

        const staff = new User({
            fullName,
            username: username.toLowerCase().trim(),
            password, // Will be hashed by pre-save hook
            role: 'staff',
            companyId: req.user.companyId, // Link to company
            createdBy: req.user._id, // req.user is set by auth middleware
            createdAt: new Date()
        });

        await staff.save();

        // Log activity
        try {
            await ActivityLogger.logActivity(
                staff._id,
                'staff_created',
                req.user,
                {
                    staffName: staff.fullName,
                    staffUsername: staff.username,
                    role: 'staff'
                },
                `Staff member "${staff.fullName}" created by ${req.user.username}`,
                'User'
            );
        } catch (logErr) {
            console.error('Failed to log staff creation:', logErr);
        }

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('staff:updated', { action: 'create', staffId: staff._id });
        }

        res.status(201).json({
            success: true,
            message: 'Staff member created successfully',
            data: {
                id: staff._id,
                fullName: staff.fullName,
                username: staff.username,
                role: staff.role,
                createdAt: staff.createdAt
            }
        });

    } catch (error) {
        console.error('Create staff error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating staff member',
            error: error.message
        });
    }
});

// Get all staff members created by this admin
router.get('/', auth, adminOnly, async (req, res) => {
    try {
        let query = { role: 'staff', createdBy: req.user._id };

        if (req.user.companyId) {
            query = { role: 'staff', companyId: req.user.companyId };
        }

        const staffMembers = await User.find(query).select('-password').sort({ createdAt: -1 });

        res.json({
            success: true,
            count: staffMembers.length,
            data: staffMembers
        });

    } catch (error) {
        console.error('Get staff error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching staff members'
        });
    }
});

// Get single staff member details
router.get('/:id', auth, adminOnly, async (req, res) => {
    try {
        const staffId = req.params.id;

        const staff = await User.findOne({
            _id: staffId,
            role: 'staff',
            $or: [
                { createdBy: req.user._id },
                { companyId: req.user.companyId }
            ]
        }).select('-password');

        if (!staff) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        res.json({
            success: true,
            data: staff
        });

    } catch (error) {
        console.error('Get staff details error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching staff details'
        });
    }
});

// Update staff member
router.put('/:id', auth, adminOnly, async (req, res) => {
    try {
        const { fullName, password } = req.body;
        const staffId = req.params.id;

        const staff = await User.findOne({
            _id: staffId,
            role: 'staff',
            createdBy: req.user._id
        });

        if (!staff) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        if (fullName) staff.fullName = fullName;
        if (password) staff.password = password; // Will be hashed by pre-save hook

        await staff.save();

        // Log activity
        try {
            const updates = {};
            if (fullName) updates.fullName = fullName;
            if (password) updates.passwordChanged = true;

            await ActivityLogger.logActivity(
                staff._id,
                'staff_updated',
                req.user._id,
                {
                    staffName: staff.fullName,
                    staffUsername: staff.username,
                    updates
                },
                `Staff member "${staff.fullName}" updated by ${req.user.username}`,
                'User'
            );
        } catch (logErr) {
            console.error('Failed to log staff update:', logErr);
        }

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('staff:updated', { action: 'update', staffId: staff._id });
        }

        res.json({
            success: true,
            message: 'Staff member updated successfully',
            debug_body: req.body, // Debugging: Return received body
            data: {
                id: staff._id,
                fullName: staff.fullName,
                username: staff.username,
                role: staff.role
            }
        });

    } catch (error) {
        console.error('Update staff error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating staff member'
        });
    }
});

// Delete staff member
router.delete('/:id', auth, adminOnly, async (req, res) => {
    try {
        const staffId = req.params.id;

        const query = {
            _id: staffId,
            role: 'staff'
        };

        // If admin belongs to a company, allow deleting any staff in that company
        // Otherwise (super admin/individual), only allow deleting what they created
        if (req.user.companyId) {
            query.companyId = req.user.companyId;
        } else {
            query.createdBy = req.user._id;
        }

        const result = await User.findOneAndDelete(query);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        // Log activity
        try {
            await ActivityLogger.logActivity(
                staffId,
                'staff_deleted',
                req.user._id,
                {
                    staffId: staffId,
                    staffUsername: result.username
                },
                `Staff member "${result.username}" deleted by ${req.user.username}`,
                'User'
            );
        } catch (logErr) {
            console.error('Failed to log staff deletion:', logErr);
        }

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('staff:updated', { action: 'delete', staffId: staffId });
        }

        res.json({
            success: true,
            message: 'Staff member deleted successfully'
        });

    } catch (error) {
        console.error('Delete staff error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting staff member'
        });
    }
});

// Get attendance records for a staff member (Admin only)
// This route handles: GET /api/staff/:id/attendance
router.get('/:id/attendance', auth, adminOnly, async (req, res) => {
    try {
        const staffId = req.params.id;
        const { startDate, endDate } = req.query;

        const Attendance = require('../models/Attendance');

        // Verify the staff member exists and was created by this admin
        const staff = await User.findOne({
            _id: staffId,
            role: 'staff',
            companyId: req.user.companyId
        });

        if (!staff) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found or you do not have permission to view their records'
            });
        }

        // Build query
        const query = { staffId };

        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const records = await Attendance.find(query)
            .sort({ timestamp: -1 })
            .populate('staffId', 'fullName username');

        res.json({
            success: true,
            count: records.length,
            staff: {
                id: staff._id,
                fullName: staff.fullName,
                username: staff.username
            },
            data: records
        });

    } catch (error) {
        console.error('Get staff attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching staff attendance records'
        });
    }
});

module.exports = router;
