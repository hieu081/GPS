import { auth } from '../login/firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-auth.js";
import { ref, query, limitToLast, onValue, set } from "https://www.gstatic.com/firebasejs/10.1.0/firebase-database.js";
import { database } from '../login/firebase-config.js';

let map, marker, userMarker, gpsPolyline;
let userLocation = null;
let isSatelliteView = localStorage.getItem('satelliteView') === 'true';
let isTracking = false;
let animationFrameId = null;
let isReplaying = false;
let replayTimeoutId = null;
let isRouting = false;
let routeLayer = null;
let lastMarkerLatLng = null;
const UPDATE_TIME_UI = 1000;
const MAX_WAYPOINTS = 10000;
let lastFilteredLat = null, lastFilteredLng = null;
const MIN_DISTANCE_CHANGE = 0.000003; // 3m
const PAGE_LIMIT = 100;
let currentReplaySpeed = 50; // Biến toàn cục để lưu tốc độ phát lại hiện tại
let replayIndex = 0; // Biến để lưu vị trí hiện tại của phát lại
let latlngs = [];
const standardTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
});
const satelliteTileLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const showNotification = (message, duration = 3000) => {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.style.display = 'block';
    setTimeout(() => notification.style.display = 'none', duration);
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const kalmanFilter = (value, lastValue, speed, noiseBase = 0.1) => {
    if (lastValue === null) return value;
    const adjustedNoise = noiseBase * (1 + speed / 50);
    return lastValue + (value - lastValue) * Math.min(adjustedNoise, 1);
};

const parseCustomTimestamp = (timestamp) => {
    if (typeof timestamp === 'string') {
        const [datePart, timePart] = timestamp.split(' ');
        const [day, month, year] = datePart.split('/').map(Number);
        const [hours, minutes, seconds] = timePart.split(':').map(Number);
        return new Date(year, month - 1, day, hours, minutes, seconds);
    }
    return new Date(timestamp * 1000);
};

const initMap = () => {
    map = L.map('map', { zoomControl: false }).setView([20.972563, 105.983978], 19);
    if (isSatelliteView) satelliteTileLayer.addTo(map);
    else standardTileLayer.addTo(map);

    marker = L.marker([20.972563, 105.983978], {
        icon: L.divIcon({ className: 'custom-marker', html: '📍', iconSize: [32, 32] })
    }).addTo(map).bindPopup('Thiết bị GPS<br>Vị trí: <span id="popupLocation"></span>');

    userMarker = L.marker([0, 0], {
        icon: L.divIcon({ className: 'user-marker', html: '👱', iconSize: [32, 32] })
    }).addTo(map).bindPopup('Vị trí của bạn');
};

const subscribeToGPSUpdates = async () => {
    const gpsRef = ref(database, 'gps');
    let lastUpdateTime = null;

    if (!gpsPolyline) {
        gpsPolyline = L.polyline([], { color: 'green', dashArray: "38", weight: 10 }).addTo(map);
    }

    onValue(query(gpsRef, limitToLast(PAGE_LIMIT)), async (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            showNotification('Không có dữ liệu GPS.');
            gpsPolyline.setLatLngs([]);
            return;
        }

        const lastEntryKey = Object.keys(data).pop();
        const lastData = data[lastEntryKey];
        const lat = Number(lastData.latitude);
        const lng = Number(lastData.longitude);
        const speed = Number(lastData.speed);
        const timestamp = lastData.timestamp || Date.now();

        if (isNaN(lat) || isNaN(lng) || isNaN(speed)) {
            showNotification('Dữ liệu GPS không hợp lệ.');
            return;
        }

        const smoothLat = kalmanFilter(lat, lastFilteredLat, speed);
        const smoothLng = kalmanFilter(lng, lastFilteredLng, speed);
        lastFilteredLat = smoothLat;
        lastFilteredLng = smoothLng;

        const currentLatLng = marker.getLatLng();
        const distance = calculateDistance(currentLatLng.lat, currentLatLng.lng, smoothLat, smoothLng);
        const currentTime = Date.now();
        const timeDiff = lastUpdateTime ? (currentTime - lastUpdateTime) / 1000 : 0;
        lastUpdateTime = currentTime;

        if (distance < MIN_DISTANCE_CHANGE) return;

        const endLatLng = L.latLng(smoothLat, smoothLng);

        const DISTANCE_THRESHOLD = 0.05;
        if (lastMarkerLatLng && distance > DISTANCE_THRESHOLD) {
            const routeCoords = await fetchRouteFromOSRM([
                { lat: lastMarkerLatLng.lat, lng: lastMarkerLatLng.lng },
                { lat: smoothLat, lng: smoothLng }
            ]);
            if (routeCoords.length > 0) {
                const formattedRoute = routeCoords.map(coord => [coord[1], coord[0]]);
                gpsPolyline.addLatLng(formattedRoute[formattedRoute.length - 1]);
            } else {
                gpsPolyline.addLatLng(endLatLng);
            }
        } else {
            gpsPolyline.addLatLng(endLatLng);
        }

        const TIME_THRESHOLD = 60;
        if (distance > DISTANCE_THRESHOLD || (timeDiff > TIME_THRESHOLD && timeDiff !== 0)) {
            marker.setLatLng(endLatLng);
            marker.setPopupContent(`Thiết bị GPS<br>Vị trí: ${smoothLat.toFixed(6)}, ${smoothLng.toFixed(6)}`);
            if (isTracking) {
                map.flyTo([smoothLat, smoothLng], 19, { animate: true, duration: 1.5 }); // Đồng bộ với centerMap
            }
        } else {
            const startLatLng = marker.getLatLng();
            const duration = 200;
            const startTime = performance.now();

            const animateMarker = (currentTime) => {
                const elapsedTime = currentTime - startTime;
                const progress = Math.min(elapsedTime / duration, 1);
                const newLat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * progress;
                const newLng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * progress;
                marker.setLatLng([newLat, newLng]);
                marker.setPopupContent(`Thiết bị GPS<br>Vị trí: ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`);
                if (progress < 1) {
                    animationFrameId = requestAnimationFrame(animateMarker);
                } else if (isTracking) {
                    map.flyTo([smoothLat, smoothLng], 19, { animate: true, duration: 1.5 }); // Đồng bộ với centerMap
                }
            };
            animationFrameId = requestAnimationFrame(animateMarker);
        }

        lastMarkerLatLng = endLatLng;
        updateUI(smoothLat, smoothLng, speed, timestamp);
    }, (error) => {
        showNotification('Lỗi kết nối Firebase: ' + error.message);
    });
};
const updateUI = (lat, lng, speed, timestamp) => {
    document.getElementById('location').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('speed').textContent = `${speed.toFixed(2)} km/h`;

    const date = parseCustomTimestamp(timestamp);
    if (isNaN(date.getTime())) {
        document.getElementById('date').textContent = "Không xác định";
        document.getElementById('time').textContent = "Không xác định";
    } else {
        document.getElementById('date').textContent = date.toLocaleDateString('vi-VN');
        document.getElementById('time').textContent = date.toLocaleTimeString('vi-VN');
    }
};

async function fetchRouteFromOSRM(waypoints) {
    const coords = waypoints.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('API định tuyến không phản hồi.');
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            return data.routes[0].geometry.coordinates;
        }
    } catch (error) {
        showNotification('Không thể tải tuyến đường: ' + error.message);
    }
    return [];
}

function samplePoints(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    showNotification(`Tuyến đường quá dài (${points.length} điểm), chỉ hiển thị ${maxPoints} điểm.`);
    const sampled = [];
    const interval = (points.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
        sampled.push(points[Math.round(i * interval)]);
    }
    return sampled;
}

const loadPathHistory = async () => {
    const gpsRef = ref(database, 'gps');
    onValue(query(gpsRef, limitToLast(PAGE_LIMIT)), async (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            showNotification('Không có dữ liệu lịch sử tuyến đường.');
            if (gpsPolyline) gpsPolyline.setLatLngs([]);
            return;
        }

        const entries = Object.values(data)
            .filter(item => item && typeof item === 'object')
            .sort((a, b) => (a.timestamp || Date.now()) - (b.timestamp || Date.now()));

        const latlngs = entries.map(item => ({
            lat: parseFloat(item.latitude),
            lng: parseFloat(item.longitude)
        })).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

        if (latlngs.length < 2) {
            showNotification('Không đủ điểm để vẽ tuyến đường.');
            if (gpsPolyline) gpsPolyline.setLatLngs([]);
            return;
        }

        let fullRoute = [];
        const chunkSize = 10; // Xử lý từng đoạn 10 điểm để tăng tốc
        for (let i = 0; i < latlngs.length - 1; i += chunkSize) {
            const chunk = latlngs.slice(i, i + chunkSize + 1);
            const routeCoords = await fetchRouteFromOSRM(chunk);
            if (routeCoords.length > 0) {
                const formattedRoute = routeCoords.map(coord => [coord[1], coord[0]]);
                fullRoute = fullRoute.concat(formattedRoute.slice(0, -1));
            } else {
                fullRoute.push([chunk[0].lat, chunk[0].lng]);
            }
        }
        fullRoute.push([latlngs[latlngs.length - 1].lat, latlngs[latlngs.length - 1].lng]);

        const limitedPoints = samplePoints(fullRoute, MAX_WAYPOINTS);
        if (gpsPolyline) gpsPolyline.setLatLngs(limitedPoints);
    }, (error) => {
        showNotification('Lỗi kết nối Firebase: ' + error.message);
    });
};

const clearPathHistory = async () => {
    try {
        await set(ref(database, 'gps'), null);
        if (gpsPolyline) gpsPolyline.setLatLngs([]);
        showNotification('Đã xóa lịch sử tuyến đường.');
    } catch (error) {
        showNotification('Lỗi khi xóa lịch sử: ' + error.message);
    }
};

const toggleSatelliteView = () => {
    if (isSatelliteView) {
        map.removeLayer(satelliteTileLayer);
        standardTileLayer.addTo(map);
    } else {
        map.removeLayer(standardTileLayer);
        satelliteTileLayer.addTo(map);
    }
    isSatelliteView = !isSatelliteView;
    localStorage.setItem('satelliteView', isSatelliteView);
};



const centerUserLocation = () => {
    if (userLocation) map.flyTo([userLocation.lat, userLocation.lng], 19, { animate: true, duration: 1.5 });
    else showNotification('Chưa xác định được vị trí người dùng.');
};

const getUserLocationContinuously = () => {
    if (navigator.geolocation) {
        const savedLocation = JSON.parse(localStorage.getItem('userLocation'));
        if (savedLocation) {
            userLocation = savedLocation;
            userMarker.setLatLng([userLocation.lat, userLocation.lng]);
        }
        navigator.geolocation.watchPosition(
            (position) => {
                userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                userMarker.setLatLng([userLocation.lat, userLocation.lng]);
                localStorage.setItem('userLocation', JSON.stringify(userLocation));
            },
            () => showNotification('Không thể lấy vị trí của bạn.'),
            { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
        );
    } else {
        showNotification('Trình duyệt không hỗ trợ Geolocation.');
    }
};

const showRoute = () => {
    if (!userLocation || !marker) {
        showNotification('Cần vị trí người dùng và thiết bị để hiển thị tuyến đường.');
        return;
    }

    if (isRouting) {
        if (routeLayer) {
            map.removeControl(routeLayer);
            routeLayer = null;
        }
        isRouting = false;
        showNotification('Đã tắt chỉ đường.');
        
        // Hide panels but keep content
        document.getElementById('route-instructions').classList.add('hidden');
        const distanceEl = document.getElementById('route-distance');
        const durationEl = document.getElementById('route-duration');
        distanceEl.style.color = isDarkMode ? '#ffffff' : '##0e0d0d';
        durationEl.style.color = isDarkMode ? '#ffffff' : '##0e0d0d';
        return;
    }

    const deviceLocation = marker.getLatLng();
    routeLayer = L.Routing.control({
        waypoints: [L.latLng(userLocation.lat, userLocation.lng), L.latLng(deviceLocation.lat, deviceLocation.lng)],
        router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
        lineOptions: { styles: [{ color: '#007AFF', opacity: 0.7, weight: 5 }] },
        createMarker: () => null
    }).addTo(map);

    // Show panels
    document.getElementById('route-instructions').classList.remove('hidden');

    routeLayer.on('routesfound', (e) => {
        const route = e.routes[0];
        const routeDistance = route.summary.totalDistance / 1000;
        const routeDuration = route.summary.totalTime / 60;
        document.getElementById('distance').textContent = `${routeDistance.toFixed(2)} km`;
        document.getElementById('route-distance').textContent = `${routeDistance.toFixed(2)} km`;
        document.getElementById('route-duration').textContent = `${routeDuration.toFixed(0)} phút`;

        let instructionsHTML = '<ul>';
        route.instructions.forEach((instruction, index) => {
            let text = instruction.text;
            const translations = {
                "southwest": "tây nam",
                "Head": "Đi thẳng",
                "east": "hướng đông",
                "west": "hướng tây",
                "north": "hướng bắc",
                "south": "hướng nam",
                "Turn left": "Rẽ trái",
                "Turn right": "Rẽ phải",
                "Continue": "Tiếp tục",
                "at": "tại",
                "onto": "vào",
                "toward": "về phía",
                "roundabout": "vòng xuyến",
                "Exit roundabout": "Ra khỏi vòng xuyến",
                "Destination": "Điểm đến",
                "You have arrived at your destination": "Bạn đã đến nơi",
                "You have arrived": "Bạn đã đến",
                "your": "đích",
                "Make a U-turn": "Quay đầu",
                "and": "và",
                "on": "trên",
                "Take the exit": "Đi theo lối ra",
                "Keep left": "Giữ bên trái",
                "Keep right": "Giữ bên phải",
                "slightly left": "Chếch trái",
                "Slight right": "Chếch phải",
                "Merge": "Nhập vào",
                "Take the ramp": "Đi theo đường dốc",
                "In": "Trong",
                "meters": "m",
                "kilometers": "km",
                "Proceed to the route": "Đi theo lộ trình",
                "Recalculating": "Đang tính toán lại",
                "Traffic circle": "Vòng xoay",
                "Leave the traffic circle": "Ra khỏi vòng xoay",
                "Highway": "Đường cao tốc",
                "Freeway": "Xa lộ",
                "Toll road": "Đường có thu phí",
                "Bridge": "Cầu",
                "Tunnel": "Hầm",
                "Ferry": "Phà",
                "Pedestrian crossing": "Lối qua đường cho người đi bộ",
                "Speed bump": "Gờ giảm tốc",
                "Stop sign": "Biển báo dừng",
                "Enter the": "Vào",
                "Exit the": "Ra khỏi",
                "take the 1st exit": "rẽ lối ra thứ nhất",
                "take the 2nd exit": "rẽ lối ra thứ hai",
                "take the 3rd exit": "rẽ lối ra thứ ba",
                "take the 4th exit": "rẽ lối ra thứ bốn",
                "straight": "thẳng",
                "the right": "bên phải",
                "Make a sharp right": "Rẽ phải gấp",
                "Traffic light": "Đèn giao thông",
                "Turn slightly left": "Rẽ chếch trái",
                "Turn slightly right": "Rẽ chếch phải",
                "Make a sharp left": "Rẽ trái gấp",
                "Bear left": "Đi chếch trái",
                "Bear right": "Đi chếch phải",
                "Take the next left": "Rẽ trái tiếp theo",
                "Take the next right": "Rẽ phải tiếp theo",
                "Follow the signs": "Theo biển chỉ dẫn",
                "Stay on the current road": "Đi trên đường hiện tại",
                "Pass the": "Đi qua",
                "Intersection": "Ngã tư",
                "Go": 'Đi',
                "northeast": "hướng đông bắc",
                "Cross the bridge": "Qua cầu",
                "Enter the tunnel": "Vào hầm",
                "Leave the tunnel": "Ra khỏi hầm",
                "Follow the curve": "Theo đường cong",
                "Turn back": "Quay lại",
                "Take the left": "Rẽ trái",
                "Take the right": "Rẽ phải",
                "Take the left onto": "Rẽ trái vào",
                "Take the right onto": "Rẽ phải vào",
                "Take the first left": "Rẽ trái đầu tiên",
                "Take the first right": "Rẽ phải đầu tiên",
                "Take the second left": "Rẽ trái thứ hai",
                "Take the second right": "Rẽ phải thứ hai",
                "Take the third left": "Rẽ trái thứ ba",
                "Take the third right": "Rẽ phải thứ ba",
                "Take the fourth left": "Rẽ trái thứ bốn",
                "Take the fourth right": "Rẽ phải thứ bốn",
                "Take the fifth left": "Rẽ trái thứ năm",
                "Take the fifth right": "Rẽ phải thứ năm",
                "Take the sixth left": "Rẽ trái thứ sáu",
                "Take the sixth right": "Rẽ phải thứ sáu",              
                "Make a left U-turn": "Quay đầu trái",
                "Make a right U-turn": "Quay đầu phải",
                "Take the first exit": "Đi theo lối ra thứ nhất",
                "Take the second exit": "Đi theo lối ra thứ hai",
                "Take the third exit": "Đi theo lối ra thứ ba",
                "Take the fourth exit": "Đi theo lối ra thứ bốn",
                "Take the fifth exit": "Đi theo lối ra thứ năm",
                "Take the sixth exit": "Đi theo lối ra thứ sáu",
                "Take the seventh exit": "Đi theo lối ra thứ bảy",
                "Take the eighth exit": "Đi theo lối ra thứ tám",
                "Take the ninth exit": "Đi theo lối ra thứ chín",
                "Take the tenth exit": "Đi theo lối ra thứ mười"
            };
            Object.entries(translations).forEach(([key, value]) => {
                text = text.replace(new RegExp(`\\b${key}\\b`, 'gi'), value);
            });
            const distanceText = instruction.distance > 1000
                ? `${(instruction.distance / 1000).toFixed(2)} km`
                : `${instruction.distance.toFixed(0)} m`;
            instructionsHTML += `<li>Bước ${index + 1}: ${text} (${distanceText})</li>`;
        });
        document.getElementById('route-instructions').innerHTML = instructionsHTML + '</ul>';
    });

    isRouting = true;
    showNotification('Đang hiển thị chỉ đường.');
};

const resetMarkerToLastFirebasePosition = () => {
    const gpsRef = ref(database, 'gps');
    onValue(query(gpsRef, limitToLast(1)), (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const lastEntryKey = Object.keys(data)[0];
            const lastData = data[lastEntryKey];
            const lat = Number(lastData.latitude);
            const lng = Number(lastData.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
                marker.setLatLng([lat, lng]);
                marker.setPopupContent(`Thiết bị GPS<br>Vị trí: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                // Luôn di chuyển bản đồ đến vị trí cuối cùng, giống centerMap
                map.flyTo([lat, lng], 19, { animate: true, duration: 1.5 });
            }
        }
    }, { onlyOnce: true });
};
const replayRoute = () => {
    if (!gpsPolyline) {
        showNotification('Chưa có dữ liệu tuyến đường để phát lại.');
        return;
    }
    latlngs = gpsPolyline.getLatLngs() || []; // Gán giá trị cho biến toàn cục
    if (latlngs.length < 2) {
        showNotification('Không đủ dữ liệu để phát lại.');
        return;
    }

    if (isReplaying) {
        clearTimeout(replayTimeoutId);
        isReplaying = false;
        document.getElementById('replayProgress').style.display = 'none';
        showNotification('Đã dừng phát lại tuyến đường.');
        resetMarkerToLastFirebasePosition();
        return;
    }

    isReplaying = true;
    replayIndex = 0; // Bắt đầu từ đầu khi nhấn nút
    document.getElementById('replayProgress').style.display = 'block';
    replay(); // Bắt đầu phát lại
};

// Hàm replay riêng biệt để tiếp tục từ vị trí hiện tại
const replay = () => {
    if (replayIndex < latlngs.length && isReplaying) {
        marker.setLatLng(latlngs[replayIndex]);
        map.panTo(latlngs[replayIndex]);
        document.getElementById('progressBar').style.width = `${(replayIndex / (latlngs.length - 1)) * 100}%`;
        replayIndex++;
        replayTimeoutId = setTimeout(replay, currentReplaySpeed);
    } else {
        isReplaying = false;
        replayIndex = 0;
        document.getElementById('replayProgress').style.display = 'none';
        if (replayIndex >= latlngs.length) {
            showNotification('Đã hoàn tất phát lại tuyến đường.');
            resetMarkerToLastFirebasePosition();
        }
    }
};

const initFirebaseConnectionListener = () => {
    const connectedRef = ref(database, '.info/connected');
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            showNotification('Đã kết nối tới Firebase.');
        } else {
            showNotification('Mất kết nối với Firebase.');
        }
    });
};

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = 'login.html';
    } else {
        console.log('Người dùng đã đăng nhập:', user.uid);
        initMap();
        initFirebaseConnectionListener();
        subscribeToGPSUpdates();
        loadPathHistory();
        getUserLocationContinuously();
        setInterval(() => {
            document.getElementById('time').textContent = new Date().toLocaleTimeString('vi-VN');
        }, UPDATE_TIME_UI);
        if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');
    }
});

document.getElementById('toggleControls').addEventListener('click', () => {
    document.getElementById('controlsContent').classList.toggle('show');
});
document.getElementById('satelliteView').addEventListener('click', toggleSatelliteView);

document.getElementById('centerUserLocation').addEventListener('click', centerUserLocation);
document.getElementById('showRoute').addEventListener('click', showRoute);
document.getElementById('trackDevice').addEventListener('click', () => {
    isTracking = !isTracking;
    showNotification(isTracking ? 'Đang theo dõi thiết bị' : 'Đã tắt theo dõi');
    if (marker) {
        // Khi bật hoặc tắt, di chuyển bản đồ đến vị trí hiện tại của marker
        map.flyTo(marker.getLatLng(), 19, { animate: true, duration: 1.5 });
    }
});
document.getElementById('replayRoute').addEventListener('click', replayRoute);
document.getElementById('darkMode').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    document.getElementById('darkMode').innerHTML = `<i class="fas fa-${isDarkMode ? 'sun' : 'moon'}"></i>`;
    localStorage.setItem('darkMode', isDarkMode ? 'true' : 'false');
});

// Khôi phục trạng thái từ localStorage
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.getElementById('darkMode').innerHTML = '<i class="fas fa-sun"></i>';
} else {
    document.getElementById('darkMode').innerHTML = '<i class="fas fa-moon"></i>';
}
document.getElementById('clearHistory').addEventListener('click', clearPathHistory);
document.getElementById('logout').addEventListener('click', () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    signOut(auth).then(() => window.location.href = 'login.html').catch(error => showNotification('Đăng xuất thất bại: ' + error.message));
});


// Cập nhật tốc độ phát lại theo thời gian thực khi kéo thanh trượt
document.getElementById('replaySpeed').addEventListener('input', (e) => {
    currentReplaySpeed = parseInt(e.target.value);
    document.getElementById('replaySpeedValue').textContent = currentReplaySpeed;
    if (isReplaying) {
        clearTimeout(replayTimeoutId); // Hủy timeout cũ
        replay(); // Tiếp tục phát lại ngay lập tức với tốc độ mới
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 's') toggleSatelliteView();

    if (e.key === 'r') replayRoute();
});