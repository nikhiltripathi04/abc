const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config();

const accountId = process.env.ACCOUNT_ID;
const accessKeyId = process.env.ACCESS_KEY_ID;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;

const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.S3_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
    },
});

module.exports = { s3Client };
