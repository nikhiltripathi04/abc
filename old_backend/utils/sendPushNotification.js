const axios = require('axios');

async function sendPushNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) {
    console.log('❌ No Expo push token provided');
    return { success: false };
  }

  try {
    const payload = {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data
    };

    const response = await axios.post(
      'https://exp.host/--/api/v2/push/send',
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Push sent:', response.data);
    return { success: true, response: response.data };
  } catch (error) {
    console.error(
      '❌ Push notification error:',
      error.response?.data || error.message
    );
    return { success: false, error };
  }
}

module.exports = sendPushNotification;
