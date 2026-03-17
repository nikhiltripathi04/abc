const express = require('express'); // Trigger restart
const router = express.Router();
const Message = require('../models/Message');
const Site = require('../models/Site');
const User = require('../models/User'); // Admin
const { auth } = require('../middleware/auth');
// Cloudflare R2 Logic
const { s3Client } = require('../config/r2Config');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Helper to upload buffer to R2
const uploadToR2 = async (file, folder) => {
    const fileName = `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        // ACL: 'public-read' // R2 buckets are usually private by default unless configured otherwise, or use Public URL
    }));

    // Construct Public URL
    const publicUrl = process.env.PUBLIC_URL.replace(/\/$/, ''); // Remove trailing slash if present
    // User specific: The accessible URL structure requires the bucket name in the path
    return `${publicUrl}/${process.env.BUCKET_NAME}/${fileName}`;
};

// Get Pre-signed URL for direct upload (Supervisor -> R2)
router.get('/upload-url', auth, async (req, res) => {
    try {
        const { filename, contentType } = req.query;
        if (!filename || !contentType) {
            return res.status(400).json({ message: 'Filename and content type are required' });
        }

        const folder = contentType.startsWith('image/') ? 'crims_images' : 'crims_videos';
        // Clean filename similar to uploadToR2
        const uniqueFilename = `${Date.now()}-${filename.replace(/\s+/g, '_')}`;
        const key = `${folder}/${uniqueFilename}`;

        const command = new PutObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: key,
            ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // Construct Public URL
        const publicUrl = process.env.PUBLIC_URL.replace(/\/$/, '');
        const finalUrl = `${publicUrl}/${process.env.BUCKET_NAME}/${key}`;

        res.json({
            success: true,
            uploadUrl,
            publicUrl: finalUrl
        });

    } catch (error) {
        console.error('Presigned URL error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Send a message (Supervisor -> Admin)
router.post('/send', auth, async (req, res) => {
    try {
        // if (req.user.role !== 'supervisor') {
        //     return res.status(403).json({ message: 'Only supervisors can send messages' });
        // }
        // ALLOW Admin to send too
        
        const { siteId, content, replyTo } = req.body;
        let videoUrl = req.body.videoUrl;

        // Manual upload if file is present
        if (req.file) {
            console.log('File detected. Starting manual upload to R2...');
            try {
                // Determine folder based on mime type
                const folder = req.file.mimetype.startsWith('image/') ? 'crims_images' : 'crims_videos';
                const url = await uploadToR2(req.file, folder);
                console.log('Upload successful:', url);
                videoUrl = url;
            } catch (uploadError) {
                console.error('R2 upload error details:', uploadError);
                return res.status(500).json({ message: 'Media upload failed', error: uploadError.message });
            }
        } else {
            console.log('No file received in request.');
        }

        if (!siteId) {
            return res.status(400).json({ message: 'Site ID is required' });
        }

        if (!content && !videoUrl) {
            return res.status(400).json({ message: 'Message must contain text or video' });
        }

        // Check Site
        const site = await Site.findById(siteId);
        if (!site) {
            return res.status(404).json({ message: 'Site not found' });
        }

        let recipientId;
        let senderRole = req.user.role;

        if (senderRole === 'supervisor') {
            recipientId = site.adminId;
        } else {
            // If Admin is sending
            senderRole = 'admin';
            // If replying, we can get recipient from the original message (sender)
            // But for now, we assume 1 site = 1 supervisor for chat simplicity in this context
            // Or we need a supervisorId passed in. 
            // In AdminMessagesScreen, we are "in a conversation" with a specific supervisor (selectedSupervisorId).
            // So the frontend should pass the recipient or we infer it.
            // CAUTION: The current frontend 'send' logic only passes siteId. 
            // We need to know WHICH supervisor this is for if multiple supervisors on one site? 
            // Assume 1-1 mapping for site-supervisor or use the `site.supervisorId` if it existed.
            // Better: Frontend passes `recipientId` if Admin. 
            // FALLBACK: If we are replying to a message, use that message's sender.
            
            if (replyTo) {
                 const originalMsg = await Message.findById(replyTo);
                 if (originalMsg) {
                     recipientId = originalMsg.sender; 
                 }
            }
            
            // If still no recipient (new message from admin?), we need a param. 
            // For this specific 'reply' task, `replyTo` handles it.
            // If sending fresh, we might fail unless we update frontend to send recipient.
            if (!recipientId) {
                // Try from request body if added later, or fail for now if strictly reply
                 if (req.body.recipientId) recipientId = req.body.recipientId;
            }
        }

        if (!recipientId && senderRole === 'admin') {
             // Try to find a supervisor for this site?
             // Skipping for now, assuming replyTo is primary use case here.
             return res.status(400).json({ message: 'Recipient (Supervisor) could not be determined.' });
        }

        const message = new Message({
            sender: req.user._id,
            senderName: req.user.username,
            senderRole: senderRole,
            recipient: recipientId,
            siteId: site._id,
            siteName: site.siteName,
            content: content || '',
            videoUrl: videoUrl || null,
            replyTo: replyTo || null
        });

        await message.save();

        // Emit real-time event
        const io = req.app.get('io');
        if (io) {
            // Notify Recipients
            
            // If sender is Supervisor or Admin, we want ALL Admins to see this message
            // Use site.companyId which we fetched earlier
            if (site.companyId) {
                io.to(`company_admins:${site.companyId}`).emit('new_message', message);
            }

            // Also notify the Supervisor involved
            if (senderRole === 'admin') {
                // Admin sent to Supervisor
                io.to(`supervisor:${recipientId}`).emit('new_message', message);
            } else {
                 // Supervisor sent (they get the ack via response, but socket helps sync other devices)
                 io.to(`supervisor:${req.user._id}`).emit('new_message', message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: message
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Get messages sent by a specific user (Supervisor)
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;

        const messages = await Message.find({ sender: userId })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: messages.length,
            data: messages
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get messages for a specific Site (For Admin or Supervisor)
router.get('/site/:siteId', auth, async (req, res) => {
    try {
        const { siteId } = req.params;

        // Simple query: Get all messages related to this site
        // You might want to add pagination here later
        const messages = await Message.find({ siteId })
            .sort({ createdAt: -1 }); // Newest first

        res.json({
            success: true,
            count: messages.length,
            data: messages
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get ALL messages for an Admin (from all their sites)
router.get('/admin/all', auth, async (req, res) => {
    try {
        // 1. Find all sites belonging to this admin's company
        const sites = await Site.find({ companyId: req.user.companyId });
        const siteIds = sites.map(site => site._id);

        // 2. Find all messages linked to these sites
        const messages = await Message.find({ siteId: { $in: siteIds } })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: messages.length,
            data: messages
        });
    } catch (error) {
        console.error('Fetch all messages error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Delete a single message
router.delete('/:id', auth, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        // Optional: Check permissions (e.g., only Admin can delete)
        // Since this is an Admin route, we assume they can delete any message or check if req.user.role === 'admin'

        // Soft delete
        message.isDeleted = true;
        message.content = "This message was deleted";
        message.videoUrl = null;
        
        await message.save();

        // Emit update to real-time sockets
        const io = req.app.get('io');
        if (io) {
            // Notify involved parties
            const companyId = req.user.companyId;
            if (companyId) {
                 io.to(`company_admins:${companyId}`).emit('message_updated', message);
            }
            io.to(`supervisor:${message.sender}`).emit('message_updated', message);
            io.to(`supervisor:${message.recipient}`).emit('message_updated', message);
        }

        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Add a comment to a message (Admin only)
router.post('/:id/comment', auth, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ message: 'Comment text is required' });
        }

        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        const comment = {
            text,
            adminId: req.user._id,
            adminName: req.user.username || 'Admin',
            createdAt: new Date()
        };

        message.adminComments.push(comment);
        await message.save();

        // Emit update
        const io = req.app.get('io');
        if (io) {
            // Notify involved parties
            // 1. Notify ALL Admins of this company
            // senderRole admin -> req.user.companyId
            // senderRole supervisor -> req.user.companyId (Supervisor also has companyId usually)
            // Fallback: use site.companyId if available (we need to fetch site for reply/comment if req.user doesn't have it populated)
            
            // For 'send' route, 'site' is fetched.
            // For 'comment' route, we fetched 'message', but not 'site'. 
            // However, req.user should have companyId.
            const companyId = req.user.companyId;

            if (companyId) {
                 io.to(`company_admins:${companyId}`).emit('message_updated', message);
            } else {
                 // Fallback to specific admin if companyId missing (shouldn't happen)
                 io.to(`admin:${message.recipient}`).emit('message_updated', message);
                 io.to(`admin:${message.sender}`).emit('message_updated', message); 
            }
            
            io.to(`supervisor:${message.sender}`).emit('message_updated', message);
            io.to(`supervisor:${message.recipient}`).emit('message_updated', message); 
        }

        res.json({ success: true, data: message });
    } catch (error) {
        console.error('Add comment error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Edit a comment (Admin only)
router.put('/:id/comment/:commentId', auth, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ message: 'Comment text is required' });
        }

        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        const comment = message.adminComments.id(req.params.commentId);
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        // Update text
        comment.text = text;
        // Mark who edited it last
        comment.adminId = req.user._id;
        comment.adminName = req.user.username || 'Admin';
        
        await message.save();

        // Emit update
        const io = req.app.get('io');
        if (io) {
            const companyId = req.user.companyId;
            if (companyId) {
                 io.to(`company_admins:${companyId}`).emit('message_updated', message);
            } else {
                 io.to(`admin:${message.recipient}`).emit('message_updated', message);
                 io.to(`admin:${message.sender}`).emit('message_updated', message); 
            }
            io.to(`supervisor:${message.sender}`).emit('message_updated', message);
            io.to(`supervisor:${message.recipient}`).emit('message_updated', message);
        }

        res.json({ success: true, data: message });
    } catch (error) {
        console.error('Edit comment error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Delete an entire conversation (all messages from a specific sender/supervisor)
router.delete('/conversation/:senderId', auth, async (req, res) => {
    try {
        const { senderId } = req.params;

        // Delete all messages where this user is the sender
        // Also consider messages sent BY admin TO this user if you want to clear the whole thread
        // For now, based on "AdminMessagesScreen" logic which groups by 'sender', we'll delete messages from that sender.
        // If the chat includes Admin replies, we might need to delete where (sender=senderId OR recipient=senderId).
        
        // Soft delete all interaction between Admin and this User
        // Update both sender and recipient messages to ensure the whole thread is cleared visually
        await Message.updateMany(
            {
                $or: [
                    { sender: senderId },
                    { recipient: senderId }
                ],
                isDeleted: false // Only update ones not already deleted
            },
            {
                $set: {
                    isDeleted: true,
                    content: "This message was deleted",
                    videoUrl: null
                }
            }
        );

        // Emit update to real-time sockets
        const io = req.app.get('io');
        if (io) {
            // Admin Room (though they triggered it)
            // Supervisor Room (senderId)
            io.to(`supervisor:${senderId}`).emit('conversation_updated');
            // We can also emit to admin if they have multiple devices
            // io.to(`admin:...`).emit('conversation_updated');
        }

        res.json({ success: true, message: 'Conversation deleted' });
    } catch (error) {
        console.error('Delete conversation error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;