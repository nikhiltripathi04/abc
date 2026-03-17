const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const sendEmail = require('../utils/email');
const ActivityLogger = require('../utils/activityLogger');
const { auth } = require('../middleware/auth');

const splitFullName = (fullName = '') => {
  const normalized = String(fullName).trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: 'Admin', lastName: 'User', fullName: '' };
  }

  const [firstName, ...rest] = normalized.split(' ');
  const lastName = rest.join(' ') || 'User';
  return { firstName, lastName, fullName: normalized };
};


// ✅ GET CURRENT USER (used for real-time refresh)
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('assignedSites'); // VERY IMPORTANT

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });

  } catch (err) {
    console.error('GET /auth/me error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
});



// ✅ LOGIN Route
// LOGIN Route - with warehouse support
router.post('/login', async (req, res) => {
  try {
    const { username, password, expectedRole } = req.body;

    // Include population for assignedSites and warehouseId
    const user = await User.findOne({ username })
      .populate('assignedSites', 'siteName location')
      .populate('warehouseId', 'warehouseName location');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // New: If expectedRole is provided, restrict more roles!
    if (expectedRole && user.role !== expectedRole) {
      return res.status(401).json({
        success: false,
        message: `No ${expectedRole} account found with this username`
      });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // Access Token (SHORT)
    const accessToken = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }// ⬅️ short lived
    );

    // Refresh Token (LONG)
    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '60d' }// ⬅️ long lived
    );


    // Include warehouseId/manager info on login when requested
    let extraData = {};
    if (user.role === 'warehouse_manager') {
      extraData.warehouseId = user.warehouseId; // Legacy field
      extraData.assignedWarehouses = user.assignedWarehouses || [];
    }
    if (user.role === 'supervisor') {
      extraData.assignedSites = user.assignedSites;
    }

    // Populate company info
    if (user.companyId) {
      const company = await mongoose.model('Company').findById(user.companyId);
      if (company) {
        extraData.companyId = company._id;
        extraData.companyName = company.name;
      }
    }

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        ...extraData
      }
    });


  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, message: 'An error occurred during login', error: error.message });
  }
});
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh token missing' });
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const newAccessToken = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ accessToken: newAccessToken });

  } catch (error) {
    res.status(401).json({ code: 'REFRESH_TOKEN_EXPIRED' });
  }
});


// ✅ CREATE SUPERVISOR Route (Admin only)
router.post('/create-supervisor', async (req, res) => {
  try {
    const { username, password, adminId, fullName } = req.body;

    if (!username || !password || !adminId) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and adminId are required'
      });
    }

    // Verify admin
    const admin = await User.findOne({ _id: adminId, role: 'admin' });
    if (!admin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only admins can create supervisors'
      });
    }

    // Check if username exists
    const existingUser = await User.findOne({ username: username.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    const supervisor = new User({
      username: username.toLowerCase().trim(),
      password,
      role: 'supervisor',
      fullName: fullName || '',
      createdBy: adminId,
      companyId: admin.companyId, // Link to company
      assignedSites: [] // Initially empty
    });

    await supervisor.save();

    // Log activity
    try {
      await ActivityLogger.logActivity(
        supervisor._id,
        'supervisor_created',
        admin,
        {
          supervisorUsername: supervisor.username,
          createdBy: adminId
        },
        `Supervisor "${supervisor.username}" created by admin`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log supervisor creation:', logErr);
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('supervisors:updated', { action: 'create', supervisorId: supervisor._id });
    }

    res.status(201).json({
      success: true,
      message: 'Supervisor account created successfully',
      data: {
        id: supervisor._id,
        username: supervisor.username,
        role: supervisor.role
      }
    });

  } catch (error) {
    console.error('Create supervisor error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating supervisor',
      error: error.message
    });
  }
});

// ✅ GET All Supervisors (Admin only)
router.get('/supervisors', async (req, res) => {
  try {
    const { adminId } = req.query;

    if (!adminId) {
      return res.status(400).json({ success: false, message: 'Admin ID is required' });
    }

    const admin = await User.findById(adminId);
    let query = { role: 'supervisor', createdBy: adminId };

    if (admin && admin.companyId) {
      query = { role: 'supervisor', companyId: admin.companyId };
    }

    const supervisors = await User.find(query)
      .select('username _id assignedSites')
      .populate('assignedSites', 'siteName');

    res.json({
      success: true,
      count: supervisors.length,
      data: supervisors
    });
  } catch (error) {
    console.error('Error fetching supervisors:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch supervisors' });
  }
});

// ✅ GET SUPERVISOR DETAILS Route
router.get('/supervisors/:id', auth, async (req, res) => {
  try {
    const supervisorId = req.params.id;
    const supervisor = await User.findById(supervisorId)
      .populate('assignedSites', 'siteName location')
      .populate('companyId', 'name');

    if (!supervisor || supervisor.role !== 'supervisor') {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    res.json({
      success: true,
      data: supervisor
    });
  } catch (err) {
    console.error('GET /auth/supervisors/:id error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supervisor details'
    });
  }
});

// ✅ CREATE WAREHOUSE MANAGER Route (Admin only)
router.post('/create-warehouse-manager', async (req, res) => {
  try {
    const { username, password, adminId, fullName } = req.body;

    if (!username || !password || !adminId) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and adminId are required'
      });
    }

    // Verify admin
    const admin = await User.findOne({ _id: adminId, role: { $in: ['admin', 'company_owner'] } });
    if (!admin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only admins can create warehouse managers'
      });
    }

    // Check if username exists
    const existingUser = await User.findOne({ username: username.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    const warehouseManager = new User({
      username: username.toLowerCase().trim(),
      password,
      role: 'warehouse_manager',
      fullName: fullName || '',
      createdBy: adminId,
      companyId: admin.companyId, // Link to company
      assignedWarehouses: [] // Initially empty
    });

    await warehouseManager.save();

    // Log activity
    try {
      await ActivityLogger.logActivity(
        warehouseManager._id,
        'warehouse_manager_created',
        admin,
        {
          managerUsername: warehouseManager.username,
          createdBy: adminId
        },
        `Warehouse manager "${warehouseManager.username}" created by admin`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log warehouse manager creation:', logErr);
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('warehouse-managers:updated', { action: 'create', managerId: warehouseManager._id });
    }

    res.status(201).json({
      success: true,
      message: 'Warehouse manager account created successfully',
      data: {
        id: warehouseManager._id,
        username: warehouseManager.username,
        role: warehouseManager.role
      }
    });

  } catch (error) {
    console.error('Create warehouse manager error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating warehouse manager',
      error: error.message
    });
  }
});

// ✅ GET All Warehouse Managers (Admin only)
router.get('/warehouse-managers', async (req, res) => {
  try {
    const { adminId } = req.query;

    if (!adminId) {
      return res.status(400).json({ success: false, message: 'Admin ID is required' });
    }

    const admin = await User.findById(adminId);
    let query = { role: 'warehouse_manager', createdBy: adminId };

    if (admin && admin.companyId) {
      query = { role: 'warehouse_manager', companyId: admin.companyId };
    }

    const managers = await User.find(query)
      .select('username _id assignedWarehouses fullName')
      .populate('assignedWarehouses', 'warehouseName');

    res.json({
      success: true,
      count: managers.length,
      data: managers
    });
  } catch (error) {
    console.error('Error fetching warehouse managers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch warehouse managers' });
  }
});

// ✅ DELETE Warehouse Manager (Admin only)
router.delete('/warehouse-managers/:managerId', async (req, res) => {
  try {
    const { adminId } = req.query;
    const { managerId } = req.params;

    if (!adminId) {
      return res.status(400).json({ success: false, message: 'Admin ID is required' });
    }

    const admin = await User.findOne({ _id: adminId, role: { $in: ['admin', 'company_owner'] } });
    if (!admin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only admins can delete warehouse managers'
      });
    }

    // Find the manager
    const manager = await User.findOne({ _id: managerId, role: 'warehouse_manager' });
    if (!manager) {
      return res.status(404).json({ success: false, message: 'Warehouse manager not found' });
    }

    // Check if manager belongs to the same company
    if (admin.companyId && manager.companyId && 
        admin.companyId.toString() !== manager.companyId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete manager from another company' 
      });
    }

    // Remove manager from all warehouses
    const Warehouse = require('../models/Warehouse');
    await Warehouse.updateMany(
      { managers: managerId },
      { $pull: { managers: managerId } }
    );

    // Delete the manager
    await User.deleteOne({ _id: managerId });

    // Log activity
    try {
      await ActivityLogger.logActivity(
        managerId,
        'warehouse_manager_deleted',
        admin,
        {
          managerId,
          managerUsername: manager.username
        },
        `Warehouse manager "${manager.username}" deleted by admin`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log warehouse manager deletion:', logErr);
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('warehouse-managers:updated', { action: 'delete', managerId });
    }

    res.json({
      success: true,
      message: 'Warehouse manager deleted successfully'
    });

  } catch (error) {
    console.error('Delete warehouse manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete warehouse manager',
      error: error.message
    });
  }
});

// ✅ GET All Admins (Admin only - to view colleagues)
router.get('/admins', async (req, res) => {
  try {
    const { adminId } = req.query;

    if (!adminId) {
      return res.status(400).json({ success: false, message: 'Admin ID is required' });
    }

    const requestor = await User.findById(adminId);
    if (!requestor || requestor.role !== 'admin') {
       return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    let query = { role: 'admin' };
    if (requestor.companyId) {
      query.companyId = requestor.companyId;
    }

    const admins = await User.find(query)
      .select('username _id firstName lastName fullName role')
      .sort({ firstName: 1 });

    res.json({
      success: true,
      count: admins.length,
      data: admins
    });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admins' });
  }
});

// ✅ REGISTER Admin
router.post('/register', async (req, res) => {
  console.log('📝 Register request received:', req.body);
  try {
    const { username, password, email, phoneNumber, firmName } = req.body;

    if (!username || !password || !email || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, password, email, and phone number'
      });
    }

    // Manually check if username or email already exists
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      console.log('❌ Username already exists:', username);
      return res.status(400).json({
        success: false,
        message: 'Username already exists',
        errorType: 'USERNAME_EXISTS'
      });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      console.log('❌ Email already exists:', email);
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
        errorType: 'EMAIL_EXISTS'
      });
    }

    const user = new User({
      username,
      password, // Will be hashed via pre-save hook
      email,
      phoneNumber,
      firmName: firmName || '',
      role: 'admin'
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Registration error:', error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred during registration'
    });
  }
});

// ✅ VERIFY Admin Identity
router.post('/verify-identity', async (req, res) => {
  try {
    const { username, email, phoneNumber } = req.body;

    if (!username || !email || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and phone number are required'
      });
    }

    const admin = await User.findOne({ username, role: 'admin' });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'No matching admin account found. Please check your information.'
      });
    }

    if (admin.email !== email || admin.phoneNumber !== phoneNumber) {
      return res.status(401).json({
        success: false,
        message: 'Email or phone number does not match our records'
      });
    }

    res.json({
      success: true,
      message: 'Identity verified successfully'
    });

  } catch (error) {
    console.error('Verify identity error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during identity verification'
    });
  }
});

// ✅ RESET Admin Password
router.post('/reset-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Username and new password are required'
      });
    }

    const admin = await User.findOne({ username, role: 'admin' });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin account not found'
      });
    }

    admin.password = newPassword; // Will be hashed in pre-save
    await admin.save();

    // Log activity
    try {
      // We might not have the "performer" ID easily available if this is an unauthenticated reset (which it seems to be based on the payload not having user ID). 
      // BUT, looking at the code, it takes "username". 
      // If this is an admin resetting THEIR OWN password via some forgotten password flow, we can use their ID.
      await ActivityLogger.logActivity(
        admin._id,
        'password_reset',
        admin, // Pass the admin user object directly
        { username },
        `Password reset for admin "${username}"`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log admin password reset:', logErr);
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during password reset'
    });
  }
});

// ✅ DELETE Supervisor (Admin only)
router.delete('/supervisors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId } = req.query;

    if (!adminId) {
      return res.status(400).json({ success: false, message: 'Admin ID is required' });
    }

    const admin = await User.findOne({ _id: adminId, role: 'admin' });
    if (!admin) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const supervisor = await User.findOne({ _id: id, role: 'supervisor' });
    if (!supervisor) {
      return res.status(404).json({ success: false, message: 'Supervisor not found' });
    }

    const isCreator = supervisor.createdBy?.toString() === adminId;
    const isSameCompany =
      admin.companyId &&
      supervisor.companyId &&
      admin.companyId.toString() === supervisor.companyId.toString();

    if (!isCreator && !isSameCompany) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You can only delete supervisors from your company'
      });
    }

    // 🔥 CAPTURE BEFORE DELETE
    const companyId = supervisor.companyId;
    const supervisorUsername = supervisor.username;

    await User.findByIdAndDelete(id);

    // ✅ LOG WITH ADMIN + COMPANY
    await ActivityLogger.logActivity(
      id,
      'SUPERVISOR_DELETED',
      admin, // ✅ FIX
      {
        supervisorUsername,
        supervisorId: id,
        companyId // ✅ FIX
      },
      `Supervisor "${supervisorUsername}" deleted by ${admin.username}`,
      'User'
    );

    res.json({ success: true, message: 'Supervisor deleted successfully' });

    const io = req.app.get('io');
    if (io) {
      io.emit('supervisors:updated', { action: 'delete', supervisorId: id });
    }

  } catch (error) {
    console.error('Error deleting supervisor:', error);
    res.status(500).json({ success: false, message: 'Failed to delete supervisor' });
  }
});

// ✅ RESET Supervisor Password (Admin only)
router.put('/supervisors/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId, newPassword } = req.body;

    if (!adminId || !newPassword) {
      return res.status(400).json({ success: false, message: 'Admin ID and new password are required' });
    }

    // Verify admin
    const admin = await User.findOne({ _id: adminId, role: 'admin' });
    if (!admin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Only admins can reset passwords' });
    }

    const supervisor = await User.findOne({ _id: id, role: 'supervisor' });

    // Check if supervisor exists and belongs to this admin's company (extra security)
    if (!supervisor || (admin.companyId && supervisor.companyId.toString() !== admin.companyId.toString())) {
      return res.status(404).json({ success: false, message: 'Supervisor not found or unauthorized' });
    }

    supervisor.password = newPassword; // Will be hashed via pre-save hook
    await supervisor.save();

    // Log activity
    try {
      await ActivityLogger.logActivity(
        supervisor._id,
        'supervisor_password_reset',
        req.user,
        {
          supervisorUsername: supervisor.username,
          adminId: adminId
        },
        `Supervisor "${supervisor.username}" password reset by admin`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log supervisor password reset:', logErr);
    }

    res.json({ success: true, message: 'Password updated successfully' });

  } catch (error) {
    console.error('Error resetting supervisor password:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// ✅ CREATE ADMIN (Company Owner only)
router.post('/create-admin', async (req, res) => {
  try {
    const { username, password, email, fullName, firstName, lastName, phoneNumber, authAdminId } = req.body; // authAdminId from frontend sending user.id

    if (!username || !password || !email || !authAdminId) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, email, and creator ID are required'
      });
    }

    // Verify company owner
    const owner = await User.findOne({ _id: authAdminId, role: 'company_owner' });
    if (!owner) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only company owners can create admins'
      });
    }

    // Check if username/email exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists'
      });
    }

    const incomingFullName = String(fullName || '').trim() || [firstName, lastName].filter(Boolean).join(' ').trim();
    const normalizedName = splitFullName(incomingFullName);

    const newAdmin = new User({
      username,
      password,
      email,
      firstName: normalizedName.firstName,
      lastName: normalizedName.lastName,
      fullName: normalizedName.fullName,
      phoneNumber: phoneNumber || '0000000000',
      role: 'admin',
      companyId: owner.companyId,
      createdBy: owner._id
    });

    await newAdmin.save();

    // Log activity
    try {
      await ActivityLogger.logActivity(
        newAdmin._id,
        'admin_created',
        req.user,
        {
          newAdminUsername: newAdmin.username,
          role: 'admin'
        },
        `New admin "${newAdmin.username}" created by company owner`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log admin creation:', logErr);
    }

    // Send welcome email
    const emailSubject = 'Welcome to ConERP - Admin Account Created';
    const emailHtml = `
      <h1>Welcome to ConERP, ${normalizedName.fullName || normalizedName.firstName}!</h1>
      <p>Your admin account has been successfully created.</p>
      <p><strong>Username:</strong> ${username}</p>
      <p><strong>Password:</strong> ${password}</p>
      <p>Please login and change your password immediately.</p>
      <br>
      <p>Best regards,<br>ConERP Team</p>
    `;

    // Don't await email to prevent blocking response, but log error if fails
    sendEmail(email, emailSubject, emailHtml).catch(err => console.error('Failed to send admin welcome email:', err));

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      data: {
        id: newAdmin._id,
        username: newAdmin.username,
        role: newAdmin.role
      }
    });

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating admin',
      error: error.message
    });
  }
});

// ✅ GET Company Admins (Company Owner only)
router.get('/company-admins', async (req, res) => {
  try {
    const { ownerId } = req.query;

    if (!ownerId) {
      return res.status(400).json({ success: false, message: 'Owner ID is required' });
    }

    // Verify owner
    const owner = await User.findById(ownerId);
    if (!owner || owner.role !== 'company_owner') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const admins = await User.find({ role: 'admin', companyId: owner.companyId })
      .select('username email fullName firstName lastName phoneNumber _id createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: admins
    });
  } catch (error) {
    console.error('Error fetching company admins:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admins' });
  }
});

// ✅ DELETE Company Admin (Company Owner only)
router.delete('/company-admins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerId } = req.query;

    if (!ownerId) {
      return res.status(400).json({ success: false, message: 'Owner ID is required' });
    }

    // Verify owner
    const owner = await User.findById(ownerId);
    if (!owner || owner.role !== 'company_owner') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Find admin to delete
    const adminToDelete = await User.findOne({ _id: id, role: 'admin' });
    if (!adminToDelete) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    // Verify admin belongs to same company
    if (adminToDelete.companyId.toString() !== owner.companyId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Cannot delete admin from another company' });
    }

    await User.findByIdAndDelete(id);

    // Log activity
    try {
      await ActivityLogger.logActivity(
        id,
        'admin_deleted',
        req.user,
        {
          deletedAdminUsername: adminToDelete.username,
          deletedBy: ownerId
        },
        `Admin "${adminToDelete.username}" deleted by company owner`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log admin deletion:', logErr);
    }

    res.json({ success: true, message: 'Admin deleted successfully' });

  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ success: false, message: 'Failed to delete admin' });
  }
});

// ✅ CHANGE Password (Authenticated User)
router.post('/change-password', async (req, res) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;

    if (!userId || !oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'User ID, old password, and new password are required'
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify old password
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect current password'
      });
    }

    // Update password
    user.password = newPassword; // Will be hashed by pre-save hook
    await user.save();

    // Log activity
    try {
      await ActivityLogger.logActivity(
        user._id,
        'password_changed',
        req.user,
        {},
        `Password changed for user "${user.username}"`,
        'User'
      );
    } catch (logErr) {
      console.error('Failed to log password change:', logErr);
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while changing password'
    });
  }
});

module.exports = router;
