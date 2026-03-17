const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const sendPushNotification = require('../utils/sendPushNotification');
const User = require('../models/User');

console.log("✅ Pending checkout cron initialized");

const TEST_MODE = false;

const PROD_WINDOWS = [
  { label: '10pm', hour: 22, minute: 0, field: 'reminder10pmSent' },
  { label: '1145pm', hour: 23, minute: 45, field: 'reminder1145pmSent' }
];

const TEST_WINDOWS = [
  { label: '10pm', hour: 15, minute: 14, field: 'reminder10pmSent' },
  { label: '1145pm', hour: 15, minute: 17, field: 'reminder1145pmSent' }
];

const WINDOWS = TEST_MODE ? TEST_WINDOWS : PROD_WINDOWS;

// Runs every minute
cron.schedule(
  '* * * * *',
  async () => {
    try {
      // console.log("🕐 CRON heartbeat");

      // Convert to IST (important for Render / UTC servers)
      const now = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
      );

      const hours = now.getHours();
      const minutes = now.getMinutes();

      // console.log(`⏱ IST time: ${hours}:${minutes}`);

      const activeWindow = WINDOWS.find(
        w => w.hour === hours && w.minute === minutes
      );

      if (!activeWindow) return;

      console.log(`⏰ Running ${activeWindow.label} reminder scan`);

      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const checkIns = await Attendance.find({
        type: 'login',
        timestamp: { $gte: startOfDay, $lte: endOfDay },
        [activeWindow.field]: { $ne: true }
      }).select('staffId').lean();

      if (!checkIns.length) return;

      const staffIds = checkIns.map(c => c.staffId);

      const checkOuts = await Attendance.find({
        staffId: { $in: staffIds },
        type: 'logout',
        timestamp: { $gte: startOfDay }
      }).select('staffId').lean();

      const checkedOutSet = new Set(checkOuts.map(c => String(c.staffId)));

      const users = await User.find({ _id: { $in: staffIds } })
        .select('expoPushToken username fullName firstName lastName')
        .lean();

      const userMap = new Map(users.map(u => [String(u._id), u]));

      const bulkUpdates = [];

      for (const checkIn of checkIns) {
        if (checkedOutSet.has(String(checkIn.staffId))) continue;

        const user = userMap.get(String(checkIn.staffId));
        if (!user?.expoPushToken) continue;

        await sendPushNotification(
          user.expoPushToken,
          'Pending Checkout ⏳',
          'You forgot to checkout today. Please do it now.',
          { type: 'PENDING_CHECKOUT', window: activeWindow.label }
        );

        bulkUpdates.push({
          updateOne: {
            filter: { staffId: checkIn.staffId, type: 'login' },
            update: { $set: { [activeWindow.field]: true } }
          }
        });

        const name =
          user.fullName ||
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.username;

        console.log(`🔔 Reminder sent to ${name}`);
      }

      if (bulkUpdates.length) {
        await Attendance.bulkWrite(bulkUpdates);
      }

      console.log(`✅ ${bulkUpdates.length} reminders processed`);
    } catch (err) {
      console.error('❌ Pending checkout cron error:', err);
    }
  },
  { timezone: 'Asia/Kolkata' }
);
