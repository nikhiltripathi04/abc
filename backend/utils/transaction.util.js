const mongoose = require('mongoose');
const logger = require('./logger');

class TransactionHelper {
  static async execute(operations) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await operations(session);
      await session.commitTransaction();
      logger.info('Transaction committed successfully');
      return result;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Transaction aborted', { error: error.message });
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

module.exports = TransactionHelper;
