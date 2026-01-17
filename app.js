// --- CONFIGURATION ---
// Replace with your Firebase settings from Firebase Console
// const firebaseConfig = {
//     apiKey: "YOUR_API_KEY",
//     authDomain: "YOUR_PROJECT.firebaseapp.com",
//     databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
//     projectId: "YOUR_PROJECT",
//     storageBucket: "YOUR_PROJECT.appspot.com",
//     messagingSenderId: "YOUR_SENDER_ID",
//     appId: "YOUR_APP_ID"
// };
const firebaseConfig = {
    apiKey: "AIzaSyCXkhuPjOR_sC542XkhZ8QjNuyiz7CZKqw",
    authDomain: "riders-tracking.firebaseapp.com",
    databaseURL: "https://riders-tracking-default-rtdb.firebaseio.com/",
    projectId: "riders-tracking",
    storageBucket: "riders-tracking.firebasestorage.app",
    messagingSenderId: "774628255333",
    appId: "1:774628255333:web:53be22de8d2caa03ea488c",
    measurementId: "G-PN3CQH23Q4"
};

// --- APP STATE ---
let map;
let markers = {};
let currentRideId = null;
let watchId = null;
let currentTheme = 'dark';
let tileLayer;
let routingControl = null;
let destinationPos = null;

const routers = {
    motorcycle: 'https://router.project-osrm.org/route/v1/driving/',
    car: 'https://router.project-osrm.org/route/v1/driving/',
    bicycle: 'https://router.project-osrm.org/route/v1/cycling/',
    walk: 'https://router.project-osrm.org/route/v1/foot/'
};

const themes = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
};

let userData = {
    name: "",
    bike: "",
    vehicle: "motorcycle",
    id: "user_" + Math.random().toString(36).substr(2, 9)
};

// Initialize Firebase
if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.database ? firebase.database() : null;

// --- MAP & UI LOGIC ---
function initMap() {
    // Initialize Leaflet map
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([12.9716, 77.5946], 15);

    // Initial tile layer
    tileLayer = L.tileLayer(themes[currentTheme], {
        maxZoom: 19
    }).addTo(map);

    // Add Geocoder search
    const geocoder = L.Control.geocoder({
        defaultMarkGeocode: false,
        placeholder: "Search Destination...",
        position: 'topleft'
    })
        .on('markgeocode', function (e) {
            const dest = e.geocode.center;
            setDestination(dest);
        })
        .addTo(map);

    // Show setup modal
    document.getElementById('setup-modal').classList.add('active');
}

// Call initMap manually since Leaflet doesn't use a callback like Google
document.addEventListener('DOMContentLoaded', initMap);


// --- CORE FUNCTIONALITY ---

// Handle Setup
document.getElementById('confirm-setup').onclick = () => {
    userData.name = document.getElementById('user-name').value || "Anonymous Rider";
    userData.bike = document.getElementById('bike-model').value || "Bike";
    userData.vehicle = document.getElementById('vehicle-type').value;
    const joinCode = document.getElementById('join-code').value.toUpperCase();

    if (joinCode) {
        currentRideId = joinCode;
    } else {
        currentRideId = Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    document.getElementById('display-ride-code').innerText = currentRideId;
    document.getElementById('setup-modal').classList.remove('active');

    startTracking();
    listenForPartners();
};

function startTracking() {
    console.log("Attempting to start tracking...");
    document.getElementById('status-text').innerText = "SEARCHING GPS...";
    document.getElementById('connection-dot').style.background = "var(--warning)";

    if ("geolocation" in navigator) {
        // Request immediate position for instant map centering
        navigator.geolocation.getCurrentPosition((pos) => {
            console.log("Initial position found:", pos.coords.latitude, pos.coords.longitude);
            const userPos = [pos.coords.latitude, pos.coords.longitude];
            map.setView(userPos, 16);
            updateMarker(userData.id, { lat: pos.coords.latitude, lng: pos.coords.longitude }, userData.name + " (Me)", true);
        }, (err) => {
            console.warn("Initial position error:", err.message);
            alert("Location Error: " + err.message + "\n\nPlease ensure you are using HTTPS or Localhost, and that GPS is ON.");
        });

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                console.log("GPS Updated:", pos.coords.latitude, pos.coords.longitude);
                document.getElementById('status-text').innerText = "LIVE TRACKING";
                document.getElementById('connection-dot').style.background = "var(--success)";
                document.getElementById('connection-dot').style.boxShadow = "0 0 10px var(--success)";

                const data = {
                    name: userData.name,
                    bike: userData.bike,
                    vehicle: userData.vehicle,
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    speed: (pos.coords.speed && pos.coords.speed > 0) ? (pos.coords.speed * 3.6).toFixed(1) : "0.0",
                    timestamp: Date.now()
                };

                updateUI(data);

                if (db) {
                    db.ref(`tracking/${currentRideId}/${userData.id}`).set(data);
                }

                // Update marker and center map
                const userPos = [pos.coords.latitude, pos.coords.longitude];
                updateMarker(userData.id, { lat: pos.coords.latitude, lng: pos.coords.longitude }, userData.name + " (Me)", true);
                map.setView(userPos, map.getZoom());
            },
            (err) => {
                console.error("WatchPosition Error:", err);
                document.getElementById('status-text').innerText = "GPS ERROR";
                document.getElementById('connection-dot').style.background = "var(--danger)";
                document.getElementById('connection-dot').style.boxShadow = "0 0 10px var(--danger)";
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
    } else {
        alert("Geolocation is not supported by this browser.");
    }
}


function listenForPartners() {
    if (!db) return;

    const rideRef = db.ref(`tracking/${currentRideId}`);

    // Listen for new riders
    rideRef.on('child_added', (snapshot) => {
        const id = snapshot.key;
        if (id === userData.id || id === 'destination' || id === 'alerts') return;
        const r = snapshot.val();
        updateMarker(id, { lat: r.lat, lng: r.lng }, r.name + " (" + (r.bike || 'Bike') + ")", false, r.vehicle);
    });

    // Listen for location changes
    rideRef.on('child_changed', (snapshot) => {
        const id = snapshot.key;
        if (id === userData.id || id === 'destination' || id === 'alerts') return;
        const r = snapshot.val();
        updateMarker(id, { lat: r.lat, lng: r.lng }, r.name + " (" + (r.bike || 'Bike') + ")", false, r.vehicle);
    });

    // Handle rider leaving/offline
    rideRef.on('child_removed', (snapshot) => {
        const id = snapshot.key;
        if (markers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
    });

    // Listen for destination updates
    rideRef.child('destination').on('value', (snapshot) => {
        const dest = snapshot.val();
        if (dest && (!routingControl || !routingControl.getWaypoints()[1].latLng || !routingControl.getWaypoints()[1].latLng.equals(L.latLng(dest.lat, dest.lng)))) {
            drawPathOnly(dest);
        }
    });
}


function drawPathOnly(dest) {
    if (routingControl) map.removeControl(routingControl);

    const end = L.latLng(dest.lat, dest.lng);

    // Try to get current location for the path
    navigator.geolocation.getCurrentPosition((pos) => {
        const start = L.latLng(pos.coords.latitude, pos.coords.longitude);

        routingControl = L.Routing.control({
            waypoints: [start, end],
            routeWhileDragging: false,
            addWaypoints: false,
            show: false, // Don't show numeric instructions by default
            lineOptions: {
                styles: [{ color: 'var(--primary)', opacity: 0.6, weight: 4, dashArray: '5, 10' }]
            },
            createMarker: function (i, wp) {
                if (i === 1) return L.marker(wp.latLng, {
                    icon: L.divIcon({ html: '🏁', className: 'dest-emoji', iconSize: [30, 30] })
                });
                return null;
            }
        }).addTo(map);
    }, () => {
        // Fallback: just show the destination marker if GPS is off
        L.marker(end, {
            icon: L.divIcon({ html: '🏁', className: 'dest-emoji', iconSize: [30, 30] })
        }).addTo(map);
    });
}



function updateMarker(id, position, title, isMe = false, vehicle = 'motorcycle') {
    const latlng = [position.lat, position.lng];

    const icons = {
        motorcycle: '🏍️',
        car: '🚗',
        bicycle: '🚲',
        walk: '🚶'
    };

    const vehicleIcon = icons[vehicle] || '📍';

    if (markers[id]) {
        markers[id].setLatLng(latlng);
    } else {
        // Create custom marker with emoji
        const markerHtml = `
            <div class="custom-marker ${isMe ? 'me' : 'partner'}">
                <span class="vehicle">${vehicleIcon}</span>
                <div class="pulse"></div>
            </div>
        `;

        markers[id] = L.marker(latlng, {
            icon: L.divIcon({
                html: markerHtml,
                className: 'leaflet-vehicle-icon',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            })
        }).addTo(map);

        markers[id].bindPopup(`<div style="color:black; font-weight:bold; padding:5px;">${title}</div>`);
    }
}


function zoomToFit() {
    const group = new L.featureGroup(Object.values(markers));
    map.fitBounds(group.getBounds(), { padding: [50, 50] });
}


function updateUI(data) {
    document.getElementById('current-speed').innerText = data.speed;
}

function setDestination(dest) {
    destinationPos = dest;
    document.getElementById('nav-mode-selector').style.display = 'flex';

    if (routingControl) {
        map.removeControl(routingControl);
    }

    // Get current location as start point
    navigator.geolocation.getCurrentPosition((pos) => {
        const start = L.latLng(pos.coords.latitude, pos.coords.longitude);
        const end = L.latLng(dest.lat, dest.lng);

        routingControl = L.Routing.control({
            waypoints: [start, end],
            router: L.Routing.osrmv1({
                serviceUrl: routers[userData.vehicle] || routers.car
            }),
            routeWhileDragging: false,
            lineOptions: {
                styles: [{ color: 'var(--primary)', opacity: 0.8, weight: 6 }]
            },
            collapsible: true,
            createMarker: function (i, wp) {
                if (i === 1) return L.marker(wp.latLng, {
                    icon: L.divIcon({ html: '🏁', className: 'dest-emoji', iconSize: [30, 30] })
                });
                return null;
            }
        }).addTo(map);

        // Sync destination with group
        if (db) {
            db.ref(`tracking/${currentRideId}/destination`).set({
                lat: dest.lat,
                lng: dest.lng
            });
        }
    });

    // Handle clicks on the travel mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            userData.vehicle = btn.getAttribute('data-mode');

            // Recalculate route with new vehicle type
            if (destinationPos) setDestination(destinationPos);
        };
    });
}


// SOS Logic
document.getElementById('sos-btn').onclick = () => {
    alert("SOS ALERT SENT TO GROUP!");
    if (db) {
        db.ref(`tracking/${currentRideId}/alerts`).push({
            type: "SOS",
            sender: userData.name,
            timestamp: Date.now()
        });
    }
};

document.getElementById('zoom-fit-btn').onclick = () => {
    zoomToFit();
};

document.getElementById('theme-toggle-btn').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';

    // Update Map
    tileLayer.setUrl(themes[currentTheme]);

    // Update UI
    if (currentTheme === 'light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
};
