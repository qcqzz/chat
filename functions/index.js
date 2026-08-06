/**
 * 传讯 - Firebase Cloud Functions
 * 功能：
 *   1. 新消息推送：当 Firestore 有新消息时，向对方设备发送 FCM 推送
 *   2. 注册 Token：保存设备 FCM token
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * 监听新消息，自动推送给对方
 * 触发路径：sessions/{sessionId}/messages/{messageId}
 */
exports.onNewMessage = functions.firestore
    .document('sessions/{sessionId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
        const { sessionId, messageId } = context.params;
        const message = snap.data();

        if (!message) return null;
        // 只处理用户真实发送的消息（非系统消息）
        if (message.from === 'system') return null;

        try {
            // 查找会话中所有设备 token
            const tokensSnap = await db
                .collection('sessions')
                .doc(sessionId)
                .collection('tokens')
                .get();

            if (tokensSnap.empty) {
                console.log(`会话 ${sessionId} 没有注册的设备 token`);
                return null;
            }

            const senderId = message.from || '';
            const tokens = [];

            tokensSnap.forEach(doc => {
                const data = doc.data();
                // 不推送给发送者自己
                if (data.userId && data.userId !== senderId && data.token) {
                    tokens.push(data.token);
                }
            });

            if (tokens.length === 0) {
                console.log('没有可推送的目标设备');
                return null;
            }

            const senderName = message.senderName || '对方';
            const body = message.type === 'image'
                ? '[图片]'
                : (message.text || '').substring(0, 100);

            const payload = {
                notification: {
                    title: senderName,
                    body: body || '发来了一条消息',
                },
                data: {
                    sessionId: sessionId,
                    messageId: messageId,
                    from: senderId,
                    type: 'new_message',
                },
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'partner_message_channel',
                        sound: 'default',
                    },
                },
            };

            // 批量发送推送
            const response = await admin.messaging().sendEachForMulticast({
                tokens: tokens,
                ...payload,
            });

            console.log(`推送发送完成: 成功 ${response.successCount}, 失败 ${response.failureCount}`);

            // 清理失效的 token
            if (response.failureCount > 0) {
                const batch = db.batch();
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const errorCode = resp.error?.code;
                        if (errorCode === 'messaging/invalid-registration-token' ||
                            errorCode === 'messaging/registration-token-not-registered') {
                            const tokenDoc = tokensSnap.docs[idx];
                            if (tokenDoc) {
                                batch.delete(tokenDoc.ref);
                            }
                        }
                    }
                });
                await batch.commit();
            }

            return null;
        } catch (error) {
            console.error('推送发送失败:', error);
            return null;
        }
    });

/**
 * HTTP 接口：注册设备 FCM Token
 * POST /registerToken
 * Body: { sessionId, token, userId }
 */
exports.registerToken = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { sessionId, token, userId } = req.body;
        if (!sessionId || !token) {
            res.status(400).json({ error: '缺少 sessionId 或 token' });
            return;
        }

        await db
            .collection('sessions')
            .doc(sessionId)
            .collection('tokens')
            .doc(userId || 'default')
            .set({
                token: token,
                userId: userId || 'default',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

        res.json({ success: true });
    } catch (error) {
        console.error('注册 token 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * HTTP 接口：发送消息到 Firestore
 * POST /sendMessage
 * Body: { sessionId, text, type, from, senderName }
 */
exports.sendMessage = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { sessionId, text, type, from, senderName } = req.body;
        if (!sessionId || !text) {
            res.status(400).json({ error: '缺少 sessionId 或 text' });
            return;
        }

        const msgRef = await db
            .collection('sessions')
            .doc(sessionId)
            .collection('messages')
            .add({
                text: text,
                type: type || 'normal',
                from: from || 'unknown',
                senderName: senderName || '用户',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

        res.json({ success: true, messageId: msgRef.id });
    } catch (error) {
        console.error('发送消息失败:', error);
        res.status(500).json({ error: error.message });
    }
});