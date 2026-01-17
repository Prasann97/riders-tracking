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
let isNavigating = false;
let followUser = true;
let rideHistory = []; // Track all rides: [{ rideId, createdAt, creatorId, riderCount }]

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
    // Clean up any stale navigation data from previous sessions
    isNavigating = false;
    destinationPos = null;
    routingControl = null;
    
    // Clear navigation UI elements
    document.getElementById('nav-panel').style.display = 'none';
    document.getElementById('trip-info-sheet').style.display = 'none';
    document.getElementById('nav-mode-selector').style.display = 'none';
    document.querySelector('.action-buttons').style.display = 'flex';
    document.querySelectorAll('.route-label').forEach(el => el.remove());
    
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

    // Show setup modal logic moved to Auth Listener
    // document.getElementById('setup-modal').classList.add('active');

    // Initialize button handlers after map is ready
    initializeButtons();
    initializeAuth();
}

// Call initMap manually since Leaflet doesn't use a callback like Google
document.addEventListener('DOMContentLoaded', initMap);

// --- PAGE LIFECYCLE HANDLERS ---

// Clean up navigation state on page unload/refresh
window.addEventListener('beforeunload', () => {
    if (isNavigating || destinationPos) {
        // Clear navigation UI state
        isNavigating = false;
        destinationPos = null;
        
        // Remove routing control if it exists
        if (routingControl) {
            try {
                map.removeControl(routingControl);
                routingControl = null;
            } catch (e) {
                console.log("Routing control already removed");
            }
        }
        
        // Clear Firebase destination ref so group doesn't see stale route
        if (db && currentRideId) {
            db.ref(`tracking/${currentRideId}/destination`).remove().catch(err => {
                console.log("Destination already cleared:", err);
            });
        }
        
        console.log("✓ Navigation state cleaned up on page unload");
    }
});

// Initialize all button click handlers
function initializeButtons() {
    // Theme toggle
    document.getElementById('theme-toggle-btn').onclick = () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';

        console.log('Switching to theme:', currentTheme);

        // Update Map tiles
        if (tileLayer) {
            tileLayer.setUrl(themes[currentTheme]);
        }

        // Update UI
        if (currentTheme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }
    };

    // Zoom to fit
    document.getElementById('zoom-fit-btn').onclick = () => {
        zoomToFit();
    };

    // Recenter button
    document.getElementById('recenter-btn').onclick = () => {
        followUser = true;
        navigator.geolocation.getCurrentPosition((pos) => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        });
    };

    // Exit/Cancel active navigation
    const exitNavigation = () => {
        isNavigating = false;

        // Remove routing control from map
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }

        // Hide navigation UI
        document.getElementById('trip-info-sheet').style.display = 'none';
        document.getElementById('nav-mode-selector').style.display = 'none';
        document.querySelector('.action-buttons').style.display = 'flex';

        // Clear route bubbles and markers
        document.querySelectorAll('.route-label').forEach(el => el.remove());
        document.querySelectorAll('.leaflet-marker-icon.route-label-icon').forEach(el => el.remove());
        
        // Clear routing markers from Leaflet
        document.querySelectorAll('.leaflet-marker-icon').forEach(el => {
            if (el.innerHTML.includes('🏁') || el.classList.contains('start-marker')) {
                el.parentElement.remove();
            }
        });

        // Clear destination from Firebase (so others don't see your old route)
        if (db && currentRideId) {
            db.ref(`tracking/${currentRideId}/destination`).remove();
        }

        // Reset destination position
        destinationPos = null;

        // Update status feedback
        document.getElementById('status-text').innerText = 'LIVE TRACKING';
        console.log("✓ Navigation cancelled successfully");
    };

    document.getElementById('exit-nav-btn').onclick = exitNavigation;

    // SOS button
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

    // Map drag to disable follow
    map.on('dragstart', () => {
        followUser = false;
    });

    // Traffic Toggle Logic
    let isTrafficOn = false;
    const trafficLayer = L.tileLayer('https://mt0.google.com/vt/lyrs=m,traffic&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        opacity: 0.7 // Ensure base map is still visible
    });

    const trafficBtn = document.getElementById('traffic-btn');
    if (trafficBtn) {
        trafficBtn.onclick = () => {
            isTrafficOn = !isTrafficOn;
            if (isTrafficOn) {
                map.addLayer(trafficLayer);
                trafficBtn.style.background = 'var(--primary)'; // Active state
                trafficBtn.innerHTML = '🚦';
            } else {
                map.removeLayer(trafficLayer);
                trafficBtn.style.background = 'rgba(22, 26, 35, 0.8)'; // Inactive
                trafficBtn.innerHTML = '🚦';
            }
        };
    }

    // Navigate button - open navigation panel
    document.getElementById('navigate-btn').onclick = () => {
        document.getElementById('nav-panel').style.display = 'block';
        // Auto-fill current location with address
        navigator.geolocation.getCurrentPosition((pos) => {
            fetchAddress(pos.coords.latitude, pos.coords.longitude, 'source-input');
        });
    };

    // Close/Cancel navigation panel
    const closeNavPanel = () => {
        document.getElementById('nav-panel').style.display = 'none';
        document.getElementById('destination-input').value = '';
        document.getElementById('search-results').style.display = 'none';
    };
    
    document.getElementById('close-nav-panel').onclick = closeNavPanel;
    document.getElementById('cancel-nav-setup-btn').onclick = closeNavPanel;

    // Use current location button
    document.getElementById('use-current-location').onclick = () => {
        document.getElementById('source-input').value = "Locating...";
        navigator.geolocation.getCurrentPosition((pos) => {
            fetchAddress(pos.coords.latitude, pos.coords.longitude, 'source-input');
        });
    };

    // Start navigation button
    document.getElementById('start-navigation-btn').onclick = () => {
        const destInput = document.getElementById('destination-input').value;
        const selectedDest = document.getElementById('destination-input').dataset.coords;

        if (selectedDest) {
            // If user selected from dropdown
            const [lat, lng] = selectedDest.split(',');
            document.getElementById('nav-panel').style.display = 'none';
            setDestination({ lat: parseFloat(lat), lng: parseFloat(lng) });
            return;
        }

        if (!destInput) {
            alert('Please enter a destination!');
            return;
        }

        // Fallback: search if manual input
        const geocoder = L.Control.Geocoder.nominatim();
        geocoder.geocode(destInput, (results) => {
            if (results && results.length > 0) {
                const dest = results[0].center;
                document.getElementById('nav-panel').style.display = 'none';
                setDestination(dest);
            } else {
                alert('Destination not found. Please try again.');
            }
        });
    };

    // Live Search Suggestions
    let searchTimeout;
    document.getElementById('destination-input').oninput = (e) => {
        const query = e.target.value;
        const resultsContainer = document.getElementById('search-results');

        clearTimeout(searchTimeout);
        if (query.length < 3) {
            resultsContainer.style.display = 'none';
            return;
        }

        searchTimeout = setTimeout(() => {
            // Use Photon API (Komoot) for better 'Google-like' autocomplete
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8`;

            fetch(url)
                .then(res => res.json())
                .then(data => {
                    resultsContainer.innerHTML = '';
                    if (data.features && data.features.length > 0) {
                        data.features.forEach(feature => {
                            const props = feature.properties;
                            const div = document.createElement('div');
                            div.className = 'search-item';

                            // Construct smart title/subtitle
                            const title = props.name || props.street || props.city;
                            const details = [props.street, props.city, props.state, props.country]
                                .filter(x => x && x !== title) // Remove duplicates
                                .join(', ');

                            div.innerHTML = `<strong>${title}</strong>${details}`;

                            div.onclick = () => {
                                const fullAddress = title + ", " + details;
                                document.getElementById('destination-input').value = fullAddress;
                                // Store exact coordinates
                                document.getElementById('destination-input').dataset.coords = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`; // Lat,Lng
                                resultsContainer.style.display = 'none';
                            };
                            resultsContainer.appendChild(div);
                        });
                        resultsContainer.style.display = 'block';
                    } else {
                        resultsContainer.style.display = 'none';
                    }
                })
                .catch(err => console.error("Search error:", err));
        }, 300); // Faster debounce (300ms)
    };

    // Hide results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-input-group') && !e.target.closest('.search-results')) {
            document.getElementById('search-results').style.display = 'none';
        }
    });

    // Keyboard shortcut: ESC to cancel navigation or close nav panel
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close nav panel if open
            if (document.getElementById('nav-panel').style.display !== 'none') {
                closeNavPanel();
            }
            // Exit active navigation if in progress
            else if (isNavigating) {
                exitNavigation();
            }
        }
    });
}


// --- RIDE HISTORY MANAGEMENT ---

// Load ride history from localStorage
function loadRideHistory() {
    const saved = localStorage.getItem('rideHistory');
    rideHistory = saved ? JSON.parse(saved) : [];
    renderRideHistory();
}

// Save ride history to localStorage
function saveRideHistory() {
    localStorage.setItem('rideHistory', JSON.stringify(rideHistory));
}

// Add ride to history (called when new ride is created)
function addToRideHistory(rideId, creatorId) {
    const ride = {
        rideId: rideId,
        createdAt: new Date().toISOString(),
        creatorId: creatorId,
        riderCount: 1
    };
    
    // Check if ride already exists to avoid duplicates
    if (!rideHistory.find(r => r.rideId === rideId)) {
        rideHistory.unshift(ride); // Add to beginning
        saveRideHistory();
        renderRideHistory();
        console.log(`✓ Added ride ${rideId} to history`);
    }
}

// Render ride history in drawer
function renderRideHistory() {
    const historyList = document.getElementById('ride-history-list');
    const noRidesMsg = document.getElementById('no-rides-msg');
    
    if (rideHistory.length === 0) {
        historyList.innerHTML = '<div id="no-rides-msg" style="text-align:center; color:#888; padding:20px; font-size:0.9rem;">No rides yet</div>';
        return;
    }
    
    historyList.innerHTML = '';
    rideHistory.forEach((ride, index) => {
        const isCreator = ride.creatorId === userData.id;
        const date = new Date(ride.createdAt);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        const card = document.createElement('div');
        card.className = 'ride-history-card';
        card.innerHTML = `
            <div class="ride-code-info">
                <div class="ride-code-text">${ride.rideId}</div>
                <div class="ride-date-text">${dateStr}</div>
            </div>
            ${isCreator ? `<button class="delete-ride-btn" onclick="deleteRide('${ride.rideId}', ${index})">🗑️ DELETE</button>` : `<span style="font-size:0.75rem; color:#888;">Joined</span>`}
        `;
        historyList.appendChild(card);
    });
}

// Delete a ride (only creator can delete)
async function deleteRide(rideId, index) {
    const ride = rideHistory[index];
    
    if (ride.creatorId !== userData.id) {
        alert('Only the ride creator can delete this ride.');
        return;
    }
    
    if (!confirm(`Delete ride ${rideId}? This will end the ride for all participants.`)) {
        return;
    }
    
    try {
        // Remove from Firebase (this notifies all connected users)
        if (db) {
            await db.ref(`tracking/${rideId}`).remove();
            console.log(`✓ Ride ${rideId} removed from Firebase`);
        }
        
        // Remove from local history
        rideHistory.splice(index, 1);
        saveRideHistory();
        renderRideHistory();
        
        // If current ride was deleted, show notification
        if (currentRideId === rideId) {
            document.getElementById('status-text').innerText = 'RIDE ENDED';
            document.getElementById('connection-dot').style.background = 'var(--warning)';
            alert('You have deleted this ride.');
        }
        
        console.log(`✓ Ride ${rideId} deleted successfully`);
    } catch (err) {
        console.error('Error deleting ride:', err);
        alert('Failed to delete ride. Please try again.');
    }
}

// Listen for ride deletions in Firebase (for other users)
function listenForRideDeletions() {
    if (!db || !currentRideId) return;
    
    // If our current ride gets deleted, notify user
    db.ref(`tracking/${currentRideId}`).on('value', (snapshot) => {
        if (!snapshot.exists()) {
            // Ride was deleted
            document.getElementById('status-text').innerText = 'RIDE ENDED BY CREATOR';
            document.getElementById('connection-dot').style.background = 'var(--danger)';
            console.log('✓ Current ride was deleted by creator');
        }
    });
}

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
    
    // Add to ride history (only if creating new ride, not joining)
    const isCreatingNewRide = !document.getElementById('join-code').value.toUpperCase();
    if (isCreatingNewRide) {
        addToRideHistory(currentRideId, userData.id);
    }

    startTracking();
    listenForPartners();
    listenForRideDeletions();
};

function startTracking() {
    console.log("Attempting to start tracking...");
    
    // Clear any stale navigation data from previous session
    if (db && currentRideId) {
        db.ref(`tracking/${currentRideId}/destination`).remove().catch(err => {
            // Silently fail if destination doesn't exist
        });
    }
    
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

                if (followUser) {
                    map.setView(userPos, map.getZoom());
                }
            },
            (err) => {
                console.error("WatchPosition Error:", err);
                document.getElementById('status-text').innerText = "GPS ERROR";
                document.getElementById('connection-dot').style.background = "var(--danger)";
                document.getElementById('connection-dot').style.boxShadow = "0 0 10px var(--danger)";
            },
            {
                enableHighAccuracy: true,
                maximumAge: 5000,  // Cache location for max 5 seconds
                timeout: 10000
            }
        );

        // Also poll location every 5 seconds to ensure updates
        setInterval(() => {
            navigator.geolocation.getCurrentPosition((pos) => {
                const data = {
                    name: userData.name,
                    bike: userData.bike,
                    vehicle: userData.vehicle,
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    speed: (pos.coords.speed && pos.coords.speed > 0) ? (pos.coords.speed * 3.6).toFixed(1) : "0.0",
                    timestamp: Date.now()
                };

                if (db) {
                    db.ref(`tracking/${currentRideId}/${userData.id}`).set(data);
                }

                // Update own marker
                updateMarker(userData.id, { lat: pos.coords.latitude, lng: pos.coords.longitude }, userData.name + " (Me)", true, userData.vehicle);
            }, () => { }, { enableHighAccuracy: true, maximumAge: 0 });
        }, 5000);
    } else {
        alert("Geolocation is not supported by this browser.");
    }
}


function listenForPartners() {
    if (!db) return;

    // 1. Cleanup Old Listeners & Map
    if (window.currentRideRef) {
        window.currentRideRef.off();
        window.currentRideRef.child('destination').off();
    }

    // Clear existing markers (except maybe self, but simpler to clear all and let pulse restore)
    if (typeof markers !== 'undefined') {
        Object.keys(markers).forEach(id => {
            if (map.hasLayer(markers[id])) map.removeLayer(markers[id]);
        });
        markers = {};
    }

    console.log("Listening to Ride:", currentRideId);
    window.currentRideRef = db.ref(`tracking/${currentRideId}`);

    // Unified Handler
    const handleUpdate = (snapshot) => {
        const id = snapshot.key;
        if (id === userData.id || id === 'destination' || id === 'alerts') return;
        const r = snapshot.val();
        if (r && r.lat) {
            updateMarker(id, { lat: r.lat, lng: r.lng }, r.name + " (" + (r.bike || 'Bike') + ")", false, r.vehicle);
        }
    };

    window.currentRideRef.on('child_added', handleUpdate);
    window.currentRideRef.on('child_changed', handleUpdate);

    // Handle left
    window.currentRideRef.on('child_removed', (snapshot) => {
        const id = snapshot.key;
        if (markers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
    });

    // Destination
    window.currentRideRef.child('destination').on('value', (snapshot) => {
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
        // Create custom marker with emoji and permanent label
        const markerHtml = `
            <div class="custom-marker ${isMe ? 'me' : 'partner'}">
                <div class="rider-label">${title}</div>
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
            showAlternatives: true,
            lineOptions: {
                styles: [{ color: '#4285F4', opacity: 1, weight: 7 }]
            },
            altLineOptions: {
                styles: [{ color: '#969696', opacity: 0.8, weight: 6 }]
            },
            collapsible: true,
            createMarker: function (i, wp) {
                if (i === 0) return L.marker(wp.latLng, {
                    icon: L.divIcon({ className: 'start-marker', html: '<div style="width:14px;height:14px;background:white;border:4px solid #4285F4;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.5);"></div>' })
                });
                if (i === 1) return L.marker(wp.latLng, {
                    icon: L.divIcon({ html: '🏁', className: 'dest-emoji', iconSize: [30, 30] })
                });
                return null;
            }
        }).on('routesfound', function (e) {
            const routes = e.routes;
            const summary = routes[0].summary;
            const instructions = routes[0].instructions;

            // Clear existing labels if any
            document.querySelectorAll('.route-label').forEach(el => el.remove());
            document.querySelectorAll('.leaflet-marker-icon.route-label-icon').forEach(el => el.remove());

            // Add Bubbles for each route
            routes.forEach((route, i) => {
                const isMain = i === 0;
                const dist = (route.summary.totalDistance / 1000).toFixed(1) + ' km';
                const time = Math.round(route.summary.totalTime / 60) + ' min';

                // Find middle point
                const midIndex = Math.floor(route.coordinates.length / 2);
                const midPoint = route.coordinates[midIndex];

                const labelHtml = `
                    <div class="route-label ${isMain ? 'active' : ''}">
                        <strong>${time}</strong>
                        <span>${dist}</span>
                    </div>
                `;

                const labelIcon = L.divIcon({
                    className: 'route-label-icon',
                    html: labelHtml,
                    iconSize: [80, 40],
                    iconAnchor: [40, 20]
                });

                L.marker(midPoint, { icon: labelIcon }).addTo(map);
            });

            isNavigating = true;
            document.getElementById('trip-info-sheet').style.display = 'flex';
            document.getElementById('nav-mode-selector').style.display = 'flex';
            document.querySelector('.action-buttons').style.display = 'none';

            updateNavigationUI(summary.totalDistance, summary.totalTime, instructions[0]);
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


function updateNavigationUI(dist, time, next) {
    // Distance in KM
    const km = (dist / 1000).toFixed(1);
    document.getElementById('trip-distance-left').innerText = km;

    // ETA in Minutes
    const mins = Math.round(time / 60);
    document.getElementById('trip-eta').innerText = mins + " MINS";

    // Next Step
    if (next) {
        document.getElementById('next-step-instruction').innerText = next.text;
    }
}

// Helper: Fetch address from coordinates (Reverse Geocoding)
function fetchAddress(lat, lng, elementId) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data && data.display_name) {
                // Shorten address for display
                const address = data.display_name.split(',').slice(0, 3).join(',');
                document.getElementById(elementId).value = address;
            } else {
                document.getElementById(elementId).value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            }
        })
        .catch(err => {
            console.error("Geocoding Error:", err);
            document.getElementById(elementId).value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        });
}




// --- AUTHENTICATION & DRAWER LOGIC ---

function initializeAuth() {
    console.log("Initializing Auth System...");
    
    // Load ride history from localStorage
    loadRideHistory();
    
    if (typeof firebase === 'undefined' || !firebase.auth) {
        console.error("Firebase Auth not loaded");
        return;
    }

    // 0. Apple Login
    const appleBtn = document.getElementById('apple-login-btn');
    if (appleBtn) {
        appleBtn.onclick = () => {
            alert("Connecting to Apple...");
            const provider = new firebase.auth.OAuthProvider('apple.com');
            firebase.auth().signInWithPopup(provider).catch(e => alert("Apple Login Error: " + e.message));
        };
    }

    // 1. Google Login
    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.onclick = () => {
            alert("Connecting to Google...");
            const provider = new firebase.auth.GoogleAuthProvider();
            firebase.auth().signInWithPopup(provider).catch(e => {
                if (e.code === 'auth/operation-not-allowed') alert("Enable Google Auth in Firebase Console!");
                else alert(e.message);
            });
        };
    }

    // 4. Auth State & Persistence
    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            // Logged In
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.style.display = 'none';
                loginModal.classList.remove('active');
            }

            // Base User Info
            userData.id = user.uid;
            userData.name = user.displayName || (user.email ? user.email.split('@')[0] : "Rider");

            // LOAD PERMANENT PROFILE (Bike Model, Vehicle Type)
            firebase.database().ref('users/' + user.uid).once('value').then(snapshot => {
                const val = snapshot.val();
                if (val) {
                    // Restore Name
                    if (val.displayName) {
                        userData.name = val.displayName;
                        document.getElementById('drawer-user-name').innerText = val.displayName;
                        document.getElementById('edit-name').value = val.displayName;
                    } else {
                        // Fallback to Auth Name
                        document.getElementById('drawer-user-name').innerText = userData.name;
                        document.getElementById('edit-name').value = userData.name;
                    }

                    // Restore Vehicle Model
                    if (val.vehicleModel) {
                        userData.bike = val.vehicleModel;
                        const editBike = document.getElementById('edit-bike');
                        if (editBike) editBike.value = val.vehicleModel;
                    }

                    // Restore Vehicle Type
                    if (val.vehicleType) {
                        selectDrawerVehicle(val.vehicleType);
                    }
                } else {
                    // First time? Set defaults
                    document.getElementById('drawer-user-name').innerText = userData.name;
                    document.getElementById('edit-name').value = userData.name;
                }
            });

            document.getElementById('status-text').innerText = "ONLINE";
            const dot = document.getElementById('connection-dot');
            if (dot) dot.style.background = "#00e676";

            // Show ride setup modal (no auto-join with SQUAD-1)
            const rideSetupModal = document.getElementById('ride-setup-modal');
            if (rideSetupModal && !currentRideId) {
                rideSetupModal.style.display = 'block';
            }

            // If user already has a ride (from previous session), continue tracking
            if (currentRideId) {
                const codeDisplay = document.getElementById('display-ride-code');
                if (codeDisplay) codeDisplay.innerText = currentRideId;
                startTracking();
                listenForPartners();
            }

        } else {
            // Logged Out
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.style.display = 'block';
                loginModal.classList.add('active');
            }
            document.getElementById('app-drawer').classList.remove('open');
            document.getElementById('status-text').innerText = "OFFLINE";
        }
    });

    // --- RIDE SETUP MODAL LOGIC ---
    const rideSetupModal = document.getElementById('ride-setup-modal');
    const joinModal = document.getElementById('join-modal');
    
    if (rideSetupModal) {
        // Create New Ride
        document.getElementById('create-new-ride-btn').onclick = () => {
            currentRideId = Math.random().toString(36).substr(2, 6).toUpperCase();
            const codeDisplay = document.getElementById('display-ride-code');
            if (codeDisplay) codeDisplay.innerText = currentRideId;
            
            // Add to history
            addToRideHistory(currentRideId, userData.id);
            
            // Hide setup modal and start tracking
            rideSetupModal.style.display = 'none';
            startTracking();
            listenForPartners();
            listenForRideDeletions();
            
            console.log(`✓ Created new ride: ${currentRideId}`);
        };
        
        // Join Existing Ride
        document.getElementById('join-existing-ride-btn').onclick = () => {
            rideSetupModal.style.display = 'none';
            joinModal.style.display = 'block';
            setTimeout(() => joinModal.classList.add('active'), 10);
        };
    }

    // --- JOIN RIDE LOGIC ---
    const joinBtn = document.getElementById('join-ride-btn');
    if (joinBtn && joinModal) {
        joinBtn.onclick = () => {
            joinModal.style.display = 'block';
            setTimeout(() => joinModal.classList.add('active'), 10);
        };

        document.getElementById('cancel-join-btn').onclick = () => {
            joinModal.classList.remove('active');
            setTimeout(() => joinModal.style.display = 'none', 300);
        };

        document.getElementById('submit-join-btn').onclick = () => {
            const code = document.getElementById('input-ride-code').value.trim().toUpperCase();
            if (!code) return alert("Enter a valid code!");

            // Remove from old ride
            if (currentRideId && userData.id) {
                firebase.database().ref('tracking/' + currentRideId + '/' + userData.id).remove();
            }

            currentRideId = code;
            const disp = document.getElementById('display-ride-code');
            if (disp) {
                disp.innerText = currentRideId;
            }

            // Add to ride history
            addToRideHistory(code, userData.id);
            
            // Close modal first
            joinModal.classList.remove('active');
            setTimeout(() => {
                joinModal.style.display = 'none';
                document.getElementById('input-ride-code').value = ''; // Clear input
            }, 300);
            
            // Start tracking (gets current position and begins watching)
            startTracking();
            
            // Listen for partners on this ride
            listenForPartners();
            listenForRideDeletions();
            
            console.log(`✓ Joined ride: ${code}`);
        };
    }

    // Drawer Interactions
    const menuBtn = document.getElementById('menu-btn');
    if (menuBtn) menuBtn.onclick = () => document.getElementById('app-drawer').classList.add('open');

    const closeBtn = document.getElementById('close-drawer-btn');
    if (closeBtn) closeBtn.onclick = () => document.getElementById('app-drawer').classList.remove('open');

    // Ride History Toggle
    const toggleHistoryBtn = document.getElementById('toggle-ride-history');
    if (toggleHistoryBtn) {
        toggleHistoryBtn.onclick = () => {
            const historyList = document.getElementById('ride-history-list');
            const isHidden = historyList.style.display === 'none';
            historyList.style.display = isHidden ? 'block' : 'none';
            document.getElementById('history-toggle-icon').textContent = isHidden ? '▲' : '▼';
        };
    }

    const signOutBtn = document.getElementById('sign-out-btn');
    if (signOutBtn) signOutBtn.onclick = () => {
        firebase.auth().signOut().then(() => window.location.reload());
    };

    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) saveBtn.onclick = () => {
        const name = document.getElementById('edit-name').value;
        const bike = document.getElementById('edit-bike').value;
        userData.name = name;
        userData.bike = bike; // Store in local state

        const dName = document.getElementById('drawer-user-name');
        if (dName) dName.innerText = name;

        // 1. Update Auth Profile
        if (firebase.auth().currentUser) firebase.auth().currentUser.updateProfile({ displayName: name });

        // 2. Update Permanent User DB
        if (userData.id) {
            firebase.database().ref('users/' + userData.id).update({
                displayName: name,
                vehicleModel: bike,
                vehicleType: userData.vehicle || 'motorcycle'
            });
        }

        // 3. Update Current Ride Tracking
        if (currentRideId && userData.id) {
            firebase.database().ref('tracking/' + currentRideId + '/' + userData.id).update({
                name: name,
                bike: bike,
                vehicle: userData.vehicle || 'motorcycle'
            });
        }

        document.getElementById('app-drawer').classList.remove('open');
        alert("Profile Saved & Synced!");
    };
}

// Vehicle Helper
window.selectDrawerVehicle = (type) => {
    userData.vehicle = type;
    document.querySelectorAll('.v-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.v-btn[data-v="' + type + '"]').classList.add('active');

    // Update Placeholder
    const modelInput = document.getElementById('edit-bike');
    if (modelInput) {
        if (type === 'motorcycle') modelInput.placeholder = "Bike Model (e.g. Duke 390)";
        else if (type === 'car') modelInput.placeholder = "Car Model (e.g. Ford)";
        else if (type === 'bicycle') modelInput.placeholder = "Bike Model (e.g. Trek)";
        else modelInput.placeholder = "Shoes (e.g. Nike)";
    }

    if (typeof setDestination === 'function' && destinationPos) setDestination(destinationPos);
};
