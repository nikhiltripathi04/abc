class ApiResponse {
  static success(data, message = 'Success', statusCode = 200) {
    return {
      success: true,
      statusCode,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  static error(message, code = 'INTERNAL_ERROR', statusCode = 500, details = null) {
    return {
      success: false,
      statusCode,
      code,
      message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
    };
  }

  static validationError(fields) {
    return {
      success: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fields,
      timestamp: new Date().toISOString(),
    };
  }

  static notFound(resource = 'Resource') {
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: `${resource} not found`,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = ApiResponse;