const Notification = require('../../models/Notification');
const User = require('../../models/User');
const { Order } = require('../../models/Order');
const templates = require('./notification.templates');
const { CHANNELS } = require('./notification.constants');
const sendPushNotification = require('../../utils/sendPushNotification');
const sendWebPushNotification = require('../../utils/sendWebPushNotification');
const { getIO } = require('../../core/socket');

const COMPANY_ADMIN_ROLES = ['admin', 'company_owner'];
const WAREHOUSE_ROLES = ['warehouse_manager'];

const uniqueIds = (ids) => Array.from(new Set(ids.map(String))).map((id) => String(id));

const fetchUsersByCompanyAndRoles = async (companyId, roles) => {
  if (!companyId) return [];
  return User.find({ companyId, role: { $in: roles } }).select('_id expoPushToken fcmWebTokens notificationPreferences');
};

const resolveRecipients = async (type, payload) => {
  const recipients = [];

  const companyId = payload.companyId;

  switch (type) {
    case 'ORDER_CREATED':
    case 'ORDER_SUBMITTED':
      recipients.push(...(await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES)));
      break;
    case 'ORDER_APPROVED':
    case 'ORDER_PARTIALLY_APPROVED':
    case 'ORDER_REJECTED':
    case 'ORDER_DISPATCHED':
    case 'ORDER_RECEIVED':
    case 'ORDER_RECEIVING_REMINDER':
    case 'ORDER_CANCELLED': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.requestedBy) {
        const requester = await User.findById(payload.requestedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (requester) recipients.push(requester);
      }
      // Notify the dispatcher when an order is received
      if (type === 'ORDER_RECEIVED' && payload.dispatchedBy) {
        const dispatcher = await User.findById(payload.dispatchedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (dispatcher) recipients.push(dispatcher);
      }
      break;
    }
    case 'ORDER_ALLOTTED_FOR_DISPATCH': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      // Notify warehouse managers of the specific warehouse
      if (payload.warehouseId) {
        const wm = await User.find({
          companyId,
          role: 'warehouse_manager',
          $or: [
            { warehouseId: payload.warehouseId },
            { assignedWarehouses: payload.warehouseId }
          ]
        }).select('_id expoPushToken fcmWebTokens notificationPreferences');
        recipients.push(...wm);
      }
      break;
    }
    case 'PRICING_CONFIRMED': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.addedBy) {
        const user = await User.findById(payload.addedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (user) recipients.push(user);
      }
      break;
    }
    case 'DISCREPANCY_DETECTED': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.dispatchedBy) {
        const dispatcher = await User.findById(payload.dispatchedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (dispatcher) recipients.push(dispatcher);
      }
      break;
    }
    case 'STOCK_LOW': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      const wh = await fetchUsersByCompanyAndRoles(companyId, WAREHOUSE_ROLES);
      recipients.push(...admins, ...wh);
      break;
    }
    case 'INVENTORY_UPDATED': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      break;
    }
    case 'GRN_CREATED':
    case 'GRN_AUTHENTICATED':
    case 'GRN_REJECTED':
    case 'GRN_FLAGGED': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.requestedBy) {
        const requester = await User.findById(payload.requestedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (requester) recipients.push(requester);
      }
      break;
    }
    case 'QUANTITY_CHANGE_REQUESTED':
    case 'INVENTORY_ITEM_CREATED': {
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      break;
    }
    case 'QUANTITY_CHANGE_APPROVED':
    case 'QUANTITY_CHANGE_REJECTED':
    case 'ITEM_DETAIL_CHANGE_REJECTED': {
      if (payload.requestedBy) {
        const requester = await User.findById(payload.requestedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (requester) recipients.push(requester);
      }
      if (payload.warehouseId) {
        const wm = await User.find({
          companyId,
          role: 'warehouse_manager',
          $or: [
            { warehouseId: payload.warehouseId },
            { assignedWarehouses: payload.warehouseId }
          ]
        }).select('_id expoPushToken fcmWebTokens notificationPreferences');
        recipients.push(...wm);
      }
      break;
    }
    case 'TEST_NOTIFICATION': {
      if (payload.requestedBy) {
        const requester = await User.findById(payload.requestedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (requester) recipients.push(requester);
      }
      break;
    }
    case 'SITE_RETURN_CREATED': {
      // Notify admins and warehouse managers of the target warehouse
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.warehouseId) {
        const wm = await User.find({
          companyId,
          role: 'warehouse_manager',
          $or: [
            { warehouseId: payload.warehouseId },
            { assignedWarehouses: payload.warehouseId }
          ]
        }).select('_id expoPushToken fcmWebTokens notificationPreferences');
        recipients.push(...wm);
      }
      break;
    }
    case 'SITE_RETURN_APPROVED':
    case 'SITE_RETURN_REJECTED': {
      // Notify the supervisor who requested the return
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.requestedBy) {
        const requester = await User.findById(payload.requestedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (requester) recipients.push(requester);
      }
      break;
    }
    case 'SITE_RETURN_RECEIVING_LOGGED': {
      // Notify supervisor, admins, and warehouse manager who logged the receiving
      const admins = await fetchUsersByCompanyAndRoles(companyId, COMPANY_ADMIN_ROLES);
      recipients.push(...admins);
      if (payload.requestedBy) {
        const requester = await User.findById(payload.requestedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (requester) recipients.push(requester);
      }
      if (payload.receivedBy) {
        const receiver = await User.findById(payload.receivedBy).select('_id expoPushToken fcmWebTokens notificationPreferences');
        if (receiver) recipients.push(receiver);
      }
      break;
    }
    default:
      break;
  }

  const uniqueRecipientIds = uniqueIds(recipients.map((u) => u._id));
  if (!uniqueRecipientIds.length) return [];

  return User.find({ _id: { $in: uniqueRecipientIds } }).select('_id expoPushToken fcmWebTokens notificationPreferences');
};

const handle = async (type, payload) => {
  const template = templates[type];
  if (!template) {
    console.warn('⚠️ No notification template for type:', type);
    return;
  }

  const { title, message } = template(payload);

  if (type === 'ORDER_RECEIVING_REMINDER' && payload.referenceId) {
    const order = await Order.findById(payload.referenceId);
    if (!order || order.status !== 'awaiting_receipt') {
      console.log(`ℹ️ Skipping receiving reminder for order ${payload.orderId || payload.referenceId} as status is ${order?.status}`);
      return;
    }
  }

  const recipients = await resolveRecipients(type, payload);

  if (!recipients.length) return;

  const io = getIO();

  for (const user of recipients) {
    const prefs = user.notificationPreferences || {};
    const channels = [CHANNELS.IN_APP];

    const notification = new Notification({
      userId: user._id,
      title,
      message,
      type,
      referenceId: payload.referenceId,
      channel: channels,
      metadata: payload
    });

    let pushStatus = 'SENT';
    let webPushStatus = 'SENT';

    if (prefs.push !== false && user.expoPushToken) {
      channels.push(CHANNELS.PUSH);
      try {
        const result = await sendPushNotification(user.expoPushToken, title, message, payload);
        if (!result?.success) {
          pushStatus = 'FAILED';
        }
      } catch (err) {
        pushStatus = 'FAILED';
      }
    }

    if (prefs.webPush !== false && user.fcmWebTokens && user.fcmWebTokens.length) {
      channels.push(CHANNELS.WEB_PUSH);
      try {
        await sendWebPushNotification(user.fcmWebTokens, title, message, payload);
      } catch (err) {
        webPushStatus = 'FAILED';
      }
    }

    notification.channel = channels;
    notification.status.push = pushStatus;
    notification.status.webPush = webPushStatus;

    await notification.save();

    if (io) {
      io.to(`user:${user._id}`).emit('NEW_NOTIFICATION', notification);
    }
  }
};

module.exports = {
  handle
};
