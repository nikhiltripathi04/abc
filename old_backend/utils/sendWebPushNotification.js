const { getMessaging } = require('./firebaseAdmin');

async function sendWebPushNotification(tokens, title, body, data = {}) {
  const tokenList = Array.isArray(tokens) ? tokens.filter(Boolean) : [tokens].filter(Boolean);
  if (!tokenList.length) {
    console.log('❌ No web push tokens provided');
    return { successCount: 0, failureCount: 0 };
  }

  try {
    const message = {
      tokens: tokenList,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [String(k), v == null ? '' : String(v)])
      )
    };

    const response = await getMessaging().sendEachForMulticast(message);
    console.log('✅ Web push sent:', response.successCount, 'success');
    return response;
  } catch (error) {
    console.error('❌ Web push error:', error.message);
    throw error;
  }
}

module.exports = sendWebPushNotification;
