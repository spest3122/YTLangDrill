let currentVideoId = "";
let pins = {};
let isRepeatEnabled = false;
let lastTime = 0;
let videoElement = null;
let jumpCooldown = 0; // NEW: Tracks the cooldown time to prevent double-jumping

// Get the unique YouTube video ID from the URL
function getVideoId() {
    return new URLSearchParams(window.location.search).get("v");
}

// Load pins from Chrome storage when a video loads
function loadPins() {
    currentVideoId = getVideoId();
    if (!currentVideoId) return;

    chrome.storage.local.get([currentVideoId], (result) => {
        pins = result[currentVideoId] || {};
        updateUI();
    });
}

// Format seconds into MM:SS
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
    return `${m}:${s}`;
}

// --- The Looping Engine ---
function setupVideoListener(video) {
    if (video !== videoElement) {
        if (videoElement) {
            videoElement.removeEventListener("timeupdate", handleTimeUpdate);
        }
        videoElement = video;
        videoElement.addEventListener("timeupdate", handleTimeUpdate);
    }
}

function handleTimeUpdate(e) {
    const video = e.target;
    const currentTime = video.currentTime;

    if (!isRepeatEnabled) {
        lastTime = currentTime;
        return;
    }

    // Detect manual seek from the user
    if (Math.abs(currentTime - lastTime) > 1.5) {
        lastTime = currentTime;
        return;
    }

    // NEW: Cooldown check. If we just jumped, ignore boundaries for 1 second
    // This prevents keyframe snapping from triggering a double-jump.
    if (Date.now() < jumpCooldown) {
        lastTime = currentTime;
        return;
    }

    const pinTimes = Object.values(pins);
    let boundaries = [0, ...pinTimes, video.duration - 0.5];

    // Remove duplicates and sort chronologically
    boundaries = [...new Set(boundaries)].sort((a, b) => a - b);

    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];

        if (lastTime >= start && lastTime < end && currentTime >= end) {
            video.currentTime = start;
            lastTime = start;
            jumpCooldown = Date.now() + 1000; // NEW: Set a 1-second cooldown after a jump
            showToast(`🔁 Looping segment`);
            return;
        }
    }

    lastTime = currentTime;
}

// --- Visual UI Updaters ---
function updateUI() {
    const video = document.querySelector("video");
    if (!video || !video.duration) {
        setTimeout(updateUI, 500);
        return;
    }

    setupVideoListener(video);
    renderMarkers(video);
    renderPanel();
}

function renderMarkers(video) {
    const progressList = document.querySelector(".ytp-progress-list");
    if (!progressList) return;

    document.querySelectorAll(".yt-pin-marker").forEach((el) => el.remove());

    for (const [key, time] of Object.entries(pins)) {
        const percent = (time / video.duration) * 100;

        const marker = document.createElement("div");
        marker.className = "yt-pin-marker";
        marker.style.left = `${percent}%`;
        marker.setAttribute("data-key", key);

        marker.addEventListener("click", (e) => {
            e.stopPropagation();
            video.currentTime = time;
        });

        progressList.appendChild(marker);
    }
}

function renderPanel() {
    let panel = document.getElementById("yt-pin-panel");
    const player = document.getElementById("movie_player") || document.body;

    if (!panel) {
        panel = document.createElement("div");
        panel.id = "yt-pin-panel";
        player.appendChild(panel);
    }

    if (Object.keys(pins).length === 0 && !isRepeatEnabled) {
        panel.style.display = "none";
        return;
    }

    panel.style.display = "block";

    // Added a container for the buttons and the new Clear button
    panel.innerHTML = `
    <div class="yt-pin-header">
      <span>📍 Pinned Locations</span>
      <div class="yt-pin-actions">
        <button id="yt-pin-repeat-btn" class="${isRepeatEnabled ? "active" : ""}">
          🔁 ${isRepeatEnabled ? "ON" : "OFF"}
        </button>
        <button id="yt-pin-clear-btn">
          🗑️ Clear
        </button>
      </div>
    </div>
  `;

    // Repeat Button Listener
    document.getElementById("yt-pin-repeat-btn").addEventListener("click", (e) => {
        isRepeatEnabled = !isRepeatEnabled;
        e.target.innerText = `🔁 ${isRepeatEnabled ? "ON" : "OFF"}`;
        e.target.className = isRepeatEnabled ? "active" : "";
        showToast(`Repeat turned ${isRepeatEnabled ? "ON" : "OFF"}`);
        updateUI(); // Re-render to hide panel if repeat is off and no pins exist
    });

    // NEW: Clear Button Listener
    document.getElementById("yt-pin-clear-btn").addEventListener("click", () => {
        pins = {};
        chrome.storage.local.remove([currentVideoId], () => {
            showToast("All pins cleared");
            updateUI(); // Instantly removes timeline markers and updates the panel
        });
    });

    const list = document.createElement("ul");
    list.className = "yt-pin-list";

    const sortedPins = Object.entries(pins).sort((a, b) => a[1] - b[1]);

    for (const [key, time] of sortedPins) {
        const item = document.createElement("li");
        const formattedTime = formatTime(time);
        item.className = "yt-pin-item";
        item.innerHTML = `<strong>${key}</strong> <span class="time">${formattedTime}</span>`;

        item.addEventListener("click", () => {
            if (videoElement) {
                videoElement.currentTime = time;
                showToast(`Jumped to Pin ${key}`);
            }
        });

        list.appendChild(item);
    }

    panel.appendChild(list);
}

// Listen for YouTube's specific page navigation event
document.addEventListener("yt-navigate-finish", loadPins);
window.addEventListener("load", loadPins);

// Intercept Keypresses
document.addEventListener(
    "keydown",
    (e) => {
        const target = e.target.tagName;
        // Ignore keystrokes if the user is typing in a search box or comment field
        if (target === "INPUT" || target === "TEXTAREA" || e.target.isContentEditable) return;

        const video = document.querySelector("video");
        if (!video) return;

        // --- Clear All Pins Shortcut (Shift + C) ---
        if (e.shiftKey && e.code === "KeyC") {
            e.preventDefault();
            e.stopImmediatePropagation();

            pins = {};
            chrome.storage.local.remove([currentVideoId], () => {
                showToast("All pins cleared");
                updateUI(); // Instantly removes timeline markers and updates the panel
            });
            return; // Exit here
        }

        // --- NEW: Toggle Repeat Shortcut (Shift + R) ---
        if (e.shiftKey && e.code === "KeyR") {
            e.preventDefault();
            e.stopImmediatePropagation();

            isRepeatEnabled = !isRepeatEnabled;
            showToast(`Repeat turned ${isRepeatEnabled ? "ON" : "OFF"}`);
            updateUI(); // Updates the UI panel button state
            return; // Exit here
        }

        // Identify the physical key pressed for numbers
        let numKey = null;
        if (e.code && e.code.startsWith("Digit")) {
            numKey = e.code.replace("Digit", "");
        } else if (e.code && e.code.startsWith("Numpad")) {
            numKey = e.code.replace("Numpad", "");
        }

        // If the key wasn't a number key, do nothing
        if (!numKey) return;

        if (e.shiftKey) {
            // SET A PIN
            e.preventDefault();
            e.stopImmediatePropagation();

            pins[numKey] = video.currentTime;

            chrome.storage.local.set({ [currentVideoId]: pins }, () => {
                showToast(`Pin ${numKey} set at ${formatTime(video.currentTime)}`);
                updateUI();
            });
        } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
            // JUMP TO A PIN
            if (pins[numKey] !== undefined) {
                e.preventDefault();
                e.stopImmediatePropagation();

                video.currentTime = pins[numKey];
                showToast(`Jumped to Pin ${numKey}`);
            }
        }
    },
    true,
);

// --- UI Feedback (Toast Notification) ---
function showToast(message) {
    let toast = document.getElementById("yt-pin-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "yt-pin-toast";
        document.body.appendChild(toast);
    }

    toast.innerText = message;
    toast.classList.add("show");

    clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 2000);
}
