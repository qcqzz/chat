/**
 * firebase-sync.js — 传讯 Firebase 同步层
 *
 * 功能：
 *   1. 消息同步到 Firestore（多设备实时同步）
 *   2. FCM Token 注册（用于推送通知）
 *   3. 监听对方消息（实时接收）
 *
 * 使用方式：
 *   - 在 Firebase 控制台获取配置，填入下方 firebaseConfig
 *   - 双方设备使用相同的 sessionId 即可同步
 */

(function (global) {
    'use strict';

    var _initialized = false;
    var _sessionId = null;
    var _userId = null;
    var _db = null;
    var _unsubscribe = null;
    var _fcmToken = null;

    // ====== Firebase 配置（从 localStorage 读取，或使用默认值） ======
    function getFirebaseConfig() {
        // 优先从 localStorage 读取（用户可在设置中配置）
        try {
            var saved = localStorage.getItem('firebase_config');
            if (saved) return JSON.parse(saved);
        } catch (e) {}

        // 默认配置（需替换为你的 Firebase 项目配置）
        return {
            apiKey: '',
            authDomain: '',
            projectId: '',
            storageBucket: '',
            messagingSenderId: '',
            appId: '',
        };
    }

    // ====== 公开 API ======
    var FirebaseSync = {
        /**
         * 是否已初始化
         */
        isReady: function () {
            return _initialized && _db !== null;
        },

        /**
         * 获取 sessionId
         */
        getSessionId: function () {
            if (!_sessionId) {
                _sessionId = localStorage.getItem('chat_session_id');
                if (!_sessionId) {
                    _sessionId = 'session_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
                    localStorage.setItem('chat_session_id', _sessionId);
                }
            }
            return _sessionId;
        },

        /**
         * 获取 userId
         */
        getUserId: function () {
            if (!_userId) {
                _userId = localStorage.getItem('chat_user_id');
                if (!_userId) {
                    _userId = 'user_' + Math.random().toString(36).substr(2, 8);
                    localStorage.setItem('chat_user_id', _userId);
                }
            }
            return _userId;
        },

        /**
         * 初始化 Firebase
         */
        init: function () {
            if (_initialized) return;

            var config = getFirebaseConfig();
            if (!config.apiKey || !config.projectId) {
                console.warn('[FirebaseSync] Firebase 未配置，跳过初始化。请在 Firebase 控制台获取配置。');
                return;
            }

            try {
                if (typeof firebase === 'undefined') {
                    console.warn('[FirebaseSync] Firebase SDK 未加载');
                    return;
                }

                firebase.initializeApp(config);
                _db = firebase.firestore();
                _initialized = true;

                console.log('[FirebaseSync] Firebase 初始化成功, projectId:', config.projectId);
            } catch (e) {
                console.error('[FirebaseSync] 初始化失败:', e);
            }
        },

        /**
         * 发送消息到 Firestore（触发对方推送）
         */
        sendMessage: function (text, type, from, senderName) {
            if (!_db) return Promise.resolve(null);

            var sessionId = this.getSessionId();
            return _db.collection('sessions')
                .doc(sessionId)
                .collection('messages')
                .add({
                    text: text,
                    type: type || 'normal',
                    from: from || this.getUserId(),
                    senderName: senderName || '我',
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                })
                .then(function (docRef) {
                    console.log('[FirebaseSync] 消息已发送:', docRef.id);
                    return docRef.id;
                })
                .catch(function (err) {
                    console.error('[FirebaseSync] 发送消息失败:', err);
                    return null;
                });
        },

        /**
         * 监听对方新消息
         * @param {function} callback - 收到对方消息时的回调 ({ text, type, from, senderName })
         */
        listenMessages: function (callback) {
            if (!_db || !callback) return;

            var sessionId = this.getSessionId();
            var myUserId = this.getUserId();

            // 取消之前的监听
            if (_unsubscribe) _unsubscribe();

            // 监听最新消息
            _unsubscribe = _db.collection('sessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('timestamp', 'desc')
                .limit(1)
                .onSnapshot(function (snapshot) {
                    snapshot.docChanges().forEach(function (change) {
                        if (change.type === 'added') {
                            var msg = change.doc.data();
                            // 忽略自己发的消息
                            if (msg.from === myUserId) return;
                            callback(msg);
                        }
                    });
                }, function (err) {
                    console.error('[FirebaseSync] 监听消息失败:', err);
                });

            console.log('[FirebaseSync] 开始监听会话:', sessionId);
        },

        /**
         * 停止监听
         */
        stopListening: function () {
            if (_unsubscribe) {
                _unsubscribe();
                _unsubscribe = null;
            }
        },

        /**
         * 注册 FCM Token（用于接收推送）
         */
        registerToken: function (token) {
            if (!_db || !token) return Promise.resolve(false);

            _fcmToken = token;
            var sessionId = this.getSessionId();
            var userId = this.getUserId();

            return _db.collection('sessions')
                .doc(sessionId)
                .collection('tokens')
                .doc(userId)
                .set({
                    token: token,
                    userId: userId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                })
                .then(function () {
                    console.log('[FirebaseSync] Token 已注册');
                    return true;
                })
                .catch(function (err) {
                    console.error('[FirebaseSync] Token 注册失败:', err);
                    return false;
                });
        },

        /**
         * 更新会话 ID（两个设备需要相同的 sessionId）
         */
        setSessionId: function (id) {
            _sessionId = id;
            localStorage.setItem('chat_session_id', id);
        },

        /**
         * 更新 Firebase 配置
         */
        setConfig: function (config) {
            localStorage.setItem('firebase_config', JSON.stringify(config));
        },
    };

    // 暴露到全局
    global.FirebaseSync = FirebaseSync;

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(function () { FirebaseSync.init(); }, 500);
        });
    } else {
        setTimeout(function () { FirebaseSync.init(); }, 500);
    }

})(window);