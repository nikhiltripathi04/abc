const express = require('express');
const Site = require('../models/Site');
const mongoose = require('mongoose');
const User = require('../models/User');
const ActivityLogger = require('../utils/activityLogger');
const router = express.Router();
// Add this to your sites routes file
const SupplyRequest = require('../models/SupplyRequest');
const Warehouse = require('../models/Warehouse');
const InventoryItem = require('../models/InventoryItem');
const { auth } = require('../middleware/auth');
const eventBus = require('../core/eventBus');

// Apply auth middleware to all site routes
router.use(auth);

// Create supply request (supervisors can request supplies from warehouse)

// Helper function to fetch inventory price for an item by name
const getInventoryPrice = async (itemName, companyId) => {
    try {
        if (!itemName || !companyId) return null;

        // Case-insensitive exact match for item name
        const item = await InventoryItem.findOne({
            companyId,
            itemName: { $regex: new RegExp(`^${itemName.trim()}$`, 'i') },
            isActive: true
        });

        return item?.currentPrice || null;
    } catch (error) {
        console.error('Error fetching inventory price:', error);
        return null;
    }
};

// Helper function to get admin user by ID
const getAdminUser = async (adminId) => {
    try {
        if (!adminId) return null;
        // Allow both admin and company_owner
        const admin = await User.findOne({
            _id: adminId,
            role: { $in: ['admin', 'company_owner'] }
        });
        return admin;
    } catch (error) {
        console.error('Error finding admin user:', error);
        return null;
    }
};
const suggestUsernameFallback = async (base) => {
    let suffix = 1;
    let suggested = base.toLowerCase().trim();

    while (await User.findOne({ username: suggested })) {
        suggested = `${base}${Math.floor(100 + Math.random() * 900)}`;
    }

    return suggested;
};
// Helper function to get user by ID with NO fallback
const getUser = async (userId = null) => {
    try {
        if (userId) {
            const user = await User.findById(userId);
            if (user) return user;
        }
        return null;
    } catch (error) {
        console.error('Error finding user:', error);
        return null;
    }
};

const getUserWithDetails = async (userId) => {
    try {
        const user = await User.findById(userId);
        return user;
    } catch (error) {
        console.error('Error fetching user details:', error);
        return null;
    }
};

// Check site ownership middleware
// Check site ownership middleware
const checkSiteOwnership = async (req, res, next) => {
    try {
        // Skip if no site ID is provided (for routes that don't target a specific site)
        if (!req.params.id && !req.params.siteId) {
            return next();
        }

        const siteId = req.params.id || req.params.siteId;

        // Get adminId and supervisorId from query params, body, or user object
        let adminId = req.query.adminId || req.body.adminId;
        let supervisorId = req.query.supervisorId || req.body.supervisorId;

        if (req.user) {
            if (req.user.role === 'admin') adminId = req.user.id;
            if (req.user.role === 'supervisor') supervisorId = req.user.id;
        } else {
            // Fallback for when auth middleware is not used (legacy support)
            if (!adminId && !supervisorId) {
                // Try to use adminId from req.user.id if it was set but role wasn't checked (shouldn't happen with auth middleware)
                adminId = req.user?.id;
            }
        }

        console.log('Site ownership check:', {
            endpoint: req.originalUrl,
            method: req.method,
            siteId,
            adminId,
            supervisorId,
            queryParams: req.query,
            bodyParams: req.body
        });

        // If neither adminId nor supervisorId is provided, deny access
        if (!adminId && !supervisorId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required: No user ID provided'
            });
        }

        let site = null;
        let user = null;

        // Check for admin access first
        if (adminId) {
            // Allow both admin and company_owner
            const admin = await User.findOne({
                _id: adminId,
                role: { $in: ['admin', 'company_owner'] }
            });

            if (admin) {
                site = await Site.findById(siteId);

                if (site) {
                    // Check if admin owns the site OR belongs to the same company
                    const isOwner = site.adminId.toString() === adminId.toString();
                    const isSameCompany = site.companyId && admin.companyId &&
                        site.companyId.toString() === admin.companyId.toString();

                    if (isOwner || isSameCompany) {
                        user = admin;
                    }
                }
            }
        }

        // If not authenticated as admin, check for supervisor access
        if (!user && supervisorId) {
            const supervisor = await User.findOne({ _id: supervisorId, role: 'supervisor' });

            if (supervisor && supervisor.assignedSites) {
                // Check if the siteId is in the supervisor's assignedSites array
                const isAssigned = supervisor.assignedSites.some(id => id.toString() === siteId);

                if (isAssigned) {
                    site = await Site.findById(siteId);
                    user = supervisor;
                }
            }
        }

        // If no valid access found
        if (!user || !site) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: You do not have permission to access this site'
            });
        }

        // Set up req.user for the rest of the request handling
        req.user = {
            id: user._id,
            _id: user._id,
            role: user.role
        };

        // Populate site with supervisors for the GET request
        if (req.method === 'GET') {
            await site.populate('supervisors', 'username');
        }

        // Attach site to request for later use
        req.site = site;
        next();
    } catch (error) {
        console.error('Site ownership check error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error checking site ownership'
        });
    }
};


// Get all sites for the authenticated admin
router.get('/', async (req, res) => {
    try {
        const adminId = req.query.adminId || req.user?.id;

        if (!adminId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        console.log(`Fetching sites for admin ID: ${adminId}`);

        // Find the admin to get companyId
        const admin = await User.findById(adminId);
        let query = { adminId };

        if (admin && admin.companyId) {
            query = { companyId: admin.companyId };
            console.log(`Admin belongs to company ${admin.companyId}. Fetching all company sites.`);
        }

        // Find sites that belong to this admin or company
        const sites = await Site.find(query).populate('supervisors', 'username');

        console.log(`Found ${sites.length} sites for query:`, query);

        res.json({
            success: true,
            count: sites.length,
            data: sites
        });
    } catch (error) {
        console.error('Error fetching sites:', error);
        res.status(500).json({ message: error.message });
    }
});

// Get single site with activity logs
router.get('/:id', checkSiteOwnership, async (req, res) => {
    try {
        // Site is already attached to the request by middleware
        let site = req.site;

        // Populate the supervisors
        await site.populate('supervisors', 'username');

        // Get recent activity logs (last 50)
        const activityLogs = await ActivityLogger.getActivityLogs(req.params.id, 50);

        res.json({
            success: true,
            data: {
                ...site.toObject(),
                activityLogs: undefined, // Remove full log history from payload
                recentActivityLogs: activityLogs
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get activity logs for a site
router.get('/:id/logs', checkSiteOwnership, async (req, res) => {
    try {
        const { action, limit = 50 } = req.query;

        let logs;
        if (action) {
            logs = await ActivityLogger.getActivityLogsByType(req.params.id, action, parseInt(limit));
        } else {
            logs = await ActivityLogger.getActivityLogs(req.params.id, parseInt(limit));
        }

        res.json({
            success: true,
            count: logs.length,
            data: logs
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Create new site
// Create new site
router.post('/', async (req, res) => {
    try {
        // Get admin ID from request body instead of auth token
        const adminId = req.body.adminId || req.user?.id;

        if (!adminId) {
            return res.status(401).json({
                success: false,
                message: 'Admin ID is required'
            });
        }

        // Verify that the admin user exists (allow company_owner too)
        const admin = await User.findOne({
            _id: adminId,
            role: { $in: ['admin', 'company_owner'] }
        });
        if (!admin) {
            return res.status(403).json({
                success: false,
                message: 'Invalid admin ID or user is not an admin/owner'
            });
        }

        // Extract supervisor data if provided
        const { supervisorUsername, supervisorPassword, supervisorFullName, ...siteDataWithoutSupervisor } = req.body;

        // Create site with adminId and companyId
        const siteData = {
            ...siteDataWithoutSupervisor,
            adminId,
            companyId: admin.companyId, // Add companyId from admin
            supervisors: [] // Initialize empty supervisors array
        };

        console.log('Creating site with data:', siteData);

        const site = new Site(siteData);
        await site.save();

        // Handle supervisor assignment
        let supervisor = null;

        // Scenario 1: Create NEW supervisor
        if (supervisorUsername && supervisorPassword) {
            // Check if supervisor username already exists
            const existingSupervisor = await User.findOne({
                username: supervisorUsername.toLowerCase().trim()
            });

            if (existingSupervisor) {
                // Rollback site creation
                await Site.findByIdAndDelete(site._id);

                return res.status(400).json({
                    success: false,
                    message: 'Supervisor username already exists'
                });
            }

            // Create supervisor user
            supervisor = new User({
                username: supervisorUsername.toLowerCase().trim(),
                password: supervisorPassword,
                fullName: supervisorFullName ? supervisorFullName.trim() : `Supervisor for ${siteData.siteName}`, // Fallback if missing
                role: 'supervisor',
                createdBy: adminId,
                companyId: admin.companyId, // Add companyId for the supervisor
                assignedSites: [site._id] // Assign this site
            });

            await supervisor.save();

            // Add supervisor to site's supervisors array
            site.supervisors.push(supervisor._id);
            await site.save();
        }
        // Scenario 2: Assign EXISTING supervisor (if supervisorId provided in body)
        else if (req.body.existingSupervisorId) {
            console.log('Assigning existing supervisor:', req.body.existingSupervisorId);
            supervisor = await User.findOne({ _id: req.body.existingSupervisorId, role: 'supervisor' });

            if (supervisor) {
                if (!supervisor.assignedSites) supervisor.assignedSites = [];
                // Add site to supervisor's assignedSites
                if (!supervisor.assignedSites.includes(site._id)) {
                    supervisor.assignedSites.push(site._id);
                    await supervisor.save();
                }

                // Add supervisor to site
                site.supervisors.push(supervisor._id);
                await site.save();
            }
        }

        // Get admin user for logging
        const adminUser = await getUser(adminId);

        // Log site creation with supervisor info if applicable
        if (adminUser) {
            const logDetails = {
                siteName: site.siteName,
                location: site.location
            };

            if (supervisor) {
                logDetails.supervisorCreated = true;
                logDetails.supervisorUsername = supervisor.username;
            }

            await ActivityLogger.logActivity(
                site._id,
                'site_created',
                adminUser,
                logDetails,
                `Site "${site.siteName}" created by ${adminUser.username}${supervisor ? ' with supervisor account' : ''}`
            );
        }

        // Populate supervisors before sending response
        await site.populate('supervisors', 'username');

        // Emit socket event
        const io = req.app.get('io');
        if (io && site.supervisors && site.supervisors.length > 0) {
            site.supervisors.forEach(sup => {
                const supId = sup._id || sup;
                io.to(`supervisor:${supId}`).emit('supervisor:update-available');
            });
        }

        res.status(201).json({
            success: true,
            message: supervisor ?
                'Site created successfully with supervisor account' :
                'Site created successfully',
            data: site
        });
    } catch (error) {
        console.error('Create site error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Update site
router.put('/:id', checkSiteOwnership, async (req, res) => {
    try {
        const oldSite = req.site; // Already fetched by middleware

        // Don't allow changing adminId
        const { adminId, ...updateData } = req.body;

        const site = await Site.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        // Get the admin user for logging
        const adminUser = await getUser(req.user?.id);

        if (adminUser) {
            await ActivityLogger.logActivity(
                site._id,
                'site_updated',
                adminUser,
                { oldData: oldSite.toObject(), newData: site.toObject() },
                `Site "${site.siteName}" updated by ${adminUser.username}`
            );
        }

        res.json({
            success: true,
            message: 'Site updated successfully',
            data: site
        });

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            // Re-fetch site with supervisors to ensure we have the list
            const updatedSite = await Site.findById(site._id).populate('supervisors');
            if (updatedSite && updatedSite.supervisors) {
                updatedSite.supervisors.forEach(sup => {
                    io.to(`supervisor:${sup._id}`).emit('supervisor:update-available');
                });
            }
        }
    } catch (error) {
        console.error('Update site error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Assign supervisor to site
router.post('/:id/assign-supervisor', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const { supervisorId } = req.body;
        const adminId = req.user?.id;

        if (!supervisorId) {
            return res.status(400).json({ success: false, message: 'Supervisor ID is required' });
        }

        const supervisor = await User.findOne({ _id: supervisorId, role: 'supervisor' });
        if (!supervisor) {
            return res.status(404).json({ success: false, message: 'Supervisor not found' });
        }

        // Check if already assigned
        if (site.supervisors.includes(supervisorId)) {
            return res.status(400).json({ success: false, message: 'Supervisor already assigned to this site' });
        }

        // Update Site
        site.supervisors.push(supervisorId);
        await site.save();

        // Update Supervisor
        if (!supervisor.assignedSites.includes(site._id)) {
            supervisor.assignedSites.push(site._id);
            await supervisor.save();
        }
        const io = req.app.get('io');
        if (io) {
            io.to(`supervisor:${supervisorId}`).emit('supervisor:update-available');
        }


        // Log activity
        const adminUser = await getUser(adminId);
        if (adminUser) {
            await ActivityLogger.logActivity(
                site._id,
                'supervisor_added',
                adminUser,
                { supervisorId: supervisor._id, supervisorUsername: supervisor.username },
                `Engineer "${supervisor.username}" assigned to site by ${adminUser.username}`
            );
        }

        // Return updated site
        await site.populate('supervisors', 'username');
        res.json({ success: true, message: 'Supervisor assigned successfully', data: site });

    } catch (error) {
        console.error('Assign supervisor error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Remove supervisor from site
router.post('/:id/remove-supervisor', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const { supervisorId } = req.body;
        const adminId = req.user?.id;

        if (!supervisorId) {
            return res.status(400).json({ success: false, message: 'Supervisor ID is required' });
        }

        // Update Site
        site.supervisors = site.supervisors.filter(id => id.toString() !== supervisorId);
        await site.save();

        // Update Supervisor
        const supervisor = await User.findById(supervisorId);
        if (supervisor) {
            supervisor.assignedSites = supervisor.assignedSites.filter(id => id.toString() !== site._id.toString());
            await supervisor.save();

            const io = req.app.get('io');
            if (io) {
                io.to(`supervisor:${supervisorId}`).emit('supervisor:update-available');
            }
        }

        // Log activity
        const adminUser = await getUser(adminId);
        if (adminUser) {
            await ActivityLogger.logActivity(
                site._id,
                'supervisor_removed',
                adminUser,
                { supervisorId, supervisorUsername: supervisor ? supervisor.username : 'Unknown' },
                `Supervisor "${supervisor ? supervisor.username : 'Unknown'}" removed from site by ${adminUser.username}`
            );
        }

        // Return updated site
        await site.populate('supervisors', 'username');
        res.json({ success: true, message: 'Supervisor removed successfully', data: site });

    } catch (error) {
        console.error('Remove supervisor error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Reset supervisor password
router.put('/:siteId/supervisors/:supervisorId/reset-password', checkSiteOwnership, async (req, res) => {
    try {
        const { siteId, supervisorId } = req.params;
        const { newPassword } = req.body;
        const adminId = req.user?.id;

        console.log('Reset password request received:');
        console.log('- Site ID:', siteId);
        console.log('- Supervisor ID:', supervisorId);
        console.log('- Admin ID:', adminId);
        console.log('- Password provided:', !!newPassword);

        if (!newPassword) {
            return res.status(400).json({
                success: false,
                message: 'New password is required'
            });
        }

        // Find the supervisor user
        const supervisor = await User.findById(supervisorId);

        if (!supervisor) {
            console.log('Supervisor not found with ID:', supervisorId);
            return res.status(404).json({
                success: false,
                message: 'Supervisor not found'
            });
        }

        console.log('Found supervisor:', supervisor.username);
        console.log('Supervisor role:', supervisor.role);
        console.log('Supervisor siteId:', supervisor.siteId);

        // Check if supervisor belongs to this site
        if (supervisor.role !== 'supervisor' || !supervisor.assignedSites ||
            !supervisor.assignedSites.some(id => id.toString() === siteId)) {
            console.log('Site ID mismatch or role issue:');
            console.log('- Expected siteId:', siteId);
            console.log('- Supervisor\'s assignedSites:', supervisor.assignedSites);
            console.log('- Role:', supervisor.role);

            return res.status(403).json({
                success: false,
                message: 'Supervisor does not belong to this site'
            });
        }

        // Find admin user for activity logging
        const admin = await getUser(adminId);
        console.log('Admin found:', admin ? admin.username : 'No admin with that ID');

        // Update the password
        supervisor.password = newPassword;
        await supervisor.save(); // This will trigger the password hashing hook
        console.log('Password updated successfully');

        // Add activity log
        try {
            const site = req.site; // Already fetched by middleware

            const logEntry = {
                action: 'supervisor_password_reset',
                performedBy: adminId,
                performedByName: admin ? admin.username : 'Admin',
                performedByRole: 'admin',
                details: {
                    supervisorId: supervisor._id,
                    supervisorUsername: supervisor.username
                },
                description: `Password was reset for supervisor "${supervisor.username}"`
            };

            console.log('Adding activity log:', logEntry);
            site.activityLogs.push(logEntry);

            await site.save();
            console.log('Activity log saved successfully');
        } catch (logError) {
            console.error('Error creating activity log (but password was reset):', logError);
            return res.json({
                success: true,
                message: 'Supervisor password reset successfully (error in activity log)'
            });
        }

        return res.json({
            success: true,
            message: 'Supervisor password reset successfully'
        });

    } catch (error) {
        console.error('Error resetting supervisor password:', error);
        console.error('Error stack:', error.stack);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while resetting the password',
            error: error.message
        });
    }
});

// Delete site
router.delete('/:id', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const siteName = site.siteName;
        const adminId = req.user?.id;

        // Delete site
        await Site.findByIdAndDelete(req.params.id);

        // Also delete associated supervisors
        await User.deleteMany({ siteId: req.params.id, role: 'supervisor' });

        // Log site deletion
        const adminUser = await getUser(adminId);
        if (adminUser) {
            console.log(`📝 Site "${siteName}" deleted by ${adminUser.username}`);

            // Log entry to centralized activity log
            // We use the adminUser as the performer and also as the source for companyId (via internal logic in ActivityLogger)
            // Since site is deleted, we can't attach logs to it, but centralized log will persistent
            await ActivityLogger.logActivity(
                req.params.id, // Target ID (ActivityLogger handles it if not found, but we want to record the ID)
                'site_deleted',
                adminUser,
                {
                    siteName: siteName,
                    location: site.location,
                    deletedAt: new Date()
                },
                `Site "${siteName}" deleted by ${adminUser.username}`
            );
        }

        res.json({
            success: true,
            message: 'Site deleted successfully'
        });

        // Emit socket event
        const io = req.app.get('io');
        if (io && site.supervisors) {
            // Notify supervisors they might need to refresh (or be logged out)
            site.supervisors.forEach(supId => {
                io.to(`supervisor:${supId}`).emit('supervisor:update-available');
            });
        }
    } catch (error) {
        console.error('Delete site error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Add supply to site
// Add supply (Only supervisors can add supplies)
// Add supply (Only supervisors can add supplies)
router.post('/:id/supplies', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;

        // Fetch complete user details
        const userDetails = await getUserWithDetails(user.id);

        if (!userDetails) {
            return res.status(404).json({ message: 'User not found' });
        }

        console.log('Complete user object:', {
            id: userDetails._id,
            username: userDetails.username,
            role: userDetails.role
        });

        // Only supervisors can add supplies
        if (user.role !== 'supervisor') {
            return res.status(403).json({ message: 'Only supervisors can add supplies' });
        }

        // Try to fetch price from inventory
        let inventoryPrice = null;
        if (site.companyId) {
            inventoryPrice = await getInventoryPrice(req.body.itemName, site.companyId);
            console.log(`Inventory price lookup for "${req.body.itemName}":`, inventoryPrice);
        }

        const newSupply = {
            itemName: req.body.itemName,
            quantity: req.body.quantity,
            unit: req.body.unit,
            addedBy: user.id,
            addedByName: userDetails.username, // Use the fetched username
            status: inventoryPrice ? 'priced' : 'pending_pricing',
            cost: inventoryPrice || undefined // Set cost if found in inventory
        };

        site.supplies.push(newSupply);
        await site.save();

        const addedSupply = site.supplies[site.supplies.length - 1];

        // Create a proper user object for logging with actual username
        const userForLogging = {
            _id: userDetails._id,
            id: userDetails._id,
            username: userDetails.username,
            role: userDetails.role
        };

        // Log activity with proper user object
        await ActivityLogger.logActivity(
            site._id,
            'supply_added',
            userForLogging,
            {
                supplyId: addedSupply._id,
                itemName: addedSupply.itemName,
                quantity: addedSupply.quantity,
                unit: addedSupply.unit,
                status: addedSupply.status
            },
            `${userDetails.username} added ${addedSupply.quantity} ${addedSupply.unit} of "${addedSupply.itemName}" ${addedSupply.cost ? `(₹${addedSupply.cost} from inventory)` : '(pending pricing)'}`
        );

        res.status(201).json({
            success: true,
            message: 'Supply added successfully',
            data: site
        });
    } catch (error) {
        console.error('Add supply error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Sync existing supplies with inventory prices (Admin only)
router.post('/:id/supplies/sync-prices', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;

        // Only admins can sync prices
        if (user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only admins can sync prices'
            });
        }

        if (!site.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Site must have a companyId to sync prices'
            });
        }

        let updated = 0;
        let notFound = 0;
        let alreadyPriced = 0;

        // Process each supply
        for (const supply of site.supplies) {
            // Skip if already has a price
            if (supply.cost) {
                alreadyPriced++;
                continue;
            }

            // Try to fetch price from inventory
            const inventoryPrice = await getInventoryPrice(supply.itemName, site.companyId);

            if (inventoryPrice) {
                supply.cost = inventoryPrice;
                supply.status = 'priced';
                updated++;
                console.log(`Updated price for "${supply.itemName}": ${inventoryPrice}`);

                // Emit notification
                eventBus.emit('PRICING_CONFIRMED', {
                    companyId: site.companyId,
                    itemName: supply.itemName,
                    addedBy: supply.addedBy,
                    referenceId: site._id
                });
            } else {
                notFound++;
            }
        }

        // Save the site with updated supplies
        await site.save();

        // Log the activity
        const userDetails = await getUserWithDetails(user.id);
        if (userDetails) {
            await ActivityLogger.logActivity(
                site._id,
                'supply_prices_synced',
                userDetails,
                {
                    updated,
                    notFound,
                    alreadyPriced,
                    totalProcessed: site.supplies.length
                },
                `${userDetails.username} synced prices from inventory: ${updated} updated, ${notFound} not found, ${alreadyPriced} already priced`
            );
        }

        res.json({
            success: true,
            message: 'Prices synced successfully',
            data: {
                totalSupplies: site.supplies.length,
                updated,
                notFound,
                alreadyPriced,
                supplies: site.supplies
            }
        });
    } catch (error) {
        console.error('Sync prices error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Add this new route for bulk import
router.post('/:id/supplies/bulk-import', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;
        const { supplies } = req.body;

        // Fetch complete user details
        const userDetails = await getUserWithDetails(user.id);

        if (!userDetails) {
            return res.status(404).json({ message: 'User not found' });
        }

        console.log('Bulk import by user:', {
            id: userDetails._id,
            username: userDetails.username,
            role: userDetails.role
        });

        // Only supervisors can add supplies
        if (user.role !== 'supervisor') {
            return res.status(403).json({ message: 'Only supervisors can add supplies' });
        }

        // Validate supplies array
        if (!supplies || !Array.isArray(supplies) || supplies.length === 0) {
            return res.status(400).json({ message: 'Invalid supplies data' });
        }

        // Additional validation: Check maximum import size to prevent abuse
        const MAX_IMPORT_SIZE = 1000; // Adjust based on your needs
        if (supplies.length > MAX_IMPORT_SIZE) {
            return res.status(400).json({
                message: `Too many items. Maximum ${MAX_IMPORT_SIZE} items allowed per import.`
            });
        }

        // Create maps for tracking
        const existingSuppliesMap = new Map();
        const results = {
            created: [],
            updated: [],
            errors: [],
            duplicatesInFile: 0 // Track duplicates within the import file
        };

        // Array to store activity logs to be added later
        const activityLogs = [];

        // Build map of existing supplies by normalized name
        site.supplies.forEach(supply => {
            const normalizedName = supply.itemName.toLowerCase().trim();
            existingSuppliesMap.set(normalizedName, supply);
        });

        // Track items already processed in this import to handle duplicates
        const processedInImport = new Map();

        // Process each imported supply
        for (const [index, importedSupply] of supplies.entries()) {
            try {
                // Validate required fields
                if (!importedSupply.itemName || importedSupply.itemName.trim() === '') {
                    results.errors.push({
                        row: index + 2, // +2 for header and 1-based indexing
                        itemName: 'Unknown',
                        error: 'Missing item name'
                    });
                    continue;
                }

                if (importedSupply.quantity === undefined ||
                    importedSupply.quantity === null ||
                    importedSupply.quantity === '') {
                    results.errors.push({
                        row: index + 2,
                        itemName: importedSupply.itemName,
                        error: 'Missing quantity'
                    });
                    continue;
                }

                const quantity = parseFloat(importedSupply.quantity);
                if (isNaN(quantity) || quantity <= 0) {
                    results.errors.push({
                        row: index + 2,
                        itemName: importedSupply.itemName,
                        error: 'Invalid quantity: must be a positive number'
                    });
                    continue;
                }

                // Validate unit
                const unit = importedSupply.unit || 'pcs';
                if (unit.trim() === '') {
                    results.errors.push({
                        row: index + 2,
                        itemName: importedSupply.itemName,
                        error: 'Empty unit value'
                    });
                    continue;
                }

                const normalizedName = importedSupply.itemName.toLowerCase().trim();

                // Check for duplicates within the import file
                if (processedInImport.has(normalizedName)) {
                    // Aggregate quantities for duplicates in the same import
                    const existing = processedInImport.get(normalizedName);
                    existing.quantity += quantity;
                    results.duplicatesInFile++;
                    continue;
                } else {
                    processedInImport.set(normalizedName, {
                        itemName: importedSupply.itemName.trim(),
                        quantity: quantity,
                        unit: unit
                    });
                }
            } catch (error) {
                console.error(`Error validating supply at row ${index + 2}:`, error);
                results.errors.push({
                    row: index + 2,
                    itemName: importedSupply.itemName || 'Unknown',
                    error: error.message
                });
            }
        }

        // Now process the deduplicated items
        for (const [normalizedName, importData] of processedInImport) {
            try {
                const existingSupply = existingSuppliesMap.get(normalizedName);

                if (existingSupply) {
                    // Update existing supply quantity
                    const oldQuantity = existingSupply.quantity;
                    const addedQuantity = importData.quantity;

                    existingSupply.quantity = oldQuantity + addedQuantity;

                    results.updated.push({
                        itemName: existingSupply.itemName,
                        oldQuantity: oldQuantity,
                        addedQuantity: addedQuantity,
                        newQuantity: existingSupply.quantity,
                        unit: existingSupply.unit
                    });

                    // Prepare activity log
                    activityLogs.push({
                        action: 'supply_updated',
                        performedBy: userDetails._id,
                        performedByName: userDetails.username,
                        performedByRole: userDetails.role,
                        details: {
                            supplyId: existingSupply._id,
                            itemName: existingSupply.itemName,
                            oldQuantity: oldQuantity,
                            addedQuantity: addedQuantity,
                            newQuantity: existingSupply.quantity,
                            unit: existingSupply.unit,
                            updateMethod: 'bulk_import'
                        },
                        description: `${userDetails.username} updated quantity of "${existingSupply.itemName}" from ${oldQuantity} to ${existingSupply.quantity} ${existingSupply.unit} (added ${addedQuantity} via import)`
                    });
                } else {
                    // Create new supply
                    // Try to fetch price from inventory
                    let inventoryPrice = null;
                    if (site.companyId) {
                        inventoryPrice = await getInventoryPrice(importData.itemName, site.companyId);
                        if (inventoryPrice) {
                            console.log(`Inventory price found for "${importData.itemName}": ${inventoryPrice}`);
                        }
                    }

                    const newSupply = {
                        itemName: importData.itemName,
                        quantity: importData.quantity,
                        unit: importData.unit,
                        addedBy: userDetails._id,
                        addedByName: userDetails.username,
                        status: inventoryPrice ? 'priced' : 'pending_pricing',
                        cost: inventoryPrice || undefined,
                        createdAt: new Date()
                    };

                    site.supplies.push(newSupply);

                    results.created.push({
                        itemName: newSupply.itemName,
                        quantity: newSupply.quantity,
                        unit: newSupply.unit
                    });
                }
            } catch (error) {
                console.error(`Error processing supply ${importData.itemName}:`, error);
                results.errors.push({
                    itemName: importData.itemName,
                    error: error.message
                });
            }
        }

        // Add all activity logs to the site
        site.activityLogs.push(...activityLogs);

        // Add a summary activity log for the bulk import
        const summaryMessage = results.duplicatesInFile > 0
            ? `${userDetails.username} bulk imported ${supplies.length} supplies (${results.duplicatesInFile} duplicates merged): ${results.created.length} created, ${results.updated.length} updated, ${results.errors.length} errors`
            : `${userDetails.username} bulk imported ${supplies.length} supplies: ${results.created.length} created, ${results.updated.length} updated, ${results.errors.length} errors`;

        site.activityLogs.push({
            action: 'supply_added',
            performedBy: userDetails._id,
            performedByName: userDetails.username,
            performedByRole: userDetails.role,
            details: {
                isBulkImport: true,
                totalImported: supplies.length,
                created: results.created.length,
                updated: results.updated.length,
                errors: results.errors.length,
                duplicatesInFile: results.duplicatesInFile,
                importSummary: {
                    createdItems: results.created,
                    updatedItems: results.updated,
                    failedItems: results.errors
                }
            },
            description: summaryMessage
        });

        // Save all changes at once
        await site.save();

        // Return the updated site
        res.status(200).json({
            success: true,
            message: `Import completed: ${results.created.length} created, ${results.updated.length} updated${results.duplicatesInFile > 0 ? `, ${results.duplicatesInFile} duplicates merged` : ''}, ${results.errors.length} errors`,
            data: site,
            importResults: results
        });

    } catch (error) {
        console.error('Bulk import error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to import supplies',
            error: error.message
        });
    }
});

// Optional: Add a route to download template
router.get('/supplies/template', checkSiteOwnership, async (req, res) => {
    try {
        // Create sample data
        const templateData = [
            ['Item Name', 'Quantity', 'Unit'],
            ['Cement Bags', '100', 'pcs'],
            ['Steel Rods', '500', 'kg'],
            ['Sand', '10', 'tons'],
            ['Bricks', '5000', 'pcs'],
            ['Paint', '25', 'liters']
        ];

        // Convert to CSV
        const csvContent = templateData.map(row => row.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="supplies_import_template.csv"');
        res.send(csvContent);

    } catch (error) {
        console.error('Template download error:', error);
        res.status(500).json({ message: 'Failed to generate template' });
    }
});
// Update supply pricing (Admin only)
// router.put('/:siteId/supplies/:supplyId/pricing', checkSiteOwnership, async (req, res) => {
//     try {
//         const site = req.site;
//         const user = req.user;

//         // Fetch complete user details
//         const userDetails = await getUserWithDetails(user.id);

//         if (!userDetails) {
//             return res.status(404).json({ message: 'User not found' });
//         }

//         console.log('Complete user object:', {
//             id: userDetails._id,
//             username: userDetails.username,
//             role: userDetails.role
//         });

//         // Only admins can set pricing
//         if (user.role !== 'admin') {
//             return res.status(403).json({ message: 'Only admins can set supply pricing' });
//         }

//         const supply = site.supplies.id(req.params.supplyId);
//         if (!supply) {
//             return res.status(404).json({ message: 'Supply not found' });
//         }

//         const oldCost = supply.cost;
//         supply.cost = req.body.cost;
//         supply.status = 'priced';
//         supply.pricedBy = user.id;
//         supply.pricedByName = userDetails.username; // Use the fetched username
//         supply.pricedAt = new Date();

//         await site.save();

//         // Create a proper user object for logging
//         const userForLogging = {
//             _id: userDetails._id,
//             id: userDetails._id,
//             username: userDetails.username,
//             role: userDetails.role
//         };

//         // Log activity
//         await ActivityLogger.logActivity(
//             site._id,
//             'supply_updated',
//             userForLogging,
//             {
//                 supplyId: supply._id,
//                 itemName: supply.itemName,
//                 oldCost: oldCost || 'Pending',
//                 newCost: supply.cost,
//                 totalValue: supply.quantity * supply.cost
//             },
//             `${userDetails.username} set pricing for "${supply.itemName}" at ₹${supply.cost} per ${supply.unit}`
//         );

//         res.json({
//             success: true,
//             message: 'Supply pricing updated successfully',
//             data: site
//         });
//     } catch (error) {
//         console.error('Error updating supply pricing:', error);
//         res.status(500).json({ message: error.message });
//     }
// });

// Update supply
router.put('/:siteId/supplies/:supplyId/pricing', checkSiteOwnership, async (req, res) => {
    try {
        const { siteId, supplyId } = req.params; // Extract both siteId and supplyId
        const { cost, currency } = req.body; // Extract cost and currency from body
        const site = req.site;
        const user = req.user;

        console.log('Updating supply pricing:', {
            siteId,
            supplyId,
            cost,
            currency,
            userRole: user.role
        });

        // Fetch complete user details
        const userDetails = await getUserWithDetails(user.id);

        if (!userDetails) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log('Complete user object:', {
            id: userDetails._id,
            username: userDetails.username,
            role: userDetails.role
        });

        // Only admins can set pricing
        if (user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only admins can set supply pricing' });
        }

        const supply = site.supplies.id(supplyId); // Use the extracted supplyId
        if (!supply) {
            return res.status(404).json({ success: false, message: 'Supply not found' });
        }

        // Validate cost
        if (!cost || isNaN(cost) || Number(cost) < 0) {
            return res.status(400).json({ success: false, message: 'Valid cost is required' });
        }

        const oldCost = supply.cost;
        supply.cost = Number(cost);
        supply.currentPrice = Number(cost); // Also update currentPrice
        supply.status = 'priced';
        supply.isPriced = true; // Mark as priced
        supply.pricedBy = user.id;
        supply.pricedByName = userDetails.username;
        supply.pricedAt = new Date();

        // Update currency if provided
        if (currency) {
            supply.currency = currency;
        }

        console.log('Supply pricing updated:', {
            itemName: supply.itemName,
            oldCost,
            newCost: supply.cost,
            currency: supply.currency,
            isPriced: supply.isPriced
        });

        await site.save();

        // Emit notification
        eventBus.emit('PRICING_CONFIRMED', {
            companyId: site.companyId,
            itemName: supply.itemName,
            addedBy: supply.addedBy,
            referenceId: site._id
        });

        // Log activity (fix the activity logger call)
        try {
            await ActivityLogger.logActivity(
                siteId, // Use the extracted siteId
                'supply_updated',
                userDetails, // Use userDetails instead of req.user
                {
                    supplyId,
                    supplyName: supply.itemName,
                    cost: Number(cost),
                    currency: currency || supply.currency || '₹',
                    unit: supply.unit,
                    oldCost
                },
                `${userDetails.username} set pricing for '${supply.itemName}' at ${currency || supply.currency || '₹'}${cost} per ${supply.unit}`
            );
        } catch (logError) {
            console.error('Error logging activity:', logError);
            // Don't fail the request if logging fails
        }

        res.json({
            success: true,
            message: 'Supply pricing updated successfully',
            data: {
                supply: {
                    _id: supply._id,
                    itemName: supply.itemName,
                    quantity: supply.quantity,
                    unit: supply.unit,
                    cost: supply.cost,
                    currency: supply.currency,
                    isPriced: supply.isPriced,
                    pricedBy: supply.pricedBy,
                    pricedByName: supply.pricedByName,
                    pricedAt: supply.pricedAt
                }
            }
        });

    } catch (error) {
        console.error('Error updating supply pricing:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// Delete supply
// Update supply details
router.put('/:siteId/supplies/:supplyId', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;

        // Fetch complete user details
        const userDetails = await getUserWithDetails(user.id);

        if (!userDetails) {
            return res.status(404).json({ message: 'User not found' });
        }

        const supply = site.supplies.id(req.params.supplyId);
        if (!supply) {
            return res.status(404).json({ message: 'Supply not found' });
        }

        const oldSupply = {
            itemName: supply.itemName,
            quantity: supply.quantity,
            unit: supply.unit,
            cost: supply.cost
        };

        // Supervisors can only update basic details
        if (user.role === 'supervisor') {
            supply.itemName = req.body.itemName || supply.itemName;
            supply.quantity = req.body.quantity || supply.quantity;
            supply.unit = req.body.unit || supply.unit;
        } else if (user.role === 'admin') {
            // Admins can update everything including cost
            if (req.body.itemName) supply.itemName = req.body.itemName;
            if (req.body.quantity) supply.quantity = req.body.quantity;
            if (req.body.unit) supply.unit = req.body.unit;
            if (req.body.cost) {
                supply.cost = req.body.cost;
                supply.status = 'priced';
                supply.pricedBy = user.id;
                supply.pricedByName = userDetails.username;
                supply.pricedAt = new Date();
            }
        }

        await site.save();

        // Create a proper user object for logging
        const userForLogging = {
            _id: userDetails._id,
            id: userDetails._id,
            username: userDetails.username,
            role: userDetails.role
        };

        // Calculate quantity change for better logging
        const quantityChange = supply.quantity - oldSupply.quantity;
        let changeDescription = '';

        if (quantityChange > 0) {
            changeDescription = `(increased supply by ${quantityChange} ${supply.unit})`;
        } else if (quantityChange < 0) {
            changeDescription = `(decreased supply by ${Math.abs(quantityChange)} ${supply.unit})`;
        } else {
            changeDescription = '(no quantity change)';
        }

        // Create different log descriptions based on what was changed
        let logDescription = '';

        if (user.role === 'admin' && req.body.cost) {
            // Get currency from request body or use default
            const currency = req.body.currency || '₹';

            // Admin updated pricing
            logDescription = `${userDetails.username} updated pricing for "${supply.itemName}" to ${currency}${supply.cost} per ${supply.unit}`;

            // Include currency in log details
            logDetails.currency = currency;
            logDetails.previousCost = oldSupply.cost;
            logDetails.newCost = supply.cost;
        } else if (quantityChange !== 0) {
            // Quantity was changed
            logDescription = `${userDetails.username} updated "${supply.itemName}" from ${oldSupply.quantity} to ${supply.quantity} ${supply.unit} ${changeDescription}`;
        } else if (oldSupply.itemName !== supply.itemName) {
            // Item name was changed
            logDescription = `${userDetails.username} updated item name from "${oldSupply.itemName}" to "${supply.itemName}"`;
        } else if (oldSupply.unit !== supply.unit) {
            // Unit was changed
            logDescription = `${userDetails.username} updated unit for "${supply.itemName}" from ${oldSupply.unit} to ${supply.unit}`;
        } else {
            // Generic update
            logDescription = `${userDetails.username} updated supply "${supply.itemName}"`;
        }

        // Log activity
        await ActivityLogger.logActivity(
            site._id,
            'supply_updated',
            userForLogging,
            {
                supplyId: supply._id,
                itemName: supply.itemName,
                oldQuantity: oldSupply.quantity,
                newQuantity: supply.quantity,
                quantityChange: quantityChange,
                changeType: quantityChange > 0 ? 'increased' : quantityChange < 0 ? 'decreased' : 'no_change',
                oldCost: oldSupply.cost,
                newCost: supply.cost,
                oldUnit: oldSupply.unit,
                newUnit: supply.unit,
                oldItemName: oldSupply.itemName,
                newItemName: supply.itemName,
                unit: supply.unit
            },
            logDescription
        );

        res.json({
            success: true,
            message: 'Supply updated successfully',
            data: site
        });
    } catch (error) {
        console.error('Error updating supply:', error);
        res.status(500).json({ message: error.message });
    }
});

router.delete('/:siteId/supplies/:supplyId', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;

        // Fetch complete user details
        const userDetails = await getUserWithDetails(user.id);

        if (!userDetails) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Only admins can delete supplies
        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Only admins can delete supplies' });
        }

        const supply = site.supplies.id(req.params.supplyId);
        if (!supply) {
            return res.status(404).json({ message: 'Supply not found' });
        }

        const deletedSupply = {
            itemName: supply.itemName,
            quantity: supply.quantity,
            cost: supply.cost,
            unit: supply.unit
        };

        site.supplies.pull(req.params.supplyId);
        await site.save();

        // Create a proper user object for logging
        const userForLogging = {
            _id: userDetails._id,
            id: userDetails._id,
            username: userDetails.username,
            role: userDetails.role
        };

        // Log activity
        await ActivityLogger.logActivity(
            site._id,
            'supply_deleted',
            userForLogging,
            {
                itemName: deletedSupply.itemName,
                quantity: deletedSupply.quantity,
                cost: deletedSupply.cost || 'Not priced',
                unit: deletedSupply.unit
            },
            `${userDetails.username} deleted ${deletedSupply.quantity} ${deletedSupply.unit} of "${deletedSupply.itemName}"`
        );

        res.json({
            success: true,
            message: 'Supply deleted successfully',
            data: site
        });
    } catch (error) {
        console.error('Delete supply error:', error);
        res.status(500).json({ message: error.message });
    }
});


// Add worker to site
router.post('/:id/workers', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const newWorker = req.body;
        site.workers.push(newWorker);
        await site.save();

        // Get the newly added worker (last one in array)
        const addedWorker = site.workers[site.workers.length - 1];

        // Determine who added the worker
        let user = null;
        if (req.body.supervisorId) {
            user = await User.findById(req.body.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (user) {
            await ActivityLogger.logActivity(
                site._id,
                'worker_added',
                user,
                {
                    workerId: addedWorker._id,
                    workerName: addedWorker.name,
                    workerRole: addedWorker.role,
                    phoneNumber: addedWorker.phoneNumber
                },
                `${user.username} added worker "${addedWorker.name}" (${addedWorker.role})`
            );
        }

        res.status(201).json({
            success: true,
            message: 'Worker added successfully',
            data: site
        });
    } catch (error) {
        console.error('Add worker error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Update worker
router.put('/:siteId/workers/:workerId', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const worker = site.workers.id(req.params.workerId);
        if (!worker) {
            return res.status(404).json({ message: 'Worker not found' });
        }

        // Store old values for logging
        const oldWorker = {
            name: worker.name,
            role: worker.role,
            phoneNumber: worker.phoneNumber
        };

        // Update worker
        Object.assign(worker, req.body);
        await site.save();

        // Determine who updated the worker
        let user = null;
        if (req.body.supervisorId) {
            user = await User.findById(req.body.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (user) {
            await ActivityLogger.logActivity(
                site._id,
                'worker_updated',
                user,
                {
                    workerId: worker._id,
                    oldData: oldWorker,
                    newData: {
                        name: worker.name,
                        role: worker.role,
                        phoneNumber: worker.phoneNumber
                    }
                },
                `${user.username} updated worker "${worker.name}" details`
            );
        }

        res.json({
            success: true,
            message: 'Worker updated successfully',
            data: site
        });
    } catch (error) {
        console.error('Update worker error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Delete worker
router.delete('/:siteId/workers/:workerId', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const worker = site.workers.id(req.params.workerId);
        if (!worker) {
            return res.status(404).json({ message: 'Worker not found' });
        }

        // Store worker details for logging
        const deletedWorker = {
            name: worker.name,
            role: worker.role,
            phoneNumber: worker.phoneNumber
        };

        // Use pull method to remove the worker
        site.workers.pull(req.params.workerId);
        await site.save();

        // Determine who deleted the worker
        let user = null;
        if (req.query.supervisorId) {
            user = await User.findById(req.query.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (user) {
            await ActivityLogger.logActivity(
                site._id,
                'worker_deleted',
                user,
                {
                    workerName: deletedWorker.name,
                    workerRole: deletedWorker.role,
                    phoneNumber: deletedWorker.phoneNumber
                },
                `${user.username} removed worker "${deletedWorker.name}" (${deletedWorker.role})`
            );
        }

        res.json({
            success: true,
            message: 'Worker deleted successfully',
            data: site
        });
    } catch (error) {
        console.error('Delete worker error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Mark attendance
router.post('/:siteId/workers/:workerId/attendance', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const worker = site.workers.id(req.params.workerId);
        if (!worker) {
            return res.status(404).json({ message: 'Worker not found' });
        }

        const attendanceData = req.body;
        const today = new Date().toDateString();
        const attendanceDate = attendanceData.date ? new Date(attendanceData.date).toDateString() : today;

        // Check if attendance for this date already exists
        const existingAttendance = worker.attendance.find(
            att => new Date(att.date).toDateString() === attendanceDate
        );

        let actionType = 'attendance_marked';
        let description = '';

        // Determine who marked the attendance
        let user = null;
        if (req.body.supervisorId) {
            user = await User.findById(req.body.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (existingAttendance) {
            // Update existing attendance
            const oldStatus = existingAttendance.status;
            existingAttendance.status = attendanceData.status || 'present';
            actionType = 'attendance_updated';

            description = `${user ? user.username : 'Unknown'} updated ${worker.name}'s attendance from ${oldStatus} to ${existingAttendance.status} on ${new Date(attendanceDate).toLocaleDateString()}`;
        } else {
            // Add new attendance
            worker.attendance.push({
                date: attendanceData.date || new Date(),
                status: attendanceData.status || 'present'
            });

            description = `${user ? user.username : 'Unknown'} marked ${worker.name} as ${attendanceData.status || 'present'} on ${new Date(attendanceData.date || new Date()).toLocaleDateString()}`;
        }

        await site.save();

        // Log attendance action
        if (user) {
            await ActivityLogger.logActivity(
                site._id,
                actionType,
                user,
                {
                    workerId: worker._id,
                    workerName: worker.name,
                    date: attendanceData.date || new Date(),
                    status: attendanceData.status || 'present'
                },
                description
            );
        }

        res.status(201).json({
            success: true,
            message: existingAttendance ? 'Attendance updated successfully' : 'Attendance marked successfully',
            data: site
        });
    } catch (error) {
        console.error('Attendance error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Create supervisor for site
// In routes/sites.js - Modify the supervisor creation endpoint

// Create supervisor for site
// routes/sites.js - Update supervisor creation error handling
router.post('/:id/supervisors', checkSiteOwnership, async (req, res) => {
    try {
        const { username, password, fullName } = req.body;
        const adminId = req.user?.id;
        const siteId = req.params.id;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required',
                field: 'required'
            });
        }

        const cleanUsername = username.toLowerCase().trim();

        // Validate username format
        const usernameRegex = /^[a-z0-9_]{3,30}$/;
        if (!usernameRegex.test(cleanUsername)) {
            return res.status(400).json({
                success: false,
                message: 'Username must be 3-30 characters long and can only contain lowercase letters, numbers, and underscores',
                field: 'username'
            });
        }

        // Check manually if username already exists
        const existingUser = await User.findOne({ username: cleanUsername });
        if (existingUser) {
            const suggestedUsername = await suggestUsernameFallback(cleanUsername);
            return res.status(400).json({
                success: false,
                message: 'Username already exists. Try adding numbers or choose a different username.',
                field: 'username',
                suggestedUsername,
                errorType: 'USERNAME_EXISTS'
            });
        }

        // Fetch admin to get companyId
        const adminUserForCompany = await User.findById(adminId);
        if (!adminUserForCompany || !adminUserForCompany.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Could not determine company for supervisor creation.'
            });
        }

        // Create supervisor
        const supervisor = new User({
            username: cleanUsername,
            password,
            fullName: fullName || '', // Save full name if provided
            role: 'supervisor',
            assignedSites: [siteId],
            companyId: adminUserForCompany.companyId
        });

        await supervisor.save();

        // Add to site
        await Site.findByIdAndUpdate(
            siteId,
            { $push: { supervisors: supervisor._id } }
        );
        // 🔔 REAL-TIME UPDATE (if supervisor is logged in already)
        const io = req.app.get('io');
        if (io) {
            io.to(`supervisor:${supervisor._id}`).emit('supervisor:update-available');
        }


        // Log activity
        const adminUser = await getUser(adminId);
        if (adminUser) {
            await ActivityLogger.logActivity(
                siteId,
                'supervisor_added',
                adminUser,
                {
                    supervisorId: supervisor._id,
                    supervisorUsername: supervisor.username
                },
                `${adminUser.username} created supervisor account for "${supervisor.username}"`
            );
        }

        res.status(201).json({
            success: true,
            message: 'Supervisor created successfully',
            data: {
                id: supervisor._id,
                username: supervisor.username
            }
        });

    } catch (error) {
        console.error('Error creating supervisor:', error);

        if (error.code === 11000) {
            const suggestedUsername = await suggestUsernameFallback(req.body.username);
            return res.status(400).json({
                success: false,
                message: 'Username already exists. Try adding numbers or choose a different username.',
                field: 'username',
                suggestedUsername,
                errorType: 'USERNAME_EXISTS'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'An error occurred during registration',
            errorType: 'SERVER_ERROR',
            error: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }
});


// Remove supervisor (Unassign from site)
router.delete('/:siteId/supervisors/:supervisorId', checkSiteOwnership, async (req, res) => {
    try {
        const adminId = req.user?.id;
        const { siteId, supervisorId } = req.params;

        // Get supervisor info
        const supervisor = await User.findById(supervisorId);
        const supervisorName = supervisor ? supervisor.username : 'Unknown';

        // Remove site from supervisor's assignedSites if user exists
        if (supervisor) {
            if (supervisor.assignedSites) {
                // Filter out the current site ID
                supervisor.assignedSites = supervisor.assignedSites.filter(id => id.toString() !== siteId.toString());
                await supervisor.save();
            }
        }

        // Remove supervisor from site
        await Site.findByIdAndUpdate(
            siteId,
            { $pull: { supervisors: supervisorId } }
        );

        // Get admin user for logging
        const adminUser = await getUser(adminId);

        if (adminUser) {
            await ActivityLogger.logActivity(
                siteId,
                'supervisor_removed',
                adminUser,
                {
                    supervisorId,
                    supervisorUsername: supervisorName
                },
                `${adminUser.username} removed engineer "${supervisorName}" from site`
            );
        }

        const io = req.app.get('io');
        if (io) {
            io.to(`supervisor:${supervisorId}`).emit('supervisor:update-available');
        }

        res.json({
            success: true,
            message: 'Supervisor removed from site successfully'
        });
    } catch (error) {
        console.error('Remove supervisor error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Get announcements for a site
router.get('/:id/announcements', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware

        // Populate announcement details
        await site.populate('announcements.createdBy', 'username role');
        await site.populate('announcements.readBy.user', 'username');

        // Sort announcements by creation date (newest first)
        const announcements = site.announcements
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({
            success: true,
            data: announcements
        });
    } catch (error) {
        console.error('Get announcements error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Create new announcement
router.post('/:id/announcements', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const { title, content, isUrgent, media, mediaType, supervisorId } = req.body;

        // Determine who is creating the announcement
        let creatorUser = null;
        if (supervisorId) {
            creatorUser = await User.findById(supervisorId);
        } else {
            creatorUser = await getUser(adminId);
        }

        if (!creatorUser) {
            return res.status(401).json({
                success: false,
                message: 'Creator user not found'
            });
        }

        const newAnnouncement = {
            title,
            content,
            createdBy: creatorUser._id,
            createdByName: creatorUser.username,
            isUrgent: isUrgent || false,
            media: media || null,
            mediaType: mediaType || null
        };

        site.announcements.push(newAnnouncement);
        await site.save();

        // Get the newly created announcement
        const createdAnnouncement = site.announcements[site.announcements.length - 1];

        // Log announcement creation
        await ActivityLogger.logActivity(
            site._id,
            'announcement_created',
            creatorUser,
            {
                announcementId: createdAnnouncement._id,
                title: createdAnnouncement.title,
                isUrgent: createdAnnouncement.isUrgent,
                hasMedia: !!createdAnnouncement.media
            },
            `${creatorUser.username} created ${isUrgent ? 'urgent ' : ''}announcement: "${title}"`
        );

        res.status(201).json({
            success: true,
            message: 'Announcement created successfully',
            data: createdAnnouncement
        });
    } catch (error) {
        console.error('Create announcement error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Update announcement
router.put('/:siteId/announcements/:announcementId', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const announcement = site.announcements.id(req.params.announcementId);
        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found' });
        }

        const oldData = {
            title: announcement.title,
            content: announcement.content,
            isUrgent: announcement.isUrgent
        };

        // Update announcement (don't update createdBy)
        const { createdBy, createdByName, ...updateData } = req.body;
        Object.assign(announcement, updateData);
        await site.save();

        // Determine who updated the announcement
        let user = null;
        if (req.body.supervisorId) {
            user = await User.findById(req.body.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (user) {
            await ActivityLogger.logActivity(
                site._id,
                'announcement_updated',
                user,
                {
                    announcementId: announcement._id,
                    oldData,
                    newData: {
                        title: announcement.title,
                        content: announcement.content,
                        isUrgent: announcement.isUrgent
                    }
                },
                `${user.username} updated announcement: "${announcement.title}"`
            );
        }

        res.json({
            success: true,
            message: 'Announcement updated successfully',
            data: announcement
        });
    } catch (error) {
        console.error('Update announcement error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Delete announcement
router.delete('/:siteId/announcements/:announcementId', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const announcement = site.announcements.id(req.params.announcementId);
        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found' });
        }

        const deletedData = {
            title: announcement.title,
            content: announcement.content,
            isUrgent: announcement.isUrgent
        };

        // Remove announcement from site
        site.announcements.pull(req.params.announcementId);
        await site.save();

        // Determine who deleted the announcement
        let user = null;
        if (req.query.supervisorId) {
            user = await User.findById(req.query.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (user) {
            await ActivityLogger.logActivity(
                site._id,
                'announcement_deleted',
                user,
                {
                    title: deletedData.title,
                    content: deletedData.content,
                    isUrgent: deletedData.isUrgent
                },
                `${user.username} deleted announcement: "${deletedData.title}"`
            );
        }

        res.json({
            success: true,
            message: 'Announcement deleted successfully'
        });
    } catch (error) {
        console.error('Delete announcement error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Mark announcement as read
router.post('/:siteId/announcements/:announcementId/read', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site; // Already fetched by middleware
        const adminId = req.user?.id;

        const announcement = site.announcements.id(req.params.announcementId);
        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found' });
        }

        // Determine the user who is marking as read
        let user = null;
        if (req.body.supervisorId) {
            user = await User.findById(req.body.supervisorId);
        } else {
            user = await getUser(adminId);
        }

        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        // Check if user has already read this announcement
        const existingRead = announcement.readBy.find(
            read => read.user.toString() === user._id.toString()
        );

        if (!existingRead) {
            announcement.readBy.push({
                user: user._id,
                readAt: new Date()
            });
            await site.save();
        }

        res.json({
            success: true,
            message: 'Announcement marked as read'
        });
    } catch (error) {
        console.error('Mark announcement as read error:', error);
        res.status(500).json({ message: error.message });
    }
});

router.post('/:id/supply-requests', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;

        // Only supervisors can request supplies
        if (user.role !== 'supervisor') {
            return res.status(403).json({ message: 'Only supervisors can request supplies' });
        }

        const { itemName, requestedQuantity, unit, warehouseId } = req.body;

        if (!itemName || !requestedQuantity || !unit || !warehouseId) {
            return res.status(400).json({
                success: false,
                message: 'itemName, requestedQuantity, unit, and warehouseId are required'
            });
        }

        // Verify warehouse exists
        const warehouse = await Warehouse.findById(warehouseId);
        if (!warehouse) {
            return res.status(404).json({ success: false, message: 'Warehouse not found' });
        }

        // Check if warehouse has the requested item
        const warehouseSupply = warehouse.supplies.find(
            supply => supply.itemName.toLowerCase() === itemName.toLowerCase()
        );

        if (!warehouseSupply) {
            return res.status(400).json({
                success: false,
                message: `Item "${itemName}" not available in warehouse`
            });
        }

        if (warehouseSupply.quantity < requestedQuantity) {
            return res.status(400).json({
                success: false,
                message: `Insufficient quantity in warehouse. Available: ${warehouseSupply.quantity}`
            });
        }

        // Get user details
        const userDetails = await User.findById(user.id);

        // Create supply request
        const supplyRequest = new SupplyRequest({
            siteId: site._id,
            siteName: site.siteName,
            warehouseId: warehouseId,
            requestedBy: user.id,
            requestedByName: userDetails.username,
            itemName,
            requestedQuantity,
            unit
        });

        await supplyRequest.save();

        // Add activity log to site
        site.activityLogs.push({
            action: 'supply_requested',
            performedBy: user.id,
            performedByName: userDetails.username,
            performedByRole: user.role,
            timestamp: new Date(),
            details: {
                itemName,
                requestedQuantity,
                unit,
                warehouseName: warehouse.warehouseName,
                requestId: supplyRequest._id
            },
            description: `${userDetails.username} requested ${requestedQuantity} ${unit} of "${itemName}" from ${warehouse.warehouseName}`
        });

        await site.save();

        res.status(201).json({
            success: true,
            message: 'Supply request created successfully',
            data: supplyRequest
        });
    } catch (error) {
        console.error('Create supply request error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Get supply requests for a site
// router.get('/:id/supply-requests', checkSiteOwnership, async (req, res) => {
//     try {
//         const siteId = req.params.id;

//         const supplyRequests = await SupplyRequest.find({ siteId })
//             .populate('warehouseId', 'warehouseName')
//             .populate('handledBy', 'username')
//             .sort({ createdAt: -1 });

//         res.json({
//             success: true,
//             data: supplyRequests
//         });
//     } catch (error) {
//         console.error('Get supply requests error:', error);
//         res.status(500).json({ message: error.message });
//     }
// });
router.get('/:id/supply-requests', checkSiteOwnership, async (req, res) => {
    try {
        const siteId = req.params.id;
        const { status, batchId } = req.query; // Add query filters

        const query = { siteId };
        if (status) query.status = status;
        if (batchId) query.batchId = batchId;

        const supplyRequests = await SupplyRequest.find(query)
            .populate('warehouseId', 'warehouseName')
            .populate('handledBy', 'username')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: supplyRequests
        });
    } catch (error) {
        console.error('Get supply requests error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST: Bulk Create Supply Requests
// This fixes the issue of "one supply at a time"
router.post('/:id/supply-requests/bulk', checkSiteOwnership, async (req, res) => {
    try {
        const site = req.site;
        const user = req.user;

        if (user.role !== 'supervisor') {
            return res.status(403).json({ message: 'Only supervisors can request supplies' });
        }

        const { items, warehouseId } = req.body;
        // Expecting items to be an array: [{ itemName, quantity, unit }, ...]

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Please provide a list of items' });
        }

        if (!warehouseId) {
            return res.status(400).json({ message: 'Warehouse ID is required' });
        }

        const Warehouse = require('../models/Warehouse');
        const warehouse = await Warehouse.findById(warehouseId);
        if (!warehouse) {
            return res.status(404).json({ message: 'Warehouse not found' });
        }

        // Generate a unique Batch ID for this group of requests
        const batchId = new mongoose.Types.ObjectId().toString();
        const userDetails = await User.findById(user.id);
        const createdRequests = [];
        const errors = [];

        // Process each item in the list
        for (const item of items) {
            // Check availability in warehouse (Optional logic: You might want to allow request even if stock is low)
            const warehouseSupply = warehouse.supplies.find(
                s => s.itemName.toLowerCase() === item.itemName.toLowerCase()
            );

            // Create the request regardless of stock (Admin decides approval)
            // OR strictly check stock:
            /* if (!warehouseSupply || warehouseSupply.quantity < item.quantity) {
                errors.push(`Insufficient stock for ${item.itemName}`);
                continue; 
            }
            */

            const supplyRequest = new SupplyRequest({
                siteId: site._id,
                siteName: site.siteName,
                warehouseId: warehouseId,
                requestedBy: user.id,
                requestedByName: userDetails.username,
                itemName: item.itemName,
                requestedQuantity: item.quantity,
                unit: item.unit,
                batchId: batchId, // Links these items together
                status: 'pending'
            });

            await supplyRequest.save();
            createdRequests.push(supplyRequest);
        }

        // Log the bulk activity
        site.activityLogs.push({
            action: 'supply_requested',
            performedBy: user.id,
            performedByName: userDetails.username,
            performedByRole: user.role,
            timestamp: new Date(),
            details: {
                count: createdRequests.length,
                warehouseName: warehouse.warehouseName,
                batchId: batchId
            },
            description: `${userDetails.username} requested a list of ${createdRequests.length} supplies`
        });
        await site.save();

        res.status(201).json({
            success: true,
            message: `Successfully requested ${createdRequests.length} items`,
            data: createdRequests,
            batchId: batchId,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Bulk supply request error:', error);
        res.status(500).json({ message: error.message });
    }
});
// Add the Site model update to include adminId if it doesn't exist yet
// This will need to be run once as a migration

// Apply the checkSiteOwnership middleware to all routes
router.use('/:id*', checkSiteOwnership);
router.use('/:siteId*', checkSiteOwnership);

module.exports = router;
