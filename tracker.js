<script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-database.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-auth.js"></script>

<script>
(function() {
    // Inject the HTML and Styles into the page
    const trackerHtml = `
        <div style="padding: 20px; border: 1px solid #ddd; background: #f9f9f9; max-width: 400px; margin: 20px auto;">
            <p>Visitor Tracking is active. Session ID: <strong id="visitor-id-display">Loading...</strong></p>
            <p id="status-message" style="color: blue;">Gathering full visitor data...</p>
            <p style="font-size: 0.8em; color: #666;">User Name: <strong id="user-name-display">Loading...</strong></p>
            <p style="font-size: 0.8em; color: #666;">Current Title: <strong id="page-title-display"></strong></p>
        </div>
    `;
    // Insert the HTML box at the beginning of the body
    document.body.insertAdjacentHTML('afterbegin', trackerHtml);

    // 1. Your Firebase Configuration (Keep this section exactly the same)
    const firebaseConfig = {
        apiKey: "AIzaSyCziAIPcW4ijNkQWkCyeh5vxObRKRgmclE",
        authDomain: "locaa-d6a7f.firebaseapp.com",
        projectId: "locaa-d6a7f",
        databaseURL: "https://locaa-d6a7f-default-rtdb.firebaseio.com/",
        storageBucket: "locaa-d6a7f.firebasestorage.app",
        messagingSenderId: "746048395093",
        appId: "1:746048395093:web:efbabd53cb7bf5238b41dc",
        measurementId: "G-6PRSH4Y8MD"
    };

    // 2. Initialize Firebase and References
    const app = firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const auth = firebase.auth();
    const liveVisitorsRef = db.ref('liveVisitors');
    const visitorProfilesRef = db.ref('visitorProfiles');
    const refreshSignalsRef = db.ref('refreshSignals');
    let visitorId = '';
    
    // --- NEW: Session Persistence Logic ---
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
    
    let sessionId = (function() {
        const storedId = localStorage.getItem('tracker_sessionId');
        const storedExpiry = localStorage.getItem('tracker_sessionExpiry');

        if (storedId && storedExpiry && Date.now() < parseInt(storedExpiry, 10)) {
            localStorage.setItem('tracker_sessionExpiry', (Date.now() + SESSION_TIMEOUT_MS).toString());
            return storedId;
        } else {
            const newId = Date.now().toString(36) + Math.random().toString(36).substring(2);
            localStorage.setItem('tracker_sessionId', newId);
            localStorage.setItem('tracker_sessionExpiry', (Date.now() + SESSION_TIMEOUT_MS).toString());
            return newId;
        }
    })();
    // --- END NEW LOGIC ---
    
    let sessionStartTime = Date.now();
    const idDisplay = document.getElementById('visitor-id-display');
    const statusMessage = document.getElementById('status-message');
    const userNameDisplay = document.getElementById('user-name-display');
    const pageTitleDisplay = document.getElementById('page-title-display');
    let lastObservedName = '';
    let initialSessionWriteDone = false; 
    let lastReportedTitle = document.title;
    let updatePresenceRef; // Reference to updatePresence function will be defined later
    
    // --- UTILITIES AND STATUS FUNCTIONS ---
    
    async function getBatteryStatus() {
        if (!navigator.getBattery) return { batteryLevel: 'N/A', isCharging: 'N/A' };
        try {
            const battery = await navigator.getBattery();
            return {
                batteryLevel: Math.round(battery.level * 100) + '%',
                isCharging: battery.charging
            };
        } catch (e) {
            return { batteryLevel: 'Error', isCharging: 'Error' };
        }
    }
    function getNetworkStatus() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!connection) return 'Unknown/N/A';
        let networkType = connection.type || 'Unknown';
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        if (connection.effectiveType) {
            switch (connection.effectiveType) {
                case '2g': networkType = '2G'; break;
                case '3g': networkType = '3G'; break;
                case '4g': networkType = '4G'; break;
                case '5g': networkType = '5G'; break;
                default: 
                    if (networkType === 'Unknown' || networkType === 'wifi' || networkType === 'ethernet') {
                        networkType = connection.effectiveType;
                    }
                    break;
            }
        }
        if (!isMobile && networkType.includes('g') && (connection.type === 'wifi' || connection.type === 'ethernet')) {
            networkType = connection.type.charAt(0).toUpperCase() + connection.type.slice(1);
        }
        return networkType.charAt(0).toUpperCase() + networkType.slice(1);
    }
    async function getDeviceModel() {
        let detectedModel = "Unknown Device";
        if (navigator.userAgentData) {
            try {
                const highEntropyValues = await navigator.userAgentData.getHighEntropyValues(["model"]);
                if (highEntropyValues.model) detectedModel = highEntropyValues.model;
            } catch (e) {
                console.error("UA-CH error:", e);
            }
        }
        if (detectedModel === "Unknown Device" || detectedModel === "") {
            const userAgent = navigator.userAgent;
            if (userAgent.includes("iPhone")) detectedModel = "Apple iPhone";
            else if (userAgent.includes("iPad")) detectedModel = "Apple iPad";
            else if (userAgent.includes("Android")) detectedModel = "Android Device";
            else if (userAgent.includes("Macintosh")) detectedModel = "Apple Mac";
            else if (userAgent.includes("Windows")) detectedModel = "Windows PC";
        }
        return detectedModel;
    }
    function getOSAndBrowser() {
        const userAgent = navigator.userAgent;
        let os = "Unknown OS";
        let browser = "Unknown Browser";
        if (userAgent.includes("Windows NT")) os = "Windows";
        else if (userAgent.includes("Macintosh")) os = "macOS";
        else if (userAgent.includes("Android")) os = "Android";
        else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) os = "iOS/iPadOS";
        else if (userAgent.includes("Linux")) os = "Linux";
        if (userAgent.includes("Edg")) browser = "Microsoft Edge";
        else if (userAgent.includes("OPR") || userAgent.includes("Opera")) browser = "Opera";
        else if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) browser = "Chrome";
        else if (userAgent.includes("Firefox")) browser = "Firefox";
        else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) browser = "Safari";
        return { os, browser };
    }
    async function getGeoLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve({ latitude: 'N/A', longitude: 'N/A', locationAccuracy: 'N/A' });
            function success(position) {
                resolve({
                    latitude: position.coords.latitude.toFixed(5),
                    longitude: position.coords.longitude.toFixed(5),
                    locationAccuracy: position.coords.accuracy ? `${position.coords.accuracy.toFixed(0)}m` : 'Unknown'
                });
            }
            function error(err) {
                let message = 'Permission Denied';
                if (err.code === err.POSITION_UNAVAILABLE) message = 'Position Unavailable';
                else if (err.code === err.TIMEOUT) message = 'Timeout';
                if (statusMessage) statusMessage.textContent = `Location Status: ${message}. Tracking without coordinates.`;
                resolve({ latitude: message, longitude: message, locationAccuracy: 'N/A' });
            }
            navigator.geolocation.getCurrentPosition(success, error, {
                enableHighAccuracy: true,
                timeout: 5000 
            });
        });
    }
    async function getIPAddress() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip || 'Unknown';
        } catch (error) {
            console.error('Error fetching IP address:', error);
            return 'Failed to Fetch';
        }
    }
    
    function getCurrentStatus() {
        if (document.visibilityState === 'visible') {
            return 'Online';
        }
        return 'Away';
    }

    async function getBaseVisitorInfo() {
        const [battery, deviceModel, locationData, ipAddress, osBrowser] = await Promise.all([
            getBatteryStatus(),
            getDeviceModel(),
            getGeoLocation(),
            getIPAddress(),
            getOSAndBrowser()
        ]);
        return {
            page: window.location.pathname,
            title: document.title, 
            referrer: document.referrer || 'Direct/Unknown',
            ipAddress: ipAddress,
            location: `${locationData.latitude}, ${locationData.longitude}`,
            locationAccuracy: locationData.locationAccuracy,
            deviceModel: deviceModel,
            deviceType: /Mobi|Android/i.test(navigator.userAgent) ? 'Phone' : 'Computer',
            os: osBrowser.os,
            browser: osBrowser.browser,
            network: getNetworkStatus(),
            battery: battery.batteryLevel,
            charging: battery.isCharging
        };
    }
    
    async function getVisitorCount() {
        try {
            const snapshot = await visitorProfilesRef.once('value');
            return snapshot.numChildren() || 0; 
        } catch (error) {
            console.error("Error fetching visitor count:", error);
            return 0;
        }
    }
    
    function getFullNameFromLocalStorage(key) {
        const storedValue = localStorage.getItem(key);
        if (!storedValue) return null;

        try {
            const userData = JSON.parse(storedValue);
            if (userData && typeof userData.firstName === 'string' && typeof userData.lastName === 'string') {
                const fullName = `${userData.firstName.trim()} ${userData.lastName.trim()}`.trim();
                return fullName.length > 0 ? fullName : null;
            }
            return null;
        } catch (e) {
            return null;
        }
    }
    
    // --- FIREBASE INTEGRATION LOGIC ---

    auth.signInAnonymously()
        .then((userCredential) => {
            visitorId = userCredential.user.uid;
            initializeTracker();
        })
        .catch((error) => {
            console.error("Firebase Auth Error:", error.message);
            visitorId = 'anon-' + (Math.random().toString(36).substring(2) + Date.now().toString(36));
            initializeTracker();
        });

    async function initializeTracker() {
        if (!visitorId) return;
        
        idDisplay.textContent = visitorId.substring(0, 12) + '...';
        pageTitleDisplay.textContent = document.title;

        const profileRef = visitorProfilesRef.child(visitorId);
        profileRef.once('value').then(async (snapshot) => {
            const profile = snapshot.val();
            
            let visitorName = '';
            let sessionCount; 
            let firstSeen = firebase.database.ServerValue.TIMESTAMP;
            let isNewSession = false; 
        
            const isExistingSession = profile && profile.sessions && profile.sessions[sessionId];
            
            if (isExistingSession) {
                sessionCount = profile.sessions[sessionId].sessionNumber;
            } else {
                sessionCount = (profile ? profile.totalSessions : 0) + 1;
                isNewSession = true;
            }

            const localStorageFullName = getFullNameFromLocalStorage('user');
            let storedName = localStorage.getItem('User');

            if (profile) {
                visitorName = localStorageFullName || storedName || profile.name;
                firstSeen = profile.firstSeen;
            } else {
                if (localStorageFullName) {
                    visitorName = localStorageFullName;
                } else if (storedName && !storedName.startsWith('Visitor ')) {
                    visitorName = storedName;
                } else {
                    const count = await getVisitorCount();
                    visitorName = `Visitor ${count + 1}`;
                }
            }
            
            lastObservedName = localStorageFullName;
            localStorage.setItem('User', visitorName);
            userNameDisplay.textContent = visitorName;

            const baseInfo = await getBaseVisitorInfo();
            const profileUpdate = {
                name: visitorName, 
                firstSeen: firstSeen,
                lastSeen: firebase.database.ServerValue.TIMESTAMP,
                latestDeviceInfo: baseInfo,
            };
            if (isNewSession) {
                profileUpdate.totalSessions = sessionCount;
            }
            
            profileRef.update(profileUpdate);
            startLocalStorageMonitor(profileRef);
            startSession(profileRef, baseInfo, sessionCount, isNewSession);
            startTitleMonitor();
        });
    }
    
    function startLocalStorageMonitor(profileRef) {
        setInterval(() => {
            const currentLocalStorageName = getFullNameFromLocalStorage('user');
            
            if (currentLocalStorageName && currentLocalStorageName !== lastObservedName) {
                console.log(`[Tracker] LocalStorage 'user' changed. Updating name to: ${currentLocalStorageName}`);
                
                profileRef.update({ name: currentLocalStorageName })
                    .then(() => {
                        localStorage.setItem('User', currentLocalStorageName);
                        userNameDisplay.textContent = currentLocalStorageName;
                        lastObservedName = currentLocalStorageName;
                    })
                    .catch(e => console.error("Error updating profile name:", e));
            }
        }, 5000);
    }

    // 5. Session and Live Status Logic
    function startSession(profileRef, baseInfo, sessionNumber, isNewSession) {
        const currentPath = window.location.pathname;
        const sessionRef = profileRef.child('sessions').child(sessionId);

        // 5.1 Set up OnDisconnect
        liveVisitorsRef.child(visitorId).onDisconnect().set({
            status: 'Offline',
            lastUpdate: firebase.database.ServerValue.TIMESTAMP,
            page: currentPath,
            sessionId: sessionId,
            name: localStorage.getItem('User') || `Visitor ${visitorId.substring(0, 4)}`,
            title: document.title,
        });

        // 5.2 Live Status Update Function (Heartbeat) - Defined here to use lastReportedTitle from the outer scope
        updatePresenceRef = async function updatePresence() {
            const status = getCurrentStatus();
            const currentName = localStorage.getItem('User') || `Visitor ${visitorId.substring(0, 4)}`;
            const currentTitle = document.title;

            if (pageTitleDisplay.textContent !== currentTitle) {
                pageTitleDisplay.textContent = currentTitle;
            }

            const liveData = {
                status: status,
                lastUpdate: firebase.database.ServerValue.TIMESTAMP,
                page: currentPath,
                title: currentTitle,
                sessionId: sessionId,
                sessionNumber: sessionNumber,
                visitorId: visitorId,
                name: currentName,
                deviceType: baseInfo.deviceType
            };

            if (currentTitle !== lastReportedTitle || status === 'Online') { 
                liveVisitorsRef.child(visitorId).set(liveData)
                    .then(() => {
                        if (statusMessage) statusMessage.textContent = `${status}. Last update: ${new Date().toLocaleTimeString()}`;
                        lastReportedTitle = currentTitle;
                    })
                    .catch(e => {
                        if (statusMessage) statusMessage.textContent = `Error: ${e.message}`;
                    });
            } else {
                 liveVisitorsRef.child(visitorId).update({
                    status: status,
                    lastUpdate: firebase.database.ServerValue.TIMESTAMP,
                 });
            }
            
            // 5.2.2 Update Session History
            const currentPathKey = currentPath.replace(/[.#$/[\]]/g, '_');
            
            const pathDataUpdate = {
                time: firebase.database.ServerValue.TIMESTAMP,
                pageTitle: currentTitle
            };
            sessionRef.child('paths').child(currentPathKey).update(pathDataUpdate);
            
            let sessionRootUpdate = {
                end: firebase.database.ServerValue.TIMESTAMP
            };

            if (isNewSession && !initialSessionWriteDone) {
                sessionRootUpdate.sessionNumber = sessionNumber;
                sessionRootUpdate.start = sessionStartTime;
                sessionRootUpdate.baseInfo = baseInfo;
                sessionRef.update(sessionRootUpdate).then(() => {
                    initialSessionWriteDone = true;
                });
            } else {
                sessionRef.update({
                    end: firebase.database.ServerValue.TIMESTAMP
                });
            }
        };

        // 5.3 Event Listeners and Heartbeat
        document.addEventListener('visibilitychange', updatePresenceRef);
        window.addEventListener('beforeunload', () => {
            liveVisitorsRef.child(visitorId).set({ status: 'Offline', lastUpdate: Date.now(), title: document.title });
            profileRef.child('sessions').child(sessionId).update({
                end: Date.now()
            });
        });
        updatePresenceRef(); // Initial send
        setInterval(updatePresenceRef, 10000);
        
        // 5.4 Remote Refresh Listener 
        const userRefreshSignalRef = refreshSignalsRef.child(visitorId);
        userRefreshSignalRef.on('value', (snapshot) => {
            const signal = snapshot.val();
            if (signal && signal.signal === true) {
                userRefreshSignalRef.remove().then(() => {
                    window.location.reload(true);
                }).catch(() => {
                    window.location.reload(true);
                });
            }
        });
    }

    // --- NEW REAL-TIME TITLE MONITORING ---
    function startTitleMonitor() {
        const titleElement = document.querySelector('title');
        if (!titleElement) {
            console.warn("[Tracker] Cannot find <title> element to observe.");
            return;
        }

        const callback = function(mutationsList, observer) {
            for(const mutation of mutationsList) {
                if (mutation.type === 'characterData') {
                    const newTitle = document.title;
                    console.log(`[Tracker] Page Title changed to: ${newTitle}`);

                    // Use the outer reference to updatePresence
                    if (updatePresenceRef) { 
                        updatePresenceRef(); 
                    } 
                    if (pageTitleDisplay) {
                        pageTitleDisplay.textContent = newTitle;
                    }
                }
            }
        };

        const observer = new MutationObserver(callback);
        observer.observe(titleElement, {
            subtree: true,
            characterData: true,
            childList: true 
        });
    }
    // --- END NEW REAL-TIME TITLE MONITORING ---
})();
</script>
