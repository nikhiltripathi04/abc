const Notification = require('../../models/Notification');
const eventBus = require('../../core/eventBus');

exports.sendTestNotification = async (req, res) => {
  try {
    const { message } = req.body;

    eventBus.emit('TEST_NOTIFICATION', {
      companyId: req.user.companyId,
      requestedBy: req.user._id,
      message: message || "This is a test notification."
    });

    res.json({
      success: true,
      message: 'Test notification event emitted. Check logs and dashboard.'
    });
  } catch (err) {
    console.error('Send test notification error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.listNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Notification.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments({ userId: req.user._id })
    ]);

    res.json({
      success: true,
      data: items,
      pagination: { page, limit, total }
    });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.markRead = async (req, res) => {
  try {
    const { notificationId, all } = req.body;

    if (all) {
      await Notification.updateMany(
        { userId: req.user._id, readAt: { $exists: false } },
        { $set: { readAt: new Date() } }
      );
      return res.json({ success: true, message: 'All notifications marked as read' });
    }

    if (!notificationId) {
      return res.status(400).json({ success: false, message: 'notificationId is required' });
    }

    const updated = await Notification.findOneAndUpdate(
      { _id: notificationId, userId: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
