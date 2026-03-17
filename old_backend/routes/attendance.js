const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { auth, adminOnly } = require('../middleware/auth');
const { uploadAttendanceToR2 } = require('../utils/uploadToR2');

// Submit attendance (Staff, Supervisor, Admin, Warehouse Manager)
router.post('/', auth, async (req, res) => {
    try {
        // ALLOW STAFF, SUPERVISORS, ADMINS, AND WAREHOUSE MANAGERS
        const allowedRoles = ['staff', 'supervisor', 'admin', 'warehouse_manager'];

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only staff, supervisors, admins, and warehouse managers can submit attendance'
            });
        }

        const { type, photo, location } = req.body;

        // Validate required fields
        if (!type || !photo || !location) {
            return res.status(400).json({
                success: false,
                message: 'Please provide type, photo, and location'
            });
        }

        if (!['login', 'logout'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Type must be either "login" or "logout"'
            });
        }

        if (!location.latitude || !location.longitude) {
            return res.status(400).json({
                success: false,
                message: 'Location must include latitude and longitude'
            });
        }

        // --- NEW: One Check-in/out per day Check ---
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const existingRecord = await Attendance.findOne({
            staffId: req.user._id,
            type,
            timestamp: { $gte: startOfDay, $lte: endOfDay }
        });

        if (existingRecord) {
            return res.status(400).json({
                success: false,
                message: `You have already marked ${type === 'login' ? 'Check In' : 'Check Out'} for today.`
            });
        }
        // -------------------------------------------


        // --- NEW: Cloudflare R2 Upload ---
        console.log(`Uploading ${type} photo for ${req.user.role}...`);
        const photoUrl = await uploadAttendanceToR2(photo, req.user._id, req.user.role);

        // Create display text for location
        const displayText = location.address || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;

        // Create attendance record
        const attendance = new Attendance({
            staffId: req.user._id, // This stores the ID of whoever is logged in (Staff or Supervisor)
            type,
            photo: photoUrl,
            photoUploadedAt: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                displayText
            },
            timestamp: new Date()
        });

        await attendance.save();

        res.status(201).json({
            success: true,
            message: `Attendance marked successfully: ${type === 'login' ? 'Check In' : 'Check Out'}`,
            data: {
                id: attendance._id,
                type: attendance.type,
                location: attendance.location,
                timestamp: attendance.timestamp
            }
        });

    } catch (error) {
        console.error('Submit attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting attendance',
            error: error.message
        });
    }
});

// Get own attendance records (Staff, Supervisor, Admin, Warehouse Manager)
router.get('/my-records', auth, async (req, res) => {
    try {
        const allowedRoles = ['staff', 'supervisor', 'admin', 'warehouse_manager'];

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access'
            });
        }

        const { startDate, endDate } = req.query;

        // Build query
        const query = { staffId: req.user._id };

        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const records = await Attendance.find(query)
            .sort({ timestamp: -1 })
            .select('-photo'); // Don't send photo data in list view

        res.json({
            success: true,
            count: records.length,
            data: records
        });

    } catch (error) {
        console.error('Get my records error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching attendance records'
        });
    }
});

// ... (Keep the rest of the Admin routes as they were) ...
// Get attendance records for a specific staff/supervisor (Admin only)
router.get('/user/:userId', auth, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;

        // Build query
        const query = { staffId: userId };

        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const records = await Attendance.find(query)
            .sort({ timestamp: -1 })
            .populate('staffId', 'fullName username role');

        res.json({
            success: true,
            count: records.length,
            data: records
        });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching records' });
    }
});

// Get today's attendance overview for all users (Admin only)
router.get('/today-overview', auth, adminOnly, async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Find all attendance records for today
        const records = await Attendance.find({
            timestamp: { $gte: startOfDay, $lte: endOfDay }
        }).select('staffId type timestamp');

        // Process records to find unique users and their latest status
        const todayStatus = {};
        
        records.forEach(record => {
            const userId = record.staffId.toString();
            // We want to know if they have checked in at all today, so we track them.
            // If we want latest status:
            if (!todayStatus[userId] || new Date(record.timestamp) > new Date(todayStatus[userId].timestamp)) {
                todayStatus[userId] = {
                    status: record.type, // 'login' or 'logout'
                    timestamp: record.timestamp
                };
            }
        });

        res.json({
            success: true,
            count: Object.keys(todayStatus).length,
            data: todayStatus
        });

    } catch (error) {
        console.error('Get today overview error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching today\'s attendance overview'
        });
    }
});

// Manual cleanup of old photos (Admin only)
router.delete('/cleanup', auth, adminOnly, async (req, res) => {
    try {
        const result = await Attendance.cleanupOldPhotos();
        res.json({
            success: true,
            message: 'Photo cleanup completed',
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;