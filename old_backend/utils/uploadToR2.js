const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/r2Config');

//upload to r2 function 
const uploadAttendanceToR2 = async (base64String, userId, role) => {
    try {
        // 1. clean the base64 string
       const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        // 2. organized folder structure : conerp/attendance/folder/id/timestamp.jpg
        const folder = role === 'supervisor' ? 'supervisors' : 'staff';
        const fileName = `attendance/${folder}/${userId}/${Date.now()}.jpg`;
        
        const params = {
            Bucket: process.env.BUCKET_NAME,
            Key: fileName,
            Body: buffer,
            ContentType: 'image/jpeg',
        };

        await s3Client.send(new PutObjectCommand(params));

        // 3. construst the url
        const publicUrl = process.env.PUBLIC_URL.replace(/\/$/,'');
        const bucketName = process.env.BUCKET_NAME;
        return `${publicUrl}/${bucketName}/${fileName}`;
    } catch (error) {
        console.error('R2 Upload Error:', error);
        throw new Error('Media upload to R2 failed');
    }
};

const uploadDispatchPhotoToR2 = async (base64String, orderId, index = 0) => {
    try {
        const base64Data = String(base64String || '').replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const fileName = `dispatch/orders/${orderId}/${Date.now()}_${index}.jpg`;

        const params = {
            Bucket: process.env.BUCKET_NAME,
            Key: fileName,
            Body: buffer,
            ContentType: 'image/jpeg',
        };

        await s3Client.send(new PutObjectCommand(params));

        const publicUrl = process.env.PUBLIC_URL.replace(/\/$/, '');
        const bucketName = process.env.BUCKET_NAME;
        return `${publicUrl}/${bucketName}/${fileName}`;
    } catch (error) {
        console.error('Dispatch Photo R2 Upload Error:', error);
        throw new Error('Dispatch photo upload to R2 failed');
    }
};

module.exports = { uploadAttendanceToR2, uploadDispatchPhotoToR2 };
